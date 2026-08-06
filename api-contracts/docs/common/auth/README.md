# Common Auth Contract

Source of truth:
- `openapi/common/auth.yaml`

Current coverage includes:
- password login
- email-code login / register / password reset
- sms-code login / register / password reset
- password set / change
- refresh / logout
- QR login

Notes:
- SMS auth mirrors the email auth shape and currently treats phone as an account identifier.
- SMS and email verification-code flows share the same high-level session semantics, but use different request shapes and different verification-code cache namespaces.
- Tencent captcha capability may exist in server implementations, but is not part of the current public auth contract unless explicitly added here.

- When `test=true` on SMS code-send endpoints, the backend should still generate and cache the code but must skip the actual SMS provider call.
