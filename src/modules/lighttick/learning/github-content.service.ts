import { ApplicationError } from "../../../shared/errors.ts";

interface GitHubFile {
  path: string;
  content: string;
  sha?: string;
  size?: number;
}

interface GitHubCommit {
  sha: string;
  message: string;
  tree: string;
  parents: string[];
}

interface GitHubContentOptions {
  repository: string;
  branch: string;
  token: string;
  prefix: string;
  transport?: typeof fetch;
  signal?: AbortSignal;
}

export class GitHubContentService {
  private readonly baseUrl = "https://api.github.com";
  private readonly transport: typeof fetch;
  private readonly cache = new Map<string, { sha: string; content: string }>();
  private readonly cacheMaxSize = 128;

  constructor(private readonly options: GitHubContentOptions) {
    this.transport = options.transport ?? fetch;
  }

  private getHeaders() {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.options.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/repos/${this.options.repository}/${path}`;
    const response = await this.transport(url, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new ApplicationError(
        response.status,
        "VALIDATION_ERROR",
        `GitHub request failed (${response.status}).`,
      );
    }

    return response.json() as Promise<T>;
  }

  private physicalPath(relative: string): string {
    const normalized = relative.replace(/^\/+/, "");
    if (normalized.includes("..") || normalized.includes("//")) {
      throw new ApplicationError(400, "VALIDATION_ERROR", "Path contains invalid characters");
    }
    return this.options.prefix ? `${this.options.prefix}/${normalized}` : normalized;
  }

  async listFiles(ref?: string): Promise<GitHubFile[]> {
    const path = this.physicalPath("");
    const endpoint = ref
      ? `git/trees/${ref}?recursive=1`
      : `contents/${path}?ref=${encodeURIComponent(this.options.branch)}`;

    if (ref) {
      const tree = await this.request<{ truncated?: boolean; tree: Array<{ path: string; sha: string; size: number; type: string }> }>(
        "GET",
        endpoint,
      );
      if (tree.truncated) throw new ApplicationError(422, "VALIDATION_ERROR", "Repository tree is truncated; no content was changed.");
      return tree.tree
        .filter((item) => item.type === "blob" && (!this.options.prefix || item.path.startsWith(this.options.prefix + "/")))
        .map((item) => ({
          path: item.path.replace(this.options.prefix, "").replace(/^\/+/, ""),
          sha: item.sha,
          size: item.size,
          content: "",
        }));
    }

    const contents = await this.request<Array<{ name: string; path: string; sha: string; size: number; type: string }>>(
      "GET",
      endpoint,
    );
    return contents
      .filter((item) => item.type === "file")
      .map((item) => ({
        path: item.path.replace(this.options.prefix, "").replace(/^\/+/, ""),
        sha: item.sha,
        size: item.size,
        content: "",
      }));
  }

  async readText(relative: string, ref?: string): Promise<string> {
    const cacheKey = `${ref ?? this.options.branch}:${relative}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached.content;
    }

    const path = this.physicalPath(relative);
    const endpoint = ref
      ? `git/blobs/${ref}`
      : `contents/${path}?ref=${encodeURIComponent(this.options.branch)}`;

    if (ref) {
      const blob = await this.request<{ content: string; encoding: string }>("GET", endpoint);
      const content = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
      this.updateCache(cacheKey, ref, content);
      return content;
    }

    const file = await this.request<{ content: string; encoding: string; sha: string }>("GET", endpoint);
    const content = file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
    this.updateCache(cacheKey, file.sha, content);
    return content;
  }

  private updateCache(key: string, sha: string, content: string) {
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { sha, content });
  }

  async getLatestCommit(): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `git/ref/heads/${encodeURIComponent(this.options.branch)}`,
    );
    return ref.object.sha;
  }

  async publish(
    files: Record<string, string | null>,
    message: string,
    parentSha: string,
  ): Promise<GitHubCommit> {
    const parentCommit = await this.request<{ tree: { sha: string } }>(
      "GET",
      `git/commits/${parentSha}`,
    );

    const treeEntries = await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        const physicalPath = this.physicalPath(path);
        if (content === null) {
          return { path: physicalPath, mode: "100644", type: "blob", sha: null };
        }
        const blob = await this.request<{ sha: string }>(
          "POST",
          "git/blobs",
          { content, encoding: "utf-8" },
        );
        return { path: physicalPath, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );

    const tree = await this.request<{ sha: string }>(
      "POST",
      "git/trees",
      { base_tree: parentCommit.tree.sha, tree: treeEntries },
    );

    const commit = await this.request<GitHubCommit>(
      "POST",
      "git/commits",
      {
        message,
        tree: tree.sha,
        parents: [parentSha],
      },
    );

    await this.request(
      "PATCH",
      `git/refs/heads/${this.options.branch}`,
      { sha: commit.sha },
    );

    return commit;
  }


}

export function createGitHubContentService(options: GitHubContentOptions): GitHubContentService {
  return new GitHubContentService(options);
}
