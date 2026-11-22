import { createHash } from "node:crypto";
import type { GitHubCredentials } from "./github.client.ts";
import { fail } from "../learning/native-learning.validation.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");
export const commitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
export const providerName = (c: GitHubCredentials) => c.provider === "gitee" ? "gitee" : "github";

export function repositoryPath(value: string) {
  if (
    value.length > 1024 ||
    (value && value.split("/").some(part =>
      !part || part === "." || part === ".." || /[\\\u0000-\u001f\u007f-\u009f]/.test(part) ||
      /[\uD800-\uDFFF]/u.test(part)
    ))
  ) fail(422, "Invalid repository path.");
  return value;
}

function commit(value: unknown) {
  if (typeof value !== "string" || !commitPattern.test(value))
    fail(503, "The repository provider returned an invalid commit.");
  return value;
}

function blobMatches(sha: string, markdown: string) {
  if (typeof sha !== "string" || !commitPattern.test(sha)) return false;
  return createHash(sha.length === 40 ? "sha1" : "sha256")
    .update("blob " + Buffer.byteLength(markdown) + "\0")
    .update(markdown)
    .digest("hex") === sha;
}

type RemoteEntry = { name: string; type: "dir" | "file"; sha: string };
type RemoteContent =
  | { kind: "directory"; entries: RemoteEntry[] }
  | { kind: "markdown"; markdown: string; sha: string };

export class RepositoryContentClient {
  private readonly gitee: boolean;
  private readonly base: string;
  constructor(
    readonly credentials: GitHubCredentials,
    private readonly fetcher: typeof fetch,
    private readonly signal?: AbortSignal,
  ) {
    this.gitee = providerName(credentials) === "gitee";
    const prefix = this.gitee ? "https://gitee.com/api/v5" : "https://api.github.com";
    this.base = prefix + "/repos/" + encodePath(credentials.repository);
  }

