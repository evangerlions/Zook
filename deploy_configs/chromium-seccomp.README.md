# Chromium container sandbox profile

Vendored without modification from Microsoft's Playwright project on 2026-11-15:
https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json

SHA-256: `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`

License: Apache-2.0; the upstream license is retained in `chromium-seccomp.LICENSE`.

Only the API container uses this profile. It retains the default deny action
and permits the namespace syscalls required by Chromium's sandbox. See the
[official Docker instructions](https://playwright.dev/docs/docker).

Validate the Compose contract with:
`python3 -m unittest build_scripts/tests/test_billing_browser_runtime.py`
