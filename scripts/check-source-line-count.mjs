#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MAX_LINES = 599;
const SOURCE_ROOTS = ["src", "apps/admin-web/app", "apps/admin-web/server.ts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const LEGACY_OVERSIZED_ALLOWLIST = new Set([
  "src/modules/ai-novel/ai-novel-llm.service.ts",
  "src/modules/ai-novel/prompts/ai-novel-prompt-tools.ts",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".react-router",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "testing",
]);

const root = process.cwd();

function hasSourceExtension(path) {
  return [...SOURCE_EXTENSIONS].some((extension) => path.endsWith(extension));
}

function isExcluded(path) {
  const segments = path.split("/");
  const lowerPath = path.toLowerCase();

  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return true;
  }

  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerPath)) {
    return true;
  }

  return segments.some((segment) => {
    const lower = segment.toLowerCase();
    return (
      lower === "test" ||
      lower === "tests" ||
      lower === "__tests__"
    );
  });
}

function collectFiles(path, files = []) {
  const relativePath = relative(root, path).split("\\").join("/");

  if (isExcluded(relativePath)) {
    return files;
  }

  const stats = statSync(path);
  if (stats.isFile()) {
    if (hasSourceExtension(relativePath)) {
      files.push(relativePath);
    }
    return files;
  }

  for (const entry of readdirSync(path)) {
    collectFiles(join(path, entry), files);
  }

  return files;
}

const sourceFiles = SOURCE_ROOTS.flatMap((sourceRoot) =>
  collectFiles(join(root, sourceRoot)),
);

const oversized = sourceFiles
  .map((path) => ({
    path,
    lines: countLines(readFileSync(join(root, path), "utf8")),
  }))
  .filter((item) => !LEGACY_OVERSIZED_ALLOWLIST.has(item.path))
  .filter((item) => item.lines > MAX_LINES)
  .sort((left, right) => right.lines - left.lines);

if (oversized.length === 0) {
  console.log(`source line-count gate passed: ${sourceFiles.length} files <= ${MAX_LINES} lines`);
  process.exit(0);
}

console.error(`source line-count gate failed: ${oversized.length} files exceed ${MAX_LINES} lines`);
for (const item of oversized) {
  console.error(`${String(item.lines).padStart(5)}  ${item.path}`);
}
process.exit(1);

function countLines(content) {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trailingNewlineOffset = normalized.endsWith("\n") ? 1 : 0;
  return normalized.split("\n").length - trailingNewlineOffset;
}
