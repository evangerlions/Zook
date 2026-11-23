import assert from "node:assert/strict";
import test from "node:test";
import { STRUCTURED_THINKING, tutorMaterial, tutorPublication } from "../../src/modules/lighttick/learning/tutor-material.ts";
import { tutorOutput } from "../../src/modules/lighttick/learning/tutor-work.ts";
import { learningQuestions, publicationQuestions } from "../../src/modules/lighttick/learning/learning-questions.ts";

test("tutor publication separates the reference answer and all of its nested sections", () => {
  const body = [
    "## 概念",
    "保留正文。",
    "```markdown",
    "## 参考分析",
    "```",
    "## 参考分析",
    "答案只出现在本区块。",
    "### 依据",
    "二级说明仍属于参考分析。",
    "## 自查",
    "自查继续留在正文。",
  ].join("\r\n");
  const result = tutorPublication(STRUCTURED_THINKING, body);
  assert.match(result.body, /保留正文/);
  assert.match(result.body, /自查继续留在正文/);
  assert.doesNotMatch(result.body, /答案只出现在本区块|二级说明仍属于参考分析/);
  assert.match(result.reference_analysis, /答案只出现在本区块/);
  assert.match(result.reference_analysis, /二级说明仍属于参考分析/);
  assert.doesNotMatch(result.reference_analysis, /自查继续留在正文/);
  assert.equal(result.source_digest, tutorMaterial(STRUCTURED_THINKING).source_digest);
});

test("an ambiguous or empty reference section is rejected at publication", () => {
  const header = "## 概念\n正文。\n";
  assert.throws(() => tutorPublication(STRUCTURED_THINKING, header), { statusCode: 422 });
  assert.throws(() => tutorPublication(STRUCTURED_THINKING, header + "## 参考分析\n## 自查\n自查。"), { statusCode: 422 });
  assert.throws(() => tutorPublication(STRUCTURED_THINKING, header + "## 参考分析\n第一段。\n## 参考分析\n第二段。"), { statusCode: 422 });
});

test("native and legacy readers keep the same fixed tutor question and ordinary lessons stay compatible", () => {
  const content = "## 练习\n- 写下普通课的原答案。";
  assert.deepEqual(publicationQuestions({ content }), learningQuestions(content));
  const { question } = tutorMaterial(STRUCTURED_THINKING);
  assert.deepEqual(publicationQuestions({ content, tutorTopic: STRUCTURED_THINKING }),
    [{ id: question.id, prompt: question.prompt, answer: "" }]);
});

test("tutor feedback binds its evidence and cannot add outside links", () => {
  const material = tutorMaterial(STRUCTURED_THINKING);
  const input = { action: "feedback", submission: "已有 9 条已核实", material };
  const feedback = { message: "核实范围表达清楚。", next_step: "指出尚待确认的范围。", verdict: "supported", answer_quote: "9 条已核实" };
  assert.equal(tutorOutput(feedback, input).answer_quote, "9 条已核实");
  assert.equal(tutorOutput(feedback, input).question_id, material.question.id);
  assert.throws(() => tutorOutput({ ...feedback, answer_quote: "12 条均已核实" }, input), { statusCode: 422 });
  assert.throws(() => tutorOutput({ ...feedback, answer_quote: "" }, input), { statusCode: 422 });
  assert.throws(() => tutorOutput({ ...feedback, next_step: "https://example.com" }, input), { statusCode: 422 });
  assert.throws(() => tutorOutput({ ...feedback, verdict: "help" }, { ...input, action: "hint" }), { statusCode: 422 });
});
