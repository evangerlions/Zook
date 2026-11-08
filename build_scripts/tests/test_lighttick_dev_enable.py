import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "lighttick_dev_enable.py"
RELEASE = "e" * 40


class EnableTest(unittest.TestCase):
    def setup_repo(self, root):
        (root / "deploy_configs").mkdir()
        (root / ".deploy/dev").mkdir(parents=True)
        self.dev = {"APP_ENV": "dev", "DEPLOY_SLOT": "dev", "DATABASE_URL": "postgresql://qa:PRIVATE@localhost:5432/dev",
                    "REDIS_URL": "redis://localhost/1", "ZOOK_APP_RUN_DATA_HOST_PATH": str(root / "dev-data")}
        self.prod = {**self.dev, "DATABASE_URL": "postgresql://qa:PRIVATE@localhost:5432/online",
                     "REDIS_URL": "redis://localhost/0", "ZOOK_APP_RUN_DATA_HOST_PATH": str(root / "online-data")}
        self.active = {"commit": RELEASE, "images": {"api": "zook:dev"}}
        self.docker_mode = "normal"

    def write(self, root):
        for name, values in [("dev", self.dev), ("online", self.prod)]:
            (root / f"deploy_configs/{name}.env").write_text("# keep comment\n" + "".join(f"{k}={v}\n" for k, v in values.items()))
        (root / ".deploy/dev/deploy_state.json").write_text(json.dumps({"active_release": self.active}))

    def run_script(self, root, *args):
        deployments = []

        def run(command, **kwargs):
            if command[0] != "docker":
                deployments.append((command, kwargs))
                return subprocess.CompletedProcess(command, 0)
            if command[1] == "ps":
                value = "" if self.docker_mode == "missing" else "api-container"
            elif command[1:3] == ["image", "inspect"]:
                value = "sha256:expected"
            elif command[-1] == "{{.Image}}":
                value = "sha256:other" if self.docker_mode == "image" else "sha256:expected"
            else:
                value = "f" * 40 if self.docker_mode == "revision" else RELEASE
            return subprocess.CompletedProcess(command, 0, stdout=value)

        output = io.StringIO()
        with patch("sys.argv", [str(SCRIPT), "--repo", str(root), "--expected-release", RELEASE, *args]), \
                patch("subprocess.check_output", side_effect=lambda cmd, **kw: ("f" * 40 if self.docker_mode == "head" else RELEASE) if cmd[1] == "rev-parse" else (" M tracked" if self.docker_mode == "dirty" else "")), \
                patch("subprocess.run", side_effect=run), patch("pathlib.Path.home", return_value=root / "private-home"), \
                patch.dict(os.environ, {"GROW_DEPLOY_ENABLED": "1", "COMPOSE_PROJECT_NAME": "online", "DATABASE_URL": "PRIVATE"}), \
                contextlib.redirect_stdout(output):
            runpy.run_path(str(SCRIPT), run_name="__main__")
        self.assertNotIn("PRIVATE", output.getvalue())
        return deployments

    def test_dry_run_and_idempotent_apply_rebuild(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.setup_repo(root); self.write(root)
            dev = root / "deploy_configs/dev.env"; before = dev.read_bytes()
            self.assertEqual(self.run_script(root), [])
            self.assertEqual(dev.read_bytes(), before)
            calls = self.run_script(root, "--apply", "--rebuild")
            self.assertEqual(len(calls), 1)
            command, kwargs = calls[0]
            self.assertEqual(kwargs["cwd"], root.resolve())
            self.assertIn(RELEASE, command)
            self.assertEqual(command[command.index("--image-name") + 1], root.name)
            self.assertNotIn("GROW_DEPLOY_ENABLED", kwargs["env"])
            self.assertNotIn("COMPOSE_PROJECT_NAME", kwargs["env"])
            self.assertNotIn("DATABASE_URL", kwargs["env"])
            self.assertIn(b"LIGHTTICK_ENABLED=1", dev.read_bytes())
            self.assertIn(b"PRIVATE", dev.read_bytes())
            self.assertEqual(dev.stat().st_mode & 0o777, 0o600)
            self.run_script(root, "--apply")
            backups = list((root / "private-home/.zook-private/lighttick-dev").iterdir())
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), before)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)

    def test_unsafe_targets_stop_before_env_change(self):
        scenarios = ["database", "direct", "redis", "files", "empty-files", "project", "state", "group", "missing", "image", "revision", "head", "dirty", "no-online", "env-slot", "query-host", "relative-files"]
        for scenario in scenarios:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); self.setup_repo(root)
                if scenario == "database": self.dev["DATABASE_URL"] = self.prod["DATABASE_URL"]
                if scenario == "direct": self.dev["DIRECT_URL"] = self.prod["DATABASE_URL"]
                if scenario == "redis": self.dev["REDIS_URL"] = "redis://127.0.0.1/00"
                if scenario == "files": self.dev["ZOOK_APP_RUN_DATA_HOST_PATH"] = self.prod["ZOOK_APP_RUN_DATA_HOST_PATH"]
                if scenario == "empty-files": self.dev["ZOOK_APP_RUN_DATA_HOST_PATH"] = self.prod["ZOOK_APP_RUN_DATA_HOST_PATH"] = ""
                if scenario == "project": self.dev["COMPOSE_PROJECT_NAME"] = self.prod["COMPOSE_PROJECT_NAME"] = "same"
                if scenario == "env-slot": self.dev["APP_ENV"] = "online"
                if scenario == "query-host":
                    self.dev["DATABASE_URL"] = "postgresql://qa:PRIVATE@dev-host/shared?host=online-host"
                    self.prod["DATABASE_URL"] = "postgresql://qa:PRIVATE@online-host/shared"
                if scenario == "relative-files":
                    self.dev["ZOOK_APP_RUN_DATA_HOST_PATH"] = "./same-data"
                    self.prod["ZOOK_APP_RUN_DATA_HOST_PATH"] = str(root / "same-data")
                if scenario == "state": self.active["commit"] = "f" * 40
                if scenario == "group": self.active["images"]["grow"] = "grow:active"
                self.docker_mode = scenario
                self.write(root); path = root / "deploy_configs/dev.env"; before = path.read_bytes()
                if scenario == "no-online": (root / "deploy_configs/online.env").unlink()
                with self.assertRaises(SystemExit): self.run_script(root, "--apply", "--rebuild")
                self.assertEqual(path.read_bytes(), before)

    def test_custom_image_is_passed_to_original_deployer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.setup_repo(root)
            self.dev['DOCKER_IMAGE_NAME'] = 'custom-dev-image'
            self.prod['COMPOSE_PROJECT_NAME'] = root.name + '-dev'
            self.write(root)
            command, kwargs = self.run_script(root, '--apply', '--rebuild')[0]
            self.assertEqual(command[command.index('--image-name') + 1], 'custom-dev-image')


if __name__ == "__main__":
    unittest.main()
