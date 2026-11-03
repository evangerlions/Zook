"""Mount only deployment-allowed Alipay Secrets using the fixed runtime layout."""
import json
import os
from pathlib import Path


KEY_FILES = ("app-private-key.pem", "alipay-public-key.pem")


def _deployment(path: Path) -> str:
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = raw.strip().removeprefix("export ").partition("=")
        if separator and key.strip() in ("DEPLOY_SLOT", "APP_ENV"):
            values[key.strip()] = value.strip().strip("\"'")
    return (values.get("DEPLOY_SLOT") or values.get("APP_ENV") or "").lower()


def prepare(state_dir: Path, app_env_file: Path, *, slot: str | None = None, home: Path | None = None) -> Path | None:
    deployment = (slot or _deployment(app_env_file)).strip().lower()
    environments = ("production", "sandbox") if deployment in ("local", "dev", "development", "test") else ("production",)
    volumes = []
    for environment in environments:
        directory = (home or Path.home()) / ".zook/secrets/ainovel-alipay" / environment
        if not directory.exists():
            continue
        for filename in KEY_FILES:
            key_file = directory / filename
            if not key_file.is_file() or not os.access(key_file, os.R_OK):
                raise ValueError(f"Alipay {environment} key file is missing or unreadable: {filename}")
        volumes.append({"type": "bind", "source": str(directory),
                        "target": f"/run/secrets/ainovel-alipay/{environment}",
                        "read_only": True, "bind": {"create_host_path": False}})
    if not volumes:
        return None
    overlay = {"services": {service: {"volumes": volumes} for service in ("api", "worker")}}
    state_dir.mkdir(parents=True, exist_ok=True)
    path = state_dir / "alipay-keys.compose.json"
    path.write_text(json.dumps(overlay, indent=2) + "\n", encoding="utf-8")
    return path
