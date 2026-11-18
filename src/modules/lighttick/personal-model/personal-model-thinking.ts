/** Forward the scene's no-thinking request only for verified hybrid models. */
export function dashscopeThinkingOptions(
  baseUrl: string,
  modelName: string,
  options: Record<string, unknown> = {},
) {
  const host = new URL(baseUrl).hostname;
  const dashscope =
    host === "dashscope.aliyuncs.com" ||
    host.endsWith(".dashscope.aliyuncs.com");
  const hybrid =
    modelName === "qwen3.7-plus" || modelName.startsWith("qwen3.7-plus-");
  return dashscope && hybrid && options.enable_thinking === false
    ? { enable_thinking: false }
    : {};
}
