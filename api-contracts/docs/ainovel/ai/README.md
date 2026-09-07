# AINovel AI External API

## Goal

Describe the **external** AINovel AI contract in OpenAPI form while keeping internal/admin/runtime orchestration APIs out of scope.

## Scope

Included:

- `/api/v1/ai_novel/ai/chat-completions`
- `/api/v1/ai_novel/ai/embeddings`
- `/api/v1/ai_novel/public/config`

Excluded:

- admin config / ai-routing APIs
- internal provider wiring
- backend-only orchestration or model-management interfaces

## Rules

1. Both AI endpoints are **scene-first**: the decrypted inner payload must provide `scene_key` or `sceneKey`.
2. Client must **not** send `model` / `providerModel` / `modelKey` / `tier` / `routingTier` / `modelTier` directly. Scene keys select only the Prompt/tool workflow; every chat scene uses the same server-side AINovel default model selection.
3. AI request/response business payloads travel inside an AES-256-GCM JSON envelope.
4. Only auth / app-scope / outer-envelope errors may return plain JSON.
5. After request decryption succeeds, business success and business failure both return encrypted envelopes.
6. For chat-capable scene keys, the same `/chat-completions` endpoint supports streaming when the decrypted inner body includes `stream=true`.
7. `chat_compaction` is a no-tool, non-streaming summary task used for hard context compaction; it is not a user-visible chat turn.
8. `import_book_agent` is a streaming imported-manuscript agent scene; it uses thinking with automatic tool choice and returns import submit tool calls for the client-owned import loop.
9. Fixed input/output structured jobs such as `chapter_summary`, `chapter_draft_review`, `snapshot_generation`, and `next_chapter_brief` keep the existing JSON `completion.content` shape for `stream=false`; clients may call them with `stream=true` when readable tool argument progress is useful, in which case Zook may emit `tool_call_delta`, `usage`, `tool_call`, and `done` events while preserving the same final JSON payload.
10. Zook only owns stop/retry decisions for a single provider call or backend-only structured job. Product-level write-agent loops, including whether to continue after `read_draft` / `search_story_history` and when to require `write_draft`, are owned by the AINovel engine client because local tool execution and draft stamps live there.
11. Zook performs user-input content safety before the request reaches downstream LLM providers. If the latest user message is rejected, the encrypted business response uses code `AI_INPUT_CONTENT_SENSITIVE` and message `这段内容暂时无法发送，请调整后再试。`; clients must not persist that text as a normal submitted message or reuse it in later context.

## Local-only debug mirrors

For local联调 only:

- request outer envelope may carry `localDebugRequestPlaintext`
- chat-completion response outer envelope may carry `localDebugResponseText`
- Flutter Web may call `POST /api/v1/ai_novel/debug/audit-file` with
  `{ sessionId, html }` to ask local Zook to create or overwrite the fixed
  `generation-audit.html` file in the local AINovel repo. The response includes
  `viewUrl`, a localhost HTTP URL that the browser can open in a new tab.

These fields are for human inspection only and must never become business dependencies.
The audit-file endpoint is also human-inspection-only: production/non-local
contexts return 404, and Zook stores the HTML string without parsing audit data.

## Streaming rule

Streaming is supported for chat endpoints only:

- `POST /api/v1/ai_novel/ai/chat-completions`

It is **not** supported for:

- `POST /api/v1/ai_novel/ai/embeddings`

Contract rule:

- do **not** create a second stream-only endpoint
- keep the original endpoint
- add `stream=true` in the decrypted inner request body when the client wants SSE output
- keep the default behavior unchanged when `stream` is omitted or `false`
- each SSE `data:` line still carries one encrypted outer envelope
- normal stream events use decrypted inner payloads with `type = reasoning_delta | content_delta | tool_call_delta | tool_call | usage | done | error`
- assistant history messages may include `reasoningContent`; Zook forwards it as provider-compatible `reasoning_content` when supported so multi-turn reasoning context and cache continuity are preserved
- `reasoningContent` is provider context replay data, not ordinary user-visible UI content
- product-level loading choreography, workflow keys, step keys, substep keys, and localized step labels are client-owned
- stream detail may be derived from `content_delta` and `tool_call_delta` for readable task output such as draft content, next-chapter brief, review summary, or snapshot text; providers should not pass raw tool-argument JSON to product UI
- token activity should come from provider `usage` when available; client-local estimates must remain client-side and are not billing or quota values
- `tool_call_delta` is a generic provider/tool argument progress event emitted while the model/tool stream is still running
- `tool_call_delta` payloads include readable `text` plus optional `toolCallId`, `toolCallName`, and `toolArgumentPath`
- product workflow keys, localized loading steps, retry UI, and fullscreen loading detail mapping are owned by AINovel, not Zook
- `tool_call` events are a single provider round boundary, not a product agent-loop completion signal
- the `done` event currently guarantees `completion.sceneRouteKey`, `completion.content`, optional `completion.reasoningText`, and optional `completion.finishReason`
- `usage` events and `done.usage` include `promptTokens`, `completionTokens`, `totalTokens`, and may include provider-reported `reasoningTokens`, `contextWindowTokens`, plus `contextUsedRatio`
- if the stream fails after request decryption succeeds, the server emits an encrypted business error envelope with a non-`OK` `code` and the client must treat that event as terminal failure
- after such an error envelope, clients must not expect a follow-up `done` event

## Related OpenAPI

- `api-contracts/openapi/ainovel/ai.yaml`
- `api-contracts/openapi/ainovel/public-config.yaml`
