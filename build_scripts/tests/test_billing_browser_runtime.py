import json
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]


class BillingBrowserRuntimeTest(unittest.TestCase):
    def test_api_supports_chromium_sandbox_without_expanding_other_services(self):
        services = yaml.safe_load((ROOT / "compose.yaml").read_text())["services"]
        profile_path = "deploy_configs/chromium-seccomp.json"
        self.assertEqual(services["api"].get("security_opt"), [f"seccomp=./{profile_path}"])
        self.assertTrue(services["api"].get("init"))
        for service in services.values():
            self.assertFalse(service.get("privileged", False))
            self.assertNotIn("SYS_ADMIN", service.get("cap_add", []))
        for name in ("worker", "admin-web"):
            self.assertNotIn("security_opt", services[name])
        profile = json.loads((ROOT / profile_path).read_text())
        self.assertEqual(profile["defaultAction"], "SCMP_ACT_ERRNO")
        allowed = {
            name
            for rule in profile["syscalls"]
            if rule["action"] == "SCMP_ACT_ALLOW" and not rule.get("includes") and not rule.get("args")
            for name in rule["names"]
        }
        self.assertTrue({"clone", "setns", "unshare"}.issubset(allowed))
        self.assertNotIn("mount", allowed)


if __name__ == "__main__":
    unittest.main()
