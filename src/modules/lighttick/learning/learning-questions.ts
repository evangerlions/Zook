/** Legacy-compatible exercise identities; derived only from immutable lesson text. */
export function learningQuestions(input: string) {
  const content = input
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, "")
    .replace(/^```[\s\S]*?^```[^\n]*/gm, "");
  const headings = [...content.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)],
    result: {
      id: string;
      prompt: string;
      answer: string;
    }[] = [];
  let excluded = 0;
  const cut = (v: string, n: number) => Array.from(v).slice(0, n).join("");
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i],
      title = cut(h[2].replace(/[*_`]/g, "").trim(), 180),
      level = h[1].length;
    if (excluded && level <= excluded) excluded = 0;
    if (/参考答案|参考分析|答案解析|答案与解释/.test(title)) excluded = level;
    if (
      excluded ||
      !/练习|阅读理解|引导问题|思考题|思考问题|复盘问题/.test(title)
    )
      continue;
    const end =
        headings.slice(i + 1).find((v) => v[1].length <= level)?.index ??
        content.length,
      section = content.slice(h.index! + h[0].length, end);
    if (/^#{2,6}\s+.*(?:练习|阅读理解|思考题)/m.test(section)) continue;
    let prompts = [...section.matchAll(/^\s*(?:[-*+] |\d+[.)] )(.+)$/gm)].map(
      (v) => v[1],
    );
    if (prompts.length && prompts.every((p) => /^\[[ xX]\]/.test(p))) continue;
    if (
      /练习\s*[\d一二三四五六七八九十]/.test(title) ||
      prompts.length < 1 ||
      prompts.length > 10
    )
      prompts = [title];
    prompts.forEach((prompt, j) =>
      result.push({
        id: title + ":" + (j + 1),
        prompt: title + " · " + cut(prompt, 700),
        answer: "",
      }),
    );
  }
  return result.slice(0, 100).length
    ? result.slice(0, 100)
    : [{ id: "我的练习:1", prompt: "本课练习或应用思考", answer: "" }];
}
