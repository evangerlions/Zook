import { fail, text } from "../learning/native-learning.validation.ts";
export interface GitHubCredentials {
  repository: string;
  branch: string;
  token: string;
}
export function githubFields(b: Record<string, unknown>) {
  const repository = text(b.repository, 160, true),
    branch = text(b.branch, 160, true);
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(
      repository,
    ) ||
    repository.split("/")[1] === "." ||
    repository.split("/")[1] === ".."
  )
    fail(422, "Repository must be owner/name, not a URL.");
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.split("/").some((s) => s.endsWith(".") || s.endsWith(".lock"))
  )
    fail(422, "Branch is not a valid named Git ref.");
  const token = b.token === null ? null : text(b.token, 1000, true);
  if (token !== null && /[^\x21-\x7e]/.test(token))
    fail(422, "Token contains invalid characters.");
  return { repository, branch, token };
}
/** Read-only fixed-host GitHub ref check. No redirect, initialization, write or provider-body exposure. */
export class GitHubClient {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  async check(c: GitHubCredentials, signal?: AbortSignal): Promise<void> {
    const fields = githubFields(c as unknown as Record<string, unknown>);
    if (!fields.token) throw Error("GITHUB_TOKEN_REQUIRED");
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    let rejectDeadline: (e: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectDeadline(Error("GITHUB_TIMEOUT"));
    }, 15000);
    const request = (async () => {
      controller.signal.throwIfAborted();
      const [owner, repo] = c.repository.split("/");
      const url =
        "https://api.github.com/repos/" +
        encodeURIComponent(owner) +
        "/" +
        encodeURIComponent(repo) +
        "/git/ref/heads/" +
        c.branch.split("/").map(encodeURIComponent).join("/");
      const response = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: "Bearer " + c.token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "LightTick-Zook",
        },
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw Error("GITHUB_ACCESS_FAILED");
      }
      if (
        !/^application\/json(?:;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        throw Error("GITHUB_INVALID_RESPONSE");
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error("GITHUB_INVALID_RESPONSE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.byteLength;
          if (size > 1024 * 1024) throw Error("GITHUB_RESPONSE_TOO_LARGE");
          chunks.push(r.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString());
      if (
        value.ref !== "refs/heads/" + c.branch ||
        value.object?.type !== "commit" ||
        !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value.object?.sha ?? "")
      )
        throw Error("GITHUB_INVALID_REF");
      controller.signal.throwIfAborted();
    })();
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(Error("GITHUB_CANCELLED")),
        { once: true },
      );
    });
    try {
      await Promise.race([request, deadline, cancelled]);
    } catch {
      throw Error("GITHUB_CHECK_FAILED");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}
