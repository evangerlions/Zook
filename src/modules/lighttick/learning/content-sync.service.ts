import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { GitHubContentService } from "./github-content.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { digest } from "./native-learning.validation.ts";
import { sha256 } from "../../../shared/utils.ts";

export class LearningContentSyncService {
  constructor(private readonly repo: LightTickRepository, private readonly transport: typeof fetch = fetch) {}
  async sync(owner: LightTickOwner, id: string, force: boolean,
    credentials: { repository: string; branch: string; token: string },
    apply: <T>(fn: () => Promise<T>) => Promise<T>, authorize: () => Promise<void>) {
    const module = await this.repo.getLearningModule(owner, id);
    if (!module?.sourceConfig?.github) throw new ApplicationError(422, "REQ_FIELD_INVALID", "Configure this module's GitHub source first.");
    const source = module.sourceConfig.github;
    if (source.repository !== credentials.repository || source.branch !== credentials.branch)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Saved GitHub configuration changed; reconnect this module.");
    const github = new GitHubContentService({ ...credentials, prefix: source.prefix, transport: this.transport, signal: AbortSignal.timeout(60000) });
    const commit = await github.getLatestCommit();
    // Even no-change requests pass through the same authorized transaction and receipt.
    const files = !force && source.lastCommitSha === commit ? null : (await github.listFiles(commit)).filter(f => f.path.endsWith(".md"));
    if (files && (files.length > 200 || files.some(f => (f.size ?? 0) > 1024 * 1024)))
      throw new ApplicationError(413, "VALIDATION_ERROR", "Sync supports at most 200 Markdown files, each at most 1 MB.");
    const documents: { path: string; content: string }[] = [];
    let bytes = 0;
    for (const file of files ?? []) {
      const content = await github.readText(file.path, file.sha);
      bytes += Buffer.byteLength(content);
      if (bytes > 10 * 1024 * 1024 || Buffer.byteLength(content) > 1024 * 1024)
        throw new ApplicationError(413, "VALIDATION_ERROR", "Sync exceeds the 10 MB total or 1 MB file limit.");
      documents.push({ path: file.path, content });
    }
    return apply(async () => {
      await authorize();
      const current = await this.repo.getLearningModule(owner, id);
      if (!current || current.revision !== module.revision)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Module changed during sync; no content was applied.");
      const result = { moduleId: id, commit_sha: commit, added: 0, updated: 0, deleted: 0,
        synced_at: new Date().toISOString(), status: files ? "success" : "skipped" };
      if (!files) return result;
      const namespace = "lesson-gh-" + sha256(id).slice(0, 12) + "-";
      const old = (await this.repo.listNativeLessons(owner, "", 10001, undefined, id)).filter(l => l.moduleId === id && l.id.startsWith(namespace));
      if (old.length > 10000) throw new ApplicationError(413, "VALIDATION_ERROR", "Module exceeds sync limits.");
      const collectionId = "collection-gh-" + id;
      if (!await this.repo.getLearningCollection(owner, collectionId)) await this.repo.saveLearningCollection({
        ...owner, id: collectionId, moduleId: id, title: module.title, description: module.description,
        revision: 1, archived: false, updatedAt: result.synced_at }, 0);
      const seen = new Set<string>();
      let nextNumber = Math.max(0, ...old.map(l => l.number)) + 1;
      for (const [index, doc] of documents.entries()) {
        const lessonId = namespace + sha256(doc.path).slice(0, 24);
        seen.add(lessonId);
        const prior = old.find(l => l.id === lessonId), version = digest({ content: doc.content, references: "" });
        if (prior?.publishedVersion === version && !prior.archived) continue;
        await this.repo.saveNativeLesson({ ...owner, id: lessonId, moduleId: id, collectionId,
          number: prior?.number ?? nextNumber++,
          title: (doc.content.match(/^# (.+)$/m)?.[1] ?? doc.path).slice(0, 200),
          revision: (prior?.revision ?? 0) + 1, publishedVersion: version, archived: false, updatedAt: result.synced_at }, prior?.revision ?? 0);
        await this.repo.insertLessonPublication({ ...owner, lessonId, contentVersion: version,
          content: doc.content, references: "", sourceUrl: `https://github.com/${credentials.repository}/blob/${commit}/${[source.prefix, doc.path].filter(Boolean).join("/")}`,
          createdAt: result.synced_at });
        if (prior) result.updated++; else result.added++;
      }
      for (const lesson of old) if (!seen.has(lesson.id) && !lesson.archived) {
        await this.repo.saveNativeLesson({ ...lesson, revision: lesson.revision + 1, archived: true, updatedAt: result.synced_at }, lesson.revision);
        result.deleted++;
      }
      await this.repo.saveLearningModule({ ...module, revision: module.revision + 1, storageUsed: bytes,
        sourceConfig: { github: { ...source, lastCommitSha: commit } }, syncStatus: "idle", lastSyncedAt: result.synced_at, updatedAt: result.synced_at }, module.revision);
      return result;
    });
  }
}
