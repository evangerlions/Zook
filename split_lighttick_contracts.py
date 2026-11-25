#!/usr/bin/env python3
"""C2 合同拆分：从 api.yaml 拆出 goal-coach.yaml 与 learning.yaml，只移 path 不改 schema。

用法:
  python3 split_lighttick_contracts.py --dry-run   # 只打印分类与 tag，不写文件
  python3 split_lighttick_contracts.py             # 实际拆分
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path("api-contracts/openapi/lighttick")
API = ROOT / "api.yaml"

GOAL_PREFIXES = (
    "/api/v1/lighttick/goals",
    "/api/v1/lighttick/plans",
    "/api/v1/lighttick/plan-runs",
    "/api/v1/lighttick/planning-sessions",
    "/api/v1/lighttick/proposals",
    "/api/v1/lighttick/dna/insights",
    "/api/v1/lighttick/ai/evidence",
    "/api/v1/lighttick/execution-facts",
)
LEARNING_PREFIXES = (
    "/api/v1/lighttick/learning",
    "/api/v1/lighttick/learning-library",
)


def classify(url: str) -> str:
    if url.startswith(LEARNING_PREFIXES):
        return "learning"
    if url.startswith(GOAL_PREFIXES):
        return "goal"
    return "keep"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    lines = API.read_text().splitlines(keepends=True)

    paths_idx = components_idx = None
    for i, line in enumerate(lines):
        s = line.rstrip("\n")
        if s == "paths:" and paths_idx is None and i > 10:
            paths_idx = i
        elif s == "components:" and paths_idx is not None and components_idx is None:
            components_idx = i
            break
    if paths_idx is None or components_idx is None:
        sys.exit("无法定位 paths / components")

    # 解析头部 tag 定义（paths 之前）
    tag_defs: dict[str, list[str]] = {}
    i = 0
    while i < paths_idx:
        line = lines[i]
        m = re.match(r"^- name: (\S+)\s*$", line)
        if m:
            name = m.group(1)
            block = [line]
            j = i + 1
            while j < paths_idx:
                l2 = lines[j]
                if re.match(r"^- name:", l2) or re.match(r"^[a-z]+:", l2):
                    break
                block.append(l2)
                j += 1
            tag_defs[name] = block
            i = j
        else:
            i += 1

    # 识别 path 块
    blocks: list[tuple[int, int, str]] = []
    i = paths_idx + 1
    cur_start = None
    cur_url = None
    while i < components_idx:
        line = lines[i]
        if line.startswith("  /api/"):
            if cur_start is not None:
                blocks.append((cur_start, i, cur_url))
            cur_start = i
            cur_url = line.strip().rstrip(":")
        i += 1
    if cur_start is not None:
        blocks.append((cur_start, components_idx, cur_url))

    goal_blocks = [b for b in blocks if classify(b[2]) == "goal"]
    learning_blocks = [b for b in blocks if classify(b[2]) == "learning"]
    keep_blocks = [b for b in blocks if classify(b[2]) == "keep"]

    def collect_tags(blk_list):
        tags = set()
        for s, e, _url in blk_list:
            j = s
            while j < e:
                line = lines[j]
                m = re.match(r"\s*tags:\s*\[([^\]]*)\]\s*$", line)
                if m:
                    for t in re.findall(r"[A-Za-z][A-Za-z0-9_-]*", m.group(1)):
                        tags.add(t)
                    j += 1
                    continue
                m = re.match(r"^(\s*)tags:\s*$", line)
                if m:
                    tag_indent = len(m.group(1))
                    k = j + 1
                    while k < e:
                        mm = re.match(r"^(\s*)-\s+([A-Za-z][A-Za-z0-9_-]*)\s*$", lines[k])
                        if mm and len(mm.group(1)) >= tag_indent:
                            tags.add(mm.group(2))
                            k += 1
                        else:
                            break
                    j = k
                    continue
                j += 1
        return tags

    goal_tags = collect_tags(goal_blocks)
    learning_tags = collect_tags(learning_blocks)

    def render_tags(tag_names):
        out = ["tags:\n"]
        for name in sorted(tag_names):
            if name in tag_defs:
                out.extend(tag_defs[name])
            else:
                out.append(f"- name: {name}\n")
                out.append(f"  description: {name} operations.\n")
        return "".join(out)

    def render_skeleton(title, tag_names, blk_list):
        header = (
            "openapi: 3.1.1\n"
            "info:\n"
            f"  title: {title}\n"
            "  version: 0.1.0\n"
            "  license:\n"
            "    name: Proprietary\n"
            "    url: https://docs.zook.dev/legal/api-license\n"
            "servers:\n"
            "- url: https://api.zook.dev\n"
            "security:\n"
            "- bearerAuth: []\n"
        )
        out = header + render_tags(tag_names) + "paths:\n"
        for s, e, _url in blk_list:
            for j in range(s, e):
                line = lines[j]
                line = re.sub(r"\$ref: '#/components/", "$ref: ./api.yaml#/components/", line)
                line = re.sub(r"(\$ref: \./api\.yaml#/components/[^']*)'", r"\1", line)
                out += line
        out += (
            "components:\n"
            "  securitySchemes:\n"
            "    bearerAuth:\n"
            "      type: http\n"
            "      scheme: bearer\n"
            "      bearerFormat: opaque\n"
        )
        return out

    goal_out = render_skeleton("LightTick Goal Coach", goal_tags, goal_blocks)
    learning_out = render_skeleton("LightTick Learning", learning_tags, learning_blocks)

    new_api = lines[: paths_idx + 1]
    for s, e, _url in keep_blocks:
        new_api.extend(lines[s:e])
    new_api.extend(lines[components_idx:])

    print(f"total paths: {len(blocks)}")
    print(f"goal paths: {len(goal_blocks)}")
    print(f"learning paths: {len(learning_blocks)}")
    print(f"keep paths: {len(keep_blocks)}")
    print(f"goal tags: {sorted(goal_tags)}")
    print(f"learning tags: {sorted(learning_tags)}")
    print(f"undefined goal tags: {sorted(t for t in goal_tags if t not in tag_defs)}")
    print(f"undefined learning tags: {sorted(t for t in learning_tags if t not in tag_defs)}")

    if args.dry_run:
        print("[dry-run] 未写文件")
        return

    (ROOT / "goal-coach.yaml").write_text(goal_out)
    (ROOT / "learning.yaml").write_text(learning_out)
    API.write_text("".join(new_api))
    print("已写入 goal-coach.yaml / learning.yaml / api.yaml")


if __name__ == "__main__":
    main()
