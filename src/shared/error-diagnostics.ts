export function describeUnknownError(
  error: unknown,
  prefix = "error",
): Record<string, unknown> {
  if (error === undefined || error === null) {
    return {};
  }

  const output: Record<string, unknown> = {
    [`${prefix}Type`]: typeof error,
  };
  if (error instanceof Error) {
    output[`${prefix}Constructor`] = error.constructor.name;
    output[`${prefix}Name`] = error.name;
    output[`${prefix}Message`] = error.message;
    output[`${prefix}Stack`] = previewLogValue(error.stack, 4000);
    output[`${prefix}CausePreview`] = previewErrorRelatedValue(
      (error as { cause?: unknown }).cause,
      2000,
    );
    return output;
  }

  output[`${prefix}ValuePreview`] = previewErrorRelatedValue(error, 2000);
  return output;
}

export function previewLogValue(
  value: unknown,
  limit = 1200,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = typeof value === "string" ? value : safeJsonStringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function previewErrorRelatedValue(
  value: unknown,
  limit: number,
): string | undefined {
  if (value instanceof Error) {
    return previewLogValue(
      {
        constructor: value.constructor.name,
        name: value.name,
        message: value.message,
        stack: value.stack,
      },
      limit,
    );
  }
  return previewLogValue(value, limit);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
