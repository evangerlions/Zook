import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { learningQuestions } from "../../src/modules/lighttick/learning/learning-questions.ts";
test("native exercise IDs match the frozen legacy parser on headings, hidden answers, fences, nested sections and Unicode", () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/lighttick/native-question-keys.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const fixture of fixtures)
    assert.deepEqual(
      learningQuestions(fixture.content),
      fixture.expected,
      fixture.content,
    );
});
