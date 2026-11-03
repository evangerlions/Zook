import json
import contextlib
import io
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import alipay_key_mounts as mounts
import build_and_push_docker as deployment


class AlipayKeyMountsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.state = self.home / "deployment"
        self.values = {
            "ALIPAY_AI_NOVEL_ENVIRONMENT": "sandbox",
            "ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH": "/run/secrets/ainovel-alipay/app-private-key.pem",
            "ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH": "/run/secrets/ainovel-alipay/alipay-public-key.pem",
        }

    def keys(self, mode):
        directory = self.home / ".zook/secrets/ainovel-alipay" / mode
        directory.mkdir(parents=True)
        for name in ("app-private-key.pem", "alipay-public-key.pem"):
            (directory / name).write_text("test-key-content")
        return directory

    def prepare(self, values):
        app_env = self.home / "app.env"
        app_env.write_text("\n".join(f"{key}={value}" for key, value in values.items()))
        return mounts.prepare(self.state, app_env, home=self.home)

    def test_unconfigured_payments_add_no_mount_or_directory(self):
        self.assertIsNone(self.prepare({}))
        self.assertFalse(self.state.exists())

    def test_modes_mount_only_their_keys_readonly_for_api_and_worker(self):
        for mode in ("sandbox", "production"):
            with self.subTest(mode=mode):
                directory = self.keys(mode)
                path = self.prepare({**self.values, "ALIPAY_AI_NOVEL_ENVIRONMENT": mode})
                config = json.loads(path.read_text())
                self.assertEqual(set(config["services"]), {"api", "worker"})
                for service in config["services"].values():
                    self.assertEqual(service["volumes"], [{
                        "type": "bind", "source": str(directory),
                        "target": "/run/secrets/ainovel-alipay", "read_only": True,
                        "bind": {"create_host_path": False},
                    }])
                self.assertNotIn("test-key-content", path.read_text())

    def test_missing_key_fails_before_writing_or_creating_host_directories(self):
        with self.assertRaisesRegex(ValueError, "key file"):
            self.prepare(self.values)
        self.assertFalse(self.state.exists())
        self.assertFalse((self.home / ".zook").exists())

    def test_missing_public_key_fails_before_writing_overlay(self):
        directory = self.keys("sandbox")
        (directory / "alipay-public-key.pem").unlink()
        with self.assertRaisesRegex(ValueError, "key file"):
            self.prepare(self.values)
        self.assertFalse(self.state.exists())

    def test_partial_or_unknown_environment_is_rejected(self):
        for mode in ("", "../production", "prod"):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "environment"):
                self.prepare({**self.values, "ALIPAY_AI_NOVEL_ENVIRONMENT": mode})

    def test_container_paths_must_match_the_mounted_directory(self):
        for key in ("ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH", "ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "container key paths"):
                self.prepare({**self.values, key: "/host/key.pem"})

    def test_export_and_quoted_paths_do_not_parse_unrelated_credentials(self):
        self.keys("sandbox")
        app_env = self.home / "app.env"
        app_env.write_text('UNRELATED_TOKEN="not-json\\sequence$UNSET"\n' + "\n".join(
            f"export {key}='{value}'" for key, value in self.values.items()))
        path = mounts.prepare(self.state, app_env, home=self.home)
        self.assertNotIn("UNRELATED_TOKEN", path.read_text())
        self.assertEqual(set(json.loads(path.read_text())["services"]), {"api", "worker"})

    def test_deployment_dry_run_automatically_includes_runtime_env_mount(self):
        self.keys("sandbox")
        self.prepare(self.values)
        (self.home / "compose.yaml").write_text("services: {}\n")
        (self.home / "Dockerfile").write_text("FROM node:22-alpine\n")
        args = ["deploy", "--branch", "release-dev", "--slot", "dev",
                "--image-name", "zook", "--app-env-file", str(self.home / "app.env"),
                "--skip-git-sync", "--dry-run"]
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", args))
            stack.enter_context(patch.dict(os.environ, {}, clear=True))
            stack.enter_context(patch.object(deployment, "resolve_repo_root", return_value=self.home))
            stack.enter_context(patch.object(deployment, "find_env_file", return_value=None))
            stack.enter_context(patch.object(deployment, "assert_repo_ready_for_sync", return_value=False))
            stack.enter_context(patch.object(deployment, "resolve_current_release", return_value=None))
            stack.enter_context(patch.object(deployment, "resolve_version", return_value=(None, None)))
            stack.enter_context(patch.object(deployment, "git_output", return_value="a" * 40))
            stack.enter_context(patch.object(mounts.Path, "home", return_value=self.home))
            command = stack.enter_context(patch.object(deployment, "run_command"))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(deployment.main(), 0)
            command.assert_not_called()
        path = self.home / ".deploy/dev/alipay-keys.compose.json"
        self.assertTrue(path.is_file())
        self.assertIn(str(path), output.getvalue())


if __name__ == "__main__":
    unittest.main()
