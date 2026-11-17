import { projectSearchResults, type SearchResult } from "./search-types.ts";

export class DeepSeekSearchClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, limit: number, key: string, signal: AbortSignal, originalQuestion?: string): Promise<SearchResult[]> {
    const response = await this.fetchImpl("https://api.deepseek.com/v1/tools/search", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, count: limit, need_content: false, ...(originalQuestion ? { ori_question: originalQuestion } : {}) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Search upstream status ${response.status}`); }
    // Bound the external payload before JSON parsing, even if upstream ignores count.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Search upstream body missing.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 256_000) throw new Error("Search upstream body too large.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return projectSearchResults(JSON.parse(Buffer.concat(chunks).toString("utf8")), limit);
  }
}
