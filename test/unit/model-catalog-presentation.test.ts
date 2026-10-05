import assert from "node:assert/strict";
import test from "node:test";
import { parseModelCatalogPresentation } from "../../src/shared/model-catalog-presentation.ts";
import { normalizeAiNovelModelSelectionAdminInput } from "../../src/modules/ai-novel/ai-novel-model-selection-config.ts";
import { parseAiNovelModelSelectionText } from "../../apps/admin-web/app/lib/ai-novel-model-selection.ts";

const catalog = [{ modelKey: "m", label: "M", description: "About M", badge: "Preview",
  localIcon: "deepseek", onlineIcon: "https://cdn.example.com/m.png", sortOrder: 1, enabled: true }];
test("admin and server preserve all catalog metadata", () => {
  const config = { schemaVersion: 1, chat: { default: [{ modelKey: "m", weight: 100 }] }, catalog };
  assert.deepEqual(normalizeAiNovelModelSelectionAdminInput(config), config);
  assert.deepEqual(parseAiNovelModelSelectionText(JSON.stringify(config), ["m"]), config);
});
test("catalog validates icons, HTTPS, flags, order and duplicate keys", () => {
  for (const row of [{ localIcon: "../../secret" }, { onlineIcon: "http://example.com" },
    { onlineIcon: "https://u:p@example.com/x" }, { enabled: "true" }, { sortOrder: 1.1 }, { unknown: true }]) {
    assert.throws(() => parseModelCatalogPresentation([{ modelKey: "m", ...row }]));
  }
  assert.throws(() => parseModelCatalogPresentation([{ modelKey: "m" }, { modelKey: "m" }]));
  assert.deepEqual(parseModelCatalogPresentation([{ modelKey: "m", onlineIcon: "" }]), [{ modelKey: "m", onlineIcon: "" }]);
});
