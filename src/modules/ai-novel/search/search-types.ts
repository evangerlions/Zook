import { badRequest } from "../../../shared/errors.ts";

export const SEARCH_SCENES = ["kickoff_turn", "kickoff_turn_imported_book", "write_turn", "chapter_draft", "history_chapter_qa"] as const;
export type SearchScene = typeof SEARCH_SCENES[number];
export interface SearchInput { sceneKey: SearchScene; agentProtocol: "pi-v1"; toolCallId: string; query: string; limit: number; originalQuestion?: string }
export interface SearchResult { sourceId: string; title: string; url: string; snippet: string; publishedAt: string | null }
export type SearchUnavailableCode = "UPSTREAM_UNAVAILABLE" | "RATE_LIMITED" | "BUDGET_EXCEEDED" | "MODERATION_UNAVAILABLE" | "CREDITS_INSUFFICIENT" | "BILLING_UNAVAILABLE" | "CALL_CONFLICT";
export type SearchOutcome =
  | { status: "completed"; results: SearchResult[] }
  | { status: "blocked"; code: "CONTENT_BLOCKED" }
  | { status: "unavailable"; code: SearchUnavailableCode };

export function parseSearchInput(body: Record<string, unknown>): SearchInput {
  const { sceneKey, agentProtocol, toolCallId, query, limit = 5, originalQuestion } = body;
  if (!SEARCH_SCENES.includes(sceneKey as SearchScene) || agentProtocol !== "pi-v1") badRequest("WEB_SEARCH_UNSUPPORTED", "Unsupported search scene or agent protocol.");
  if (typeof toolCallId !== "string" || !toolCallId.trim() || toolCallId.length > 200) badRequest("REQ_INVALID_BODY", "Invalid toolCallId.");
  if (typeof query !== "string" || !query.trim() || [...query.trim()].length > 128) badRequest("REQ_INVALID_BODY", "query must contain 1 to 128 Unicode characters.");
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 5) badRequest("REQ_INVALID_BODY", "limit must be an integer from 1 to 5.");
  if (originalQuestion !== undefined && (typeof originalQuestion !== "string" || !originalQuestion.trim() || [...originalQuestion.trim()].length > 128)) badRequest("REQ_INVALID_BODY", "originalQuestion must contain 1 to 128 Unicode characters.");
  return { sceneKey: sceneKey as SearchScene, agentProtocol, toolCallId, query: query.trim(), limit: limit as number, ...(typeof originalQuestion === "string" ? { originalQuestion: originalQuestion.trim() } : {}) };
}

const clip = (value: string, size: number) => [...value].slice(0, size).join("");
export function projectSearchResults(payload: unknown, limit: number): SearchResult[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) throw new Error("Invalid search response.");
  const output: SearchResult[] = [];
  const seen = new Set<string>();
  for (const row of (payload as { results: unknown[] }).results) {
    if (!row || typeof row !== "object") throw new Error("Invalid search result.");
    const item = row as Record<string, unknown>;
    if (typeof item.url !== "string" || typeof item.title !== "string" || typeof item.snippet !== "string") throw new Error("Invalid search result fields.");
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || item.url.length > 2048) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    output.push({ sourceId: `s${output.length + 1}`, title: clip(item.title, 200), url: url.href, snippet: clip(typeof item.summary === "string" && item.summary ? item.summary : item.snippet, 800), publishedAt: typeof item.date === "string" && Number.isFinite(Date.parse(item.date)) ? item.date : null });
    if (output.length === limit) break;
  }
  return output;
}
