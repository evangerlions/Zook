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
        self.values = {"APP_ENV": "dev", "DEPLOY_SLOT": "dev"}

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

    def test_dev_mounts_both_complete_keysets_readonly_only_for_api_and_worker(self):
        for mode in ("production", "sandbox"):
            self.keys(mode)
        path = self.prepare(self.values)
        config = json.loads(path.read_text())
        self.assertEqual(set(config["services"]), {"api", "worker"})
        for service in config["services"].values():
            self.assertEqual(service["volumes"], [{
                "type": "bind", "source": str(self.home / ".zook/secrets/ainovel-alipay" / mode),
                "target": f"/run/secrets/ainovel-alipay/{mode}", "read_only": True,
                "bind": {"create_host_path": False},
            } for mode in ("production", "sandbox")])
        self.assertNotIn("test-key-content", path.read_text())

    def test_online_and_unknown_never_mount_sandbox_even_when_its_keys_exist(self):
        self.keys("production")
        self.keys("sandbox")
        for deployment in ("online", "production", "unknown", ""):
            with self.subTest(deployment=deployment):
                path = self.prepare({"APP_ENV": deployment})
                for service in json.loads(path.read_text())["services"].values():
                    self.assertEqual(len(service["volumes"]), 1)
                    self.assertTrue(service["volumes"][0]["target"].endswith("/production"))

    def test_slot_is_authoritative_over_app_environment(self):
        self.keys("production")
        self.keys("sandbox")
        path = self.prepare({"APP_ENV": "local", "DEPLOY_SLOT": "online"})
        self.assertNotIn("sandbox", path.read_text())
        app_env = self.home / "app.env"
        app_env.write_text("APP_ENV=local\nDEPLOY_SLOT=dev\n")
        path = mounts.prepare(self.state, app_env, slot="online", home=self.home)
        self.assertNotIn("sandbox", path.read_text())

    def test_missing_key_in_provisioned_directory_fails_before_writing_overlay(self):
        directory = self.keys("sandbox")
        (directory / "alipay-public-key.pem").unlink()
        with self.assertRaisesRegex(ValueError, "key file"):
            self.prepare(self.values)
        self.assertFalse(self.state.exists())

    def test_one_missing_environment_stays_unavailable_without_empty_bind_mounts(self):
        self.keys("production")
        path = self.prepare(self.values)
        self.assertNotIn("sandbox", path.read_text())
        self.assertFalse((self.home / ".zook/secrets/ainovel-alipay/sandbox").exists())

    def test_export_and_quotes_do_not_parse_unrelated_credentials(self):
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
