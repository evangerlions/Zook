#!/usr/bin/env python3
"""
AINovel stream probe.

What it does:
1. Logs in to the admin API and reveals the ai_novel app log secret.
2. Logs in with the seeded test account.
3. Encrypts an ai_novel chat request.
4. Calls the streaming endpoint and prints every SSE chunk received.
5. For each chunk, prints the delta from the first chunk in human-readable form.

No third-party Python packages are required. AES-256-GCM encryption/decryption is
delegated to the local Node runtime that already exists in this workspace.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "http://127.0.0.1:3100"
DEFAULT_APP_ID = "ai_novel"
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "Admin123456!"
DEFAULT_SENSITIVE_CODE = "199510"
DEFAULT_USER_ACCOUNT = "alice@example.com"
DEFAULT_USER_PASSWORD = "Password1234"
DEFAULT_TASK_TYPE = "continue_chapter"
DEFAULT_USER_PROMPT = "Write a short novel opening paragraph about a girl walking into a rain-soaked city."


NODE_CRYPTO_SNIPPET = r"""
const crypto = require("node:crypto");

const mode = process.argv[1];
const keyBase64 = process.argv[2];
const payload = process.argv[3];
const key = Buffer.from(keyBase64, "base64");

if (key.length !== 32) {
  throw new Error(`Expected 32-byte AES key, got ${key.length}`);
}

if (mode === "encrypt") {
  const plaintext = Buffer.from(payload, "utf8");
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  process.stdout.write(JSON.stringify({
    encrypted: true,
    algorithm: "aes-256-gcm",
    nonceBase64: nonce.toString("base64"),
    ciphertextBase64: Buffer.concat([ciphertext, tag]).toString("base64"),
  }));
  process.exit(0);
}

