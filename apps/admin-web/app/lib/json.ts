export function parseConfigText(rawText: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(formatJsonParseError(rawText, error));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置根节点必须是 JSON object。");
  }

  return parsed as Record<string, unknown>;
}

export function safeParseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function formatJsonParseError(rawText: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "请输入合法的 JSON。";
  const positionMatch = /position\s+(\d+)/i.exec(message);
  if (!positionMatch) {
    return "请输入合法的 JSON。";
  }

  const position = Number(positionMatch[1]);
  if (!Number.isInteger(position) || position < 0) {
    return "请输入合法的 JSON。";
  }

  const { line, column } = getJsonLineColumn(rawText, position);
  return `JSON 语法错误：第 ${line} 行，第 ${column} 列。`;
}

function getJsonLineColumn(text: string, position: number) {
  const normalized = text.slice(0, position);
  const lines = normalized.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}
