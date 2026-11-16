import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonPreview } from "../app/components/json-preview";
import { TraceMarkdownContent } from "../app/components/conversation-trace-content";
import { SearchRecordDetails } from "../app/components/search-records-table";

const preview = renderToStaticMarkup(<JsonPreview value={{ query: "test", count: 1, enabled: true }} />);
for (const kind of ["key", "string", "number", "boolean"]) {
  assert.match(preview, new RegExp(`json-token-${kind}`));
}
const fenced = renderToStaticMarkup(<TraceMarkdownContent text={'```json\n{"query":"test"}\n```'} />);
assert.match(fenced, /json-token-key/);
assert.match(fenced, /json-token-string/);
const plain = renderToStaticMarkup(<TraceMarkdownContent text={'```text\nplain\n```'} />);
assert.doesNotMatch(plain, /json-token-/);
const details = renderToStaticMarkup(<SearchRecordDetails record={{
  requestId: "1", userId: "u", sceneKey: "write_turn", timestamp: "2026-11-15",
  status: "completed", returnedCount: 0, filteredCount: 0, latencyMs: 1, upstreamCalls: 1,
  input: { query: "example", limit: 5, sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "t" },
  output: { status: "completed", results: [] },
}} />);
assert.match(details, /example/);
assert.equal((details.match(/class="json-preview"/g) ?? []).length, 2);
assert.match(details, /json-token-key/);
assert.match(details, /json-token-string/);
console.log("JSON presentation regression passed");