if (mode === "decrypt") {
  const envelope = JSON.parse(payload);
  const nonce = Buffer.from(String(envelope.nonceBase64), "base64");
  const body = Buffer.from(String(envelope.ciphertextBase64), "base64");
  const ciphertext = body.subarray(0, body.length - 16);
  const authTag = body.subarray(body.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  process.stdout.write(plaintext.toString("utf8"));
  process.exit(0);
}

throw new Error(`Unknown mode: ${mode}`);
"""


@dataclass
class StreamProbeConfig:
  base_url: str
  app_id: str
  admin_username: str
  admin_password: str
  sensitive_code: str
  user_account: str
  user_password: str
  task_type: str
  prompt: str
  timeout: float


class JsonHttpClient:
  def __init__(self) -> None:
    self.cookie_jar = CookieJar()
    self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

  def request_json(
    self,
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
  ) -> tuple[int, dict[str, Any], dict[str, str]]:
    payload = None
    normalized_headers = {
      "accept": "application/json",
    }
    if headers:
      normalized_headers.update(headers)
    if body is not None:
      payload = json.dumps(body).encode("utf-8")
      normalized_headers.setdefault("content-type", "application/json")

    request = urllib.request.Request(url=url, data=payload, method=method.upper(), headers=normalized_headers)
    try:
      with self.opener.open(request, timeout=30) as response:
        text = response.read().decode("utf-8")
        return response.status, json.loads(text), dict(response.headers.items())
    except urllib.error.HTTPError as error:
      text = error.read().decode("utf-8")
      try:
        payload = json.loads(text)
      except json.JSONDecodeError:
        payload = {"raw": text}
      return error.code, payload, dict(error.headers.items())

  def open_stream(
    self,
    method: str,
    url: str,
    body: dict[str, Any],
    headers: dict[str, str],
  ):
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
      url=url,
      data=payload,
      method=method.upper(),
      headers={
        "accept": "text/event-stream, application/json",
        "content-type": "application/json",
        **headers,
      },
    )
    return self.opener.open(request, timeout=60)


def humanize_delta(seconds: float) -> str:
  if seconds < 1:
    return f"{seconds * 1000:.0f} ms"
  if seconds < 60:
    return f"{seconds:.2f} s"
  minutes = int(seconds // 60)
  remain = seconds - minutes * 60
  if minutes < 60:
    return f"{minutes} min {remain:.2f} s"
  hours = minutes // 60
  minutes = minutes % 60
  return f"{hours} h {minutes} min {remain:.2f} s"


def run_node_crypto(mode: str, key_base64: str, payload: str) -> str:
  result = subprocess.run(
    ["node", "-e", NODE_CRYPTO_SNIPPET, mode, key_base64, payload],
    capture_output=True,
    text=True,
    check=True,
  )
  return result.stdout


def encrypt_payload(payload: dict[str, Any], key_id: str, key_base64: str) -> dict[str, Any]:
  encrypted = json.loads(run_node_crypto("encrypt", key_base64, json.dumps(payload, ensure_ascii=False)))
  encrypted["keyId"] = key_id
  return encrypted


def decrypt_payload(envelope: dict[str, Any], key_base64: str) -> dict[str, Any]:
  plaintext = run_node_crypto("decrypt", key_base64, json.dumps(envelope, ensure_ascii=False))
  return json.loads(plaintext)


def expect_ok(status: int, payload: dict[str, Any], step: str) -> dict[str, Any]:
  if status != 200 or payload.get("code") != "OK":
    raise RuntimeError(f"{step} failed: status={status} payload={json.dumps(payload, ensure_ascii=False)}")
  return payload["data"]


def login_admin(client: JsonHttpClient, config: StreamProbeConfig) -> None:
  status, payload, _ = client.request_json(
    "POST",
    f"{config.base_url}/api/v1/admin/auth/login",
    {
      "username": config.admin_username,
      "password": config.admin_password,
    },
  )
  expect_ok(status, payload, "admin login")


def reveal_ai_key(client: JsonHttpClient, config: StreamProbeConfig) -> tuple[str, str]:
  status, payload, _ = client.request_json(
    "POST",
    f"{config.base_url}/api/v1/admin/sensitive-operations/request-code",
    {"operation": "app.log_secret.read"},
  )
  expect_ok(status, payload, "request sensitive operation code")

  status, payload, _ = client.request_json(
    "POST",
    f"{config.base_url}/api/v1/admin/sensitive-operations/verify",
    {
      "operation": "app.log_secret.read",
      "code": config.sensitive_code,
    },
  )
  expect_ok(status, payload, "verify sensitive operation code")

  status, payload, _ = client.request_json(
    "POST",
    f"{config.base_url}/api/v1/admin/apps/{config.app_id}/log-secret/reveal",
    {},
  )
  data = expect_ok(status, payload, "reveal ai log secret")
  return data["keyId"], data["secret"]


def login_user(client: JsonHttpClient, config: StreamProbeConfig) -> str:
  status, payload, _ = client.request_json(
    "POST",
    f"{config.base_url}/api/v1/auth/login",
    {
      "appId": config.app_id,
      "account": config.user_account,
      "password": config.user_password,
      "clientType": "app",
    },
    headers={
      "x-app-id": config.app_id,
    },
  )
  data = expect_ok(status, payload, "user login")
  return data["accessToken"]


def stream_chat(config: StreamProbeConfig) -> int:
  client = JsonHttpClient()
  login_admin(client, config)
  key_id, secret_base64 = reveal_ai_key(client, config)
  access_token = login_user(client, config)

  request_payload = {
    "taskType": config.task_type,
    "stream": True,
    "messages": [
      {
        "role": "user",
        "content": config.prompt,
      }
    ],
    "localDebugRequestPlaintext": config.prompt,
  }
  encrypted_body = encrypt_payload(request_payload, key_id, secret_base64)

  headers = {
    "authorization": f"Bearer {access_token}",
    "x-app-id": config.app_id,
    "host": urllib.parse.urlparse(config.base_url).netloc,
  }

  first_chunk_at: float | None = None
  chunk_count = 0
  buffered_lines: list[str] = []

  with client.open_stream(
    "POST",
    f"{config.base_url}/api/v1/{config.app_id}/ai/chat-completions",
    encrypted_body,
    headers,
  ) as response:
    if response.status != 200:
      raw = response.read().decode("utf-8", errors="replace")
      raise RuntimeError(f"stream request failed: status={response.status} body={raw}")

    for raw_line in response:
      line = raw_line.decode("utf-8", errors="replace")
      if not line.strip():
        if not buffered_lines:
          continue
        data_line = next((item for item in buffered_lines if item.startswith("data: ")), None)
        buffered_lines.clear()
        if not data_line:
          continue

        chunk_count += 1
        now = time.monotonic()
        if first_chunk_at is None:
          first_chunk_at = now
        delta_text = humanize_delta(now - first_chunk_at)
        payload = json.loads(data_line[len("data: "):])

        print(f"\n=== chunk #{chunk_count} | +{delta_text} ===")
        print("raw:")
        print(json.dumps(payload, ensure_ascii=False, indent=2))

        try:
          decrypted = decrypt_payload(payload, secret_base64)
          print("decrypted:")
          print(json.dumps(decrypted, ensure_ascii=False, indent=2))
        except Exception as error:  # noqa: BLE001
          print(f"decrypted: <failed: {error}>")

        sys.stdout.flush()
        continue

      buffered_lines.append(line.rstrip("\n"))

  return chunk_count


def parse_args() -> StreamProbeConfig:
  parser = argparse.ArgumentParser(description="Probe ai_novel streaming output.")
  parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
  parser.add_argument("--app-id", default=DEFAULT_APP_ID)
  parser.add_argument("--admin-username", default=DEFAULT_ADMIN_USERNAME)
  parser.add_argument("--admin-password", default=DEFAULT_ADMIN_PASSWORD)
  parser.add_argument("--sensitive-code", default=DEFAULT_SENSITIVE_CODE)
  parser.add_argument("--user-account", default=DEFAULT_USER_ACCOUNT)
  parser.add_argument("--user-password", default=DEFAULT_USER_PASSWORD)
  parser.add_argument("--task-type", default=DEFAULT_TASK_TYPE)
  parser.add_argument("--prompt", default=DEFAULT_USER_PROMPT)
  parser.add_argument("--timeout", type=float, default=60.0)
  args = parser.parse_args()
  return StreamProbeConfig(
    base_url=args.base_url.rstrip("/"),
    app_id=args.app_id,
    admin_username=args.admin_username,
    admin_password=args.admin_password,
    sensitive_code=args.sensitive_code,
    user_account=args.user_account,
    user_password=args.user_password,
    task_type=args.task_type,
    prompt=args.prompt,
    timeout=args.timeout,
  )


def main() -> int:
  config = parse_args()
  print(f"Base URL: {config.base_url}")
  print(f"App ID: {config.app_id}")
  print(f"User: {config.user_account}")
  print(f"TaskType: {config.task_type}")
  print("Starting stream probe...")
  sys.stdout.flush()

  try:
    chunk_count = stream_chat(config)
  except subprocess.CalledProcessError as error:
    print("Node AES helper failed:")
    print(error.stderr or error.stdout or str(error), file=sys.stderr)
    return 1
  except Exception as error:  # noqa: BLE001
    print(f"Probe failed: {error}", file=sys.stderr)
    return 1

  print(f"\nStream finished. Received {chunk_count} chunk(s).")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
