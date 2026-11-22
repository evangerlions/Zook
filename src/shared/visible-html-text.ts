import { Parser } from "htmlparser2";
/** Bounded streaming text extraction; never renders or executes source markup. */
export function visibleHtmlText(
  raw: string,
  maxCharacters = 100000,
  mode: "paragraphs" | "legacy" = "paragraphs",
): string {
  const chunks: string[] = [];
  let hidden = 0,
    characters = 0,
    tags = 0;
  const hiddenTags = new Set(
      mode === "legacy" ? ["script", "style"] : ["script", "style", "noscript"],
    ),
    blocks = new Set([
      "p",
      "div",
      "section",
      "article",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "li",
      "blockquote",
      "pre",
    ]);
  const append = (s: string) => {
    characters += s.length;
    if (characters > maxCharacters + 160000)
      throw Object.assign(Error("提取的文本超过阅读容量，未截断保存。"), {
        statusCode: 413,
      });
    chunks.push(s);
  };
  const parser = new Parser(
    {
      onopentag(name) {
        if (++tags > 40000)
          throw Object.assign(Error("来源标记超过容量。"), { statusCode: 413 });
        if (hiddenTags.has(name)) hidden++;
        if (!hidden) {
          if (mode === "legacy") append(" ");
          else if (name === "br" || blocks.has(name)) append("\n\n");
        }
      },
      onclosetag(name, implied) {
        if (hiddenTags.has(name)) hidden = Math.max(0, hidden - 1);
        else if (!hidden) {
          if (mode === "legacy" && !implied) append(" ");
          else if (mode !== "legacy" && blocks.has(name)) append("\n\n");
        }
      },
      oncomment() {
        if (mode === "legacy" && !hidden) append(" ");
      },
      ontext(value) {
        if (!hidden) append(value);
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.end(raw);
  const result =
    mode === "legacy"
      ? chunks.join("").replace(/\s+/g, " ")
      : chunks
          .join("")
          .replace(/[\t ]+/g, " ")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
  if (result.length > maxCharacters)
    throw Object.assign(Error("提取的文本超过阅读容量，未截断保存。"), {
      statusCode: 413,
    });
  return result;
}
