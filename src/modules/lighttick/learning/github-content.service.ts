import type { LightTickOwner } from "../lighttick.types.ts";
import type { NativeLearningRepository } from "./native-learning.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";

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

interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  commit_sha: string;
  synced_at: string;
}

interface GitHubContentOptions {
  repository: string;
  branch: string;
  token: string;
  prefix: string;
  transport?: typeof fetch;
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
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApplicationError(
        response.status,
        "INTERNAL_ERROR",
        `GitHub API error: ${response.status} ${text}`,
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
      : `contents/${path}?ref=${this.options.branch}`;

    if (ref) {
      const tree = await this.request<{ tree: Array<{ path: string; sha: string; size: number; type: string }> }>(
        "GET",
        endpoint,
      );
      return tree.tree
        .filter((item) => item.type === "blob" && item.path.startsWith(this.options.prefix))
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
      : `contents/${path}?ref=${this.options.branch}`;

    if (ref) {
      const blob = await this.request<{ content: string; encoding: string }>("GET", endpoint);
      const content = blob.encoding === "base64" ? atob(blob.content) : blob.content;
      this.updateCache(cacheKey, ref, content);
      return content;
    }

    const file = await this.request<{ content: string; encoding: string; sha: string }>("GET", endpoint);
    const content = file.encoding === "base64" ? atob(file.content) : file.content;
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
      `git/ref/heads/${this.options.branch}`,
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

  async syncModules(
    repo: NativeLearningRepository,
    owner: LightTickOwner,
    moduleId: string,
    lastCommitSha?: string,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      deleted: 0,
      commit_sha: "",
      synced_at: new Date().toISOString(),
    };

    try {
      const currentCommit = await this.getLatestCommit();
      if (lastCommitSha === currentCommit) {
        result.commit_sha = currentCommit;
        return result;
      }

      const remoteFiles = await this.listFiles();
      const remotePaths = new Set(remoteFiles.map((f) => f.path));

      const modules = await repo.listLearningModules(owner);
      const targetModule = modules.find((m) => m.id === moduleId);
      if (!targetModule) {
        throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Module not found");
      }

      const lessons = await repo.listNativeLessons(owner, "", 1000);
      const moduleLessons = lessons.filter((l) => l.moduleId === moduleId);
      const localPaths = new Set(moduleLessons.map((l) => `${l.id}.md`));

      for (const file of remoteFiles) {
        if (!file.path.endsWith(".md")) continue;
        const content = await this.readText(file.path);
        const lessonId = file.path.replace(/\.md$/, "");
        const existing = moduleLessons.find((l) => l.id === lessonId);

        if (existing) {
          result.updated++;
        } else {
          result.added++;
        }
      }

      for (const localPath of localPaths) {
        if (!remotePaths.has(localPath)) {
          result.deleted++;
        }
      }

      result.commit_sha = currentCommit;
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(500, "INTERNAL_ERROR", `Sync failed: ${error}`);
    }
  }
}

export function createGitHubContentService(options: GitHubContentOptions): GitHubContentService {
  return new GitHubContentService(options);
}
