#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml


SPECS: dict[str, list[str]] = {
    "common/auth.yaml": [
        "PasswordLoginRequest",
        "EmailCodeRequest",
        "SmsCodeRequest",
        "EmailLoginRequest",
        "SmsLoginRequest",
        "SetPasswordRequest",
        "ResetPasswordRequest",
        "ChangePasswordRequest",
        "RegisterRequest",
        "QrLoginCreateRequest",
        "RefreshRequest",
        "LogoutRequest",
        "AuthAcceptedData",
        "UserSummary",
        "AuthSessionData",
        "QrLoginCreateData",
        "QrLoginConfirmData",
        "QrLoginPollData",
    ],
    "common/users.yaml": [
        "CurrentUserData",
    ],
    "common/analytics.yaml": [
        "AnalyticsEventInput",
        "AnalyticsBatchRequest",
        "AnalyticsAcceptedData",
    ],
    "common/files.yaml": [
        "FilePresignRequest",
        "FilePresignData",
        "FileConfirmRequest",
        "FileConfirmData",
    ],
    "common/logs.yaml": [
        "LogPolicyData",
        "LogPullTaskData",
        "LogAckRequest",
        "LogFailRequest",
        "LogUploadData",
        "LogNoDataAckData",
        "LogFailData",
    ],
    "common/notifications.yaml": [
        "NotificationSendRequest",
        "NotificationQueuedData",
    ],
    "ainovel/public-config.yaml": [
        "KickoffPublicConfig",
        "AINovelPublicConfig",
        "PublicConfigData",
    ],
}

ALIASES: dict[str, str] = {
    "AuthSuccessPayload": "AuthSessionData",
    "CurrentUserDocument": "CurrentUserData",
    "PublicAppConfigDocument": "PublicConfigData",
    "QrLoginCreateResult": "QrLoginCreateData",
    "QrLoginConfirmResult": "QrLoginConfirmData",
    "QrLoginPollResult": "QrLoginPollData",
    "FilePresignResult": "FilePresignData",
    "FileConfirmResult": "FileConfirmData",
    "LogPolicyResult": "LogPolicyData",
    "LogPullTaskResult": "LogPullTaskData",
    "LogUploadResult": "LogUploadData",
    "LogNoDataAckResult": "LogNoDataAckData",
    "LogFailResult": "LogFailData",
}


def load_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text())


def resolve_ref(schema: Any, current_path: Path, cache: dict[Path, dict[str, Any]]) -> Any:
    if isinstance(schema, dict) and "$ref" in schema:
        ref = schema["$ref"]
        if ref.startswith("#/"):
            doc = cache[current_path]
            target: Any = doc
            for part in ref[2:].split("/"):
                target = target[part]
            return resolve_ref(target, current_path, cache)
        rel_path, local_ref = ref.split("#", 1)
        target_path = (current_path.parent / rel_path).resolve()
        if target_path not in cache:
            cache[target_path] = load_yaml(target_path)
        target: Any = cache[target_path]
        for part in local_ref.lstrip("/").split("/"):
            target = target[part]
        return resolve_ref(target, target_path, cache)
    if isinstance(schema, dict):
        return {k: resolve_ref(v, current_path, cache) for k, v in schema.items()}
    if isinstance(schema, list):
        return [resolve_ref(v, current_path, cache) for v in schema]
    return schema


def ts_type(schema: Any, name_hint: str = "") -> str:
    if not isinstance(schema, dict):
        return "unknown"

    if "enum" in schema:
        return " | ".join(json.dumps(v) for v in schema["enum"])

    if "oneOf" in schema:
        return " | ".join(ts_type(item, name_hint) for item in schema["oneOf"])

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        mapped = []
        for item in schema_type:
            if item == "null":
                mapped.append("null")
            else:
                mapped.append(ts_type({"type": item}, name_hint))
        return " | ".join(mapped)

    if schema_type == "string":
        return "string"
    if schema_type == "integer" or schema_type == "number":
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "array":
        return f"{ts_type(schema.get('items', {}), name_hint)}[]"
    if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        lines: list[str] = ["{"]
        for key, value in props.items():
            optional = "" if key in required else "?"
            lines.append(f"  {json.dumps(key)}{optional}: {ts_type(value, key)};")
        additional = schema.get("additionalProperties")
        if additional is True:
            lines.append('  [key: string]: unknown;')
        elif isinstance(additional, dict):
            lines.append(f"  [key: string]: {ts_type(additional, name_hint)};")
        lines.append("}")
        return "\n".join(lines)
    return "unknown"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    workspace_root = Path(args.workspace_root).resolve()
    openapi_root = workspace_root / "api" / "openapi"
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cache: dict[Path, dict[str, Any]] = {}
    blocks: list[str] = [
        "// AUTO-GENERATED FILE. DO NOT EDIT.",
        "// Generated from workspace OpenAPI contracts for Zook public API boundaries.",
        "",
    ]

    generated_names: list[str] = []
    used_export_names: set[str] = set()

    for rel_spec, schema_names in SPECS.items():
        spec_path = (openapi_root / rel_spec).resolve()
        spec_prefix = rel_spec.replace("/", "_").replace(".yaml", "")
        if spec_path not in cache:
          cache[spec_path] = load_yaml(spec_path)
        doc = cache[spec_path]
        schemas = doc["components"]["schemas"]
        for schema_name in schema_names:
            resolved = resolve_ref(schemas[schema_name], spec_path, cache)
            export_name = schema_name
            if export_name in used_export_names:
                export_name = f"{spec_prefix}_{schema_name}"
            used_export_names.add(export_name)
            schema_const_name = f"{export_name}Schema"
            blocks.append(f"export const {schema_const_name} = {json.dumps(resolved, ensure_ascii=False, indent=2)} as const;")
            blocks.append("")
            blocks.append(f"export type {export_name} = {ts_type(resolved, export_name)};")
            blocks.append("")
            generated_names.append(export_name)

    for alias, target in ALIASES.items():
        blocks.append(f"export type {alias} = {target};")
    blocks.append("")
    blocks.append(
        "export const GeneratedPublicContractNames = " +
        json.dumps(sorted(generated_names), ensure_ascii=False, indent=2) +
        " as const;"
    )
    blocks.append("")

    out_path.write_text("\n".join(blocks))


if __name__ == "__main__":
    main()
