"""Read a private KEY=value file without changing the process environment."""
import json
import re
from pathlib import Path


def env_file(path: Path) -> dict[str, str]:
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError('Invalid runtime env format; use KEY=value.')
        key, value = line.split('=', 1)
        if not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError('Invalid runtime env key.')
        value = value.strip()
        if value.startswith('"'):
            value = json.loads(value)
        elif len(value) >= 2 and value[0] == value[-1] == "'":
            value = value[1:-1]
        if not isinstance(value, str) or '\x00' in value or '\n' in value or '\r' in value:
            raise ValueError('Runtime env values must be single-line.')
        values[key] = value
    return values

