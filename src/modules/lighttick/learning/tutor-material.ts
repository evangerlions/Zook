import { digest, fail } from "./native-learning.validation.ts";

export const STRUCTURED_THINKING = "structured-thinking-v1";
const practice = {
  id: "conclusion-and-two-facts-v1",
  prompt: "团队收到 12 条客户反馈，9 条已核实，剩余 3 条仍待补数据。请先写一句给负责人看的结论，再用两条可核对的事实支撑它。",
  standard: "结论须保留仍待核实的范围或给出与其一致的下一步。两条依据应是不同、可核对的原始事实，不得把待核实的反馈写成已完成。",
  reference: "结论：可以先整理已核实的反馈，完整判断等缺少的数据补齐。依据一：12 条中已有 9 条核实。依据二：仍有 3 条缺数据。",
};
const source = {
  kind: "text" as const,
  title: "LightTick 原创教学材料 · 结构化思维 v1",
  text: "结论回答听者此刻最需要知道什么，依据是能独立核对的事实。把尚未核实的内容单列为待确认。原创合成示范：测试尚未完成；已通过 4 个用例，另有 2 个用例等待测试数据。结论要与证据数量及范围相符，不能把缺口当成已验证结果。",
};

export function tutorMaterial(topic: unknown) {
  if (topic !== STRUCTURED_THINKING) fail(422, "当前只准备了结构化思维首课。可以缩小学习范围或使用高级课程编辑。");
  return {
    topic: STRUCTURED_THINKING,
    title: "结构化思维 · 结论与依据",
    source,
    source_digest: digest(source.text),
    concept: { id: "conclusion-and-evidence-v1", title: "先说结论，再给可核对的依据" },
    question: { id: practice.id, prompt: practice.prompt, standard: practice.standard },
  };
}

export function tutorPublication(topic: string, content: string) {
  const material = tutorMaterial(topic);
  const headings = [...content.matchAll(/^ {0,3}#{1,6}[^\r\n]*$/gm)];
  const analysis = headings.findIndex(heading => heading[0].includes("参考分析"));
  if (analysis < 0) fail(422, "家教正文缺少可单独呈现的参考分析。");
  const start = headings[analysis].index;
  const end = headings[analysis + 1]?.index ?? content.length;
  return {
    topic: material.topic,
    source_title: material.source.title,
    source_digest: material.source_digest,
    concept: material.concept,
    question: material.question,
    body: (content.slice(0, start) + content.slice(end)).trim(),
    reference_analysis: practice.reference + "\n\n" + content.slice(start, end).trim(),
  };
}
