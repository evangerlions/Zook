import assert from "node:assert/strict";
import test from "node:test";
import { maskSensitiveFields, maskSensitiveString } from "../../src/shared/utils.ts";

test("maskSensitiveString keeps the first four characters and masks the rest", () => {
  assert.equal(maskSensitiveString("sid-demo"), "sid-****");
  assert.equal(maskSensitiveString("sk-demo"), "sk-d****");
  assert.equal(maskSensitiveString(""), "");
});

test("field-level sensitive helpers apply the same masking rule", () => {
  const rules = {
    secretId: { visibleChars: 4 },
    secretKey: { visibleChars: 4 },
  };

  const masked = maskSensitiveFields(
    {
      secretId: "sid-demo",
      secretKey: "sk-demo",
      fromEmailAddress: "noreply@example.com",
    },
    rules,
  );

  assert.deepEqual(masked, {
    secretId: "sid-****",
    secretKey: "sk-d****",
    fromEmailAddress: "noreply@example.com",
  });
});
