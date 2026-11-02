import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "build_and_push_docker.py"
spec = importlib.util.spec_from_file_location("deployment_release_test", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ReleaseStateTest(unittest.TestCase):
    def test_incompatible_topology_is_rejected_before_docker_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            state.write_text(json.dumps({"active_release": {"group_version": 1, "images": {"api": "old"}}}))
            with patch.object(deploy, "get_service_image") as image:
                with self.assertRaisesRegex(deploy.ScriptError, "Unsupported structured release state"):
                    deploy.resolve_current_release("qa", state)
                image.assert_not_called()

    def test_standard_release_recovery_still_works(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            release = {"image": "zook:stable", "commit": "a" * 40}
            state.write_text(json.dumps({"active_release": release}))
            with patch.object(deploy, "get_service_image", return_value=None):
                self.assertEqual(deploy.resolve_current_release("qa", state), release)


if __name__ == "__main__":
    unittest.main()
