#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def resolve_workspace_root(value: str | None) -> Path:
    if value:
        return Path(value).resolve()
    current = Path(__file__).resolve()
    for parent in current.parents:
        marker = parent / 'PROJECT_PATHS.local.toml'
        if marker.exists():
            return parent.resolve()
    raise SystemExit('workspace root not found; pass --workspace-root explicitly')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    workspace_root = resolve_workspace_root(args.workspace_root)
    source_dir = workspace_root / "projects" / "zook" / "product" / "common" / "backend-i18n"
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    locales = {}
    for locale in ("en-US", "zh-CN"):
      path = source_dir / f"public-api.{locale}.json"
      locales[locale] = json.loads(path.read_text())

    content = [
        "// AUTO-GENERATED FILE. DO NOT EDIT.",
        "// Generated from workspace backend i18n assets.",
        "",
        f"export const PublicApiMessages = {json.dumps(locales, ensure_ascii=False, indent=2)} as const;",
        "",
        "export type PublicApiMessageLocale = keyof typeof PublicApiMessages;",
    ]
    out_path.write_text("\n".join(content))


if __name__ == "__main__":
    main()