  webUrl(commitSha: string, path: string, kind: "blob" | "tree" = "blob") {
    const host = this.gitee ? "gitee.com" : "github.com";
    return `https://${host}/${this.credentials.repository}/${kind}/${commitSha}` +
      (path ? "/" + encodePath(path) : "");
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: object; missing?: boolean } = {},
  ): Promise<T | null> {
    const { method = "GET", body, missing } = options;
    const timeout = AbortSignal.timeout(10_000);
    const signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, {
        method,
        signal,
        redirect: "error",
        headers: {
          Authorization: (this.gitee ? "token " : "Bearer ") + this.credentials.token,
          Accept: this.gitee ? "application/json" : "application/vnd.github+json",
          "User-Agent": "LightTick-Zook",
          ...(this.gitee ? {} : { "X-GitHub-Api-Version": "2022-11-28" }),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      fail(503, "Repository request timed out or could not connect. Try again.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 && missing) return null;
      if (response.status === 401 || response.status === 403 || response.status === 404)
        fail(response.status === 404 && method === "GET" ? 404 : 403, "The repository operation was denied. Check the path, Token permissions and branch rules.");
      if (response.status === 409 || response.status === 422)
        fail(409, "The repository rejected the change. Check branch rules and retry.");
      fail(503, "The repository provider is busy or unavailable. Try again.");
    }
    if (!/^application\/(?:json|vnd\.github\+json)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel().catch(() => {});
      fail(503, "The repository provider returned an invalid response.");
    }
    const reader = response.body?.getReader();
    if (!reader) fail(503, "The repository response was empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read().catch(() =>
          fail(503, "The repository download was interrupted. Try again."),
        );
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) fail(413, "The repository response is too large.");
        chunks.push(chunk.value);
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString()) as T;
    } catch {
      fail(503, "The repository provider returned invalid JSON.");
    }
  }

  async head() {
    const branch = this.credentials.branch;
    if (this.gitee) {
      const ref = await this.request<{ name: string; commit?: { sha: string } }>(
        "/branches/" + encodeURIComponent(branch),
      );
      if (ref?.name !== branch) fail(503, "The repository provider returned the wrong branch.");
      return commit(ref.commit?.sha);
    }
    const ref = await this.request<{ ref: string; object?: { type: string; sha: string } }>(
      "/git/ref/heads/" + encodePath(branch),
    );
    if (ref?.ref !== "refs/heads/" + branch || ref.object?.type !== "commit")
      fail(503, "The repository provider returned the wrong branch.");
    return commit(ref.object.sha);
  }

  async content(path: string, ref: string, missing = false): Promise<RemoteContent | null> {
    repositoryPath(path);
    const value = await this.request<RemoteEntry[] | {
      type: string; encoding?: string; content?: string; sha: string; size?: number;
    }>("/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(ref), { missing });
    if (value === null) return null;
    if (Array.isArray(value)) return {
      kind: "directory",
      entries: value.filter(entry => entry && typeof entry.name === "string" &&
        !entry.name.includes("/") && entry.name !== "." && entry.name !== ".." &&
        (entry.type === "dir" || (entry.type === "file" && /\.md$/i.test(entry.name)))),
    };
    if (value.type !== "file" || !/\.md$/i.test(path) || value.encoding !== "base64" ||
      typeof value.content !== "string")
      fail(422, "Only Markdown files with inline content can be opened.");
    const bytes = Buffer.from(value.content, "base64");
    if (bytes.length > 1024 * 1024) fail(413, "Markdown files must be 1 MiB or smaller.");
    return { kind: "markdown", markdown: bytes.toString("utf8"), sha: commit(value.sha) };
  }

  async publish(path: string, files: ReadonlyMap<string, string>, beforeWrite: () => Promise<void>) {
    const head = await this.head();
    const existing = await this.content(path, head, true);
    if (existing && existing.kind !== "directory") fail(409, "The snapshot path is occupied.");
    const byName = new Map(existing?.entries.map(entry => [entry.name, entry]));
    const pending = new Map(files);
    for (const [name, markdown] of files) {
      const entry = byName.get(name);
      if (!entry) continue;
      if (entry.type !== "file" || !blobMatches(entry.sha, markdown))
        fail(409, "A snapshot file was edited outside LightTick.");
      pending.delete(name);
    }
    if (!pending.size) return head;

    if (this.gitee) {
      let revision = head;
      for (const [name, markdown] of pending) {
        await beforeWrite();
        const result = await this.request<{ commit?: { sha: string } }>(
          "/contents/" + encodePath(path + "/" + name), {
            method: "POST",
            body: {
              branch: this.credentials.branch,
              message: "LightTick: publish " + name,
              content: Buffer.from(markdown).toString("base64"),
            },
          },
        );
        revision = commit(result?.commit?.sha);
      }
      const published = await this.content(path, revision);
      const publishedShas = new Map(published?.kind === "directory"
        ? published.entries.filter(entry => entry.type === "file").map(entry => [entry.name, entry.sha])
        : []);
      for (const [name, markdown] of files) {
        if (!blobMatches(publishedShas.get(name) ?? "", markdown))
          fail(409, "The committed course files differ from the course snapshot.");
      }
      return revision;
    }

    const parent = await this.request<{ tree?: { sha: string } }>("/git/commits/" + head);
    await beforeWrite();
    const tree = await this.request<{ sha: string }>("/git/trees", {
      method: "POST",
      body: {
        base_tree: commit(parent?.tree?.sha),
        tree: [...pending].map(([name, content]) => ({
          path: path + "/" + name, mode: "100644", type: "blob", content,
        })),
      },
    });
    const revision = await this.request<{ sha: string }>("/git/commits", {
      method: "POST",
      body: { message: "LightTick: publish course", tree: commit(tree?.sha), parents: [head] },
    });
    const sha = commit(revision?.sha);
    await beforeWrite();
    await this.request("/git/refs/heads/" + encodePath(this.credentials.branch), {
      method: "PATCH", body: { sha, force: false },
    });
    return sha;
  }
}
