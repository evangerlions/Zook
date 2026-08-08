import assert from "node:assert/strict";
import test from "node:test";

import { resolveEmailTemplate } from "../../src/services/common-email-config-normalizer.ts";

const templates = [
  { locale: "en-US", name: "verify-code", templateId: 1, subject: "Verification Code" },
  { locale: "zh-CN", name: "verify-code", templateId: 2, subject: "验证码" },
  { locale: "zh-TW", name: "verify-code", templateId: 3, subject: "驗證碼" },
  { locale: "es-ES", name: "verify-code", templateId: 4, subject: "Código de verificación" },
];

test("email template resolution honors shared locale fallbacks", () => {
  assert.equal(resolveEmailTemplate(templates, "zh-HK", "verify-code").locale, "zh-TW");
  assert.equal(resolveEmailTemplate(templates, "es-MX", "verify-code").locale, "es-ES");
  assert.equal(resolveEmailTemplate(templates, "de-DE", "verify-code").locale, "en-US");
});
