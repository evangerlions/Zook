"""Materialize slot-local Alipay mounts without copying keys or adding env fields."""
import json
import os
from pathlib import Path


CONTAINER_DIRECTORY = "/run/secrets/ainovel-alipay"
KEY_FILES = {
    "ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH": "app-private-key.pem",
    "ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH": "alipay-public-key.pem",
}


def _read_configuration(path: Path) -> dict[str, str]:
    fields = {"ALIPAY_AI_NOVEL_ENVIRONMENT", *KEY_FILES}
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip().removeprefix("export ").strip()
        key, separator, value = line.partition("=")
        if separator and key.strip() in fields:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def prepare(state_dir: Path, app_env_file: Path, *, home: Path | None = None) -> Path | None:
    app_env = _read_configuration(app_env_file)
    mode = app_env.get("ALIPAY_AI_NOVEL_ENVIRONMENT", "")
    if not mode and not any(app_env.get(key) for key in KEY_FILES):
        return None
    if mode not in ("sandbox", "production"):
        raise ValueError("Alipay environment must be sandbox or production before deployment.")
    for key, filename in KEY_FILES.items():
        if app_env.get(key, "") != f"{CONTAINER_DIRECTORY}/{filename}":
            raise ValueError("Alipay container key paths must use /run/secrets/ainovel-alipay.")

    directory = (home or Path.home()) / ".zook/secrets/ainovel-alipay" / mode
    for filename in KEY_FILES.values():
        key_file = directory / filename
        if not key_file.is_file() or not os.access(key_file, os.R_OK):
            raise ValueError(f"Alipay {mode} key file is missing or unreadable: {filename}")

    volume = {"type": "bind", "source": str(directory), "target": CONTAINER_DIRECTORY,
              "read_only": True, "bind": {"create_host_path": False}}
    overlay = {"services": {service: {"volumes": [volume]} for service in ("api", "worker")}}
    state_dir.mkdir(parents=True, exist_ok=True)
    path = state_dir / "alipay-keys.compose.json"
    path.write_text(json.dumps(overlay, indent=2) + "\n", encoding="utf-8")
    return path
