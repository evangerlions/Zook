#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
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
    supported_locales = (
        "en-US", "zh-CN", "zh-TW", "ja-JP", "es-ES", "pt-BR",
        "ko-KR", "de-DE", "fr-FR", "hi-IN", "id-ID", "it-IT",
        "tr-TR", "vi-VN", "th-TH", "pl-PL", "nl-NL", "sv-SE",
        "bn-BD", "sw-KE",
    )
    for locale in supported_locales:
      path = source_dir / f"public-api.{locale}.json"
      locales[locale] = json.loads(path.read_text())

    reference = locales["en-US"]
    reference_keys = set(reference)
    for locale, messages in locales.items():
      if set(messages) != reference_keys:
        raise SystemExit(f"{locale} keys must exactly match en-US")
      for key, message in messages.items():
        placeholders = set(re.findall(r"\\{(\\w+)\\}", message))
        reference_placeholders = set(re.findall(r"\\{(\\w+)\\}", reference[key]))
        if placeholders != reference_placeholders:
          raise SystemExit(f"{locale} placeholders for {key} must match en-US")

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
