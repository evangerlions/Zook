import type { LightTickOwner } from "../lighttick.types.ts";
import { LearningRouteService } from "../learning/learning-route.service.ts";
import type { NativeLearningService } from "../learning/native-learning.service.ts";
import { digest, fail, integer, keys } from "../learning/native-learning.validation.ts";
import { GitHubService } from "./github.service.ts";
import type { GitHubCredentials } from "./github.client.ts";
import { commitPattern, providerName, RepositoryContentClient, repositoryPath } from "./repository-content.client.ts";

const RECEIPT_TYPE = "course_repository_publication";
const publicationKey = (id: string, routeRevision: number, settingsRevision: number) =>
  "course-repo-" + digest([id, routeRevision, settingsRevision]);
const lessonFilename = (number: number) => String(number).padStart(3, "0") + ".md";
const mdLabel = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\[\]`*_<>]/g, "\\$&");

export class CourseRepositoryService {
  constructor(
    readonly settings: GitHubService,
    readonly native?: NativeLearningService,
  ) {}

  private client(credentials: GitHubCredentials, signal?: AbortSignal) {
    return new RepositoryContentClient(credentials, this.settings.connection.fetcher, signal);
  }

  async browse(owner: LightTickOwner, query: Record<string, string | undefined>) {
    const path = repositoryPath(query.path ?? "");
    const requestedCommit = query.commit;
    if (requestedCommit !== undefined && !commitPattern.test(requestedCommit))
      fail(422, "Choose a valid repository commit.");
    const revision = integer(Number(query.settings_revision), 1, 2147483647);
    const credentials = await this.settings.credentials(owner, { mode: "custom", revision });
    const client = this.client(credentials);
    const commit = requestedCommit ?? await client.head();
    const content = await client.content(path, commit);
    if (!content) fail(404, "Repository path was not found.");
    await this.settings.assertCurrent(owner, { mode: "custom", revision });
    const base = {
      path,
      commit,
      url: client.webUrl(commit, path, content.kind === "directory" ? "tree" : "blob"),
    };
    if (content.kind === "markdown") return { ...base, kind: content.kind, markdown: content.markdown };
    return {
      ...base,
      kind: content.kind,
      entries: content.entries.map(({ name, type }) => ({ name, type })),
    };
  }

  async receipt(owner: LightTickOwner, id: string, query: Record<string, string | undefined>) {
    const routeRevision = integer(Number(query.route_revision), 1, 2147483647);
    const revision = integer(Number(query.settings_revision), 1, 2147483647);
    if (!this.native) fail(503, "Native course publication is unavailable.");
    const routes = new LearningRouteService(this.native);
    return this.settings.repo.transaction(owner, async () => {
      await this.settings.authorize();
      await routes.access(owner);
      routes.routeId(id);
      const receipt = await this.settings.repo.getOperation(owner, publicationKey(id, routeRevision, revision));
      return {
        publication: receipt?.entityType === RECEIPT_TYPE && receipt.entityId === id
          ? receipt.resultPayload : null,
      };
    });
  }

  async publish(owner: LightTickOwner, id: string, body: Record<string, unknown>) {
    keys(body, ["route_revision", "settings_revision"]);
    const routeRevision = integer(body.route_revision, 1, 2147483647);
    const revision = integer(body.settings_revision, 1, 2147483647);
    const native = this.native;
    if (!native?.enabled) fail(503, "Native course publication is unavailable.");
    const routes = new LearningRouteService(native);
    const operation = publicationKey(id, routeRevision, revision);
    const repo = this.settings.repo;
    const snapshot = await repo.transaction(owner, async () => {
      await this.settings.authorize();
      await routes.access(owner);
      const receipt = await repo.getOperation(owner, operation);
      if (receipt) {
        if (receipt.entityType !== RECEIPT_TYPE || receipt.entityId !== id)
          fail(409, "Publication receipt conflicts with another operation.");
        return { receipt: receipt.resultPayload } as const;
      }
      const route = await routes.require(owner, id);
      if (!route.publishedVersion || route.revision !== routeRevision)
        fail(409, "Course changed. Refresh the published course before exporting.");
      const outline = await repo.learningRoutes.getLearningRouteVersion(owner, id, route.publishedVersion);
      if (!outline) fail(404, "Published course outline was not found.");
      const links = await repo.learningRoutes.listRouteLessonLinks(owner, id);
      const files = new Map<string, string>();
      for (const link of links) {
        const lesson = await repo.getNativeLesson(owner, link.lessonId);
        if (!lesson || lesson.archived || !lesson.publishedVersion)
          fail(409, "A linked lesson is unavailable. Refresh the course before exporting.");
        const version = await repo.getLessonPublication(owner, lesson.id, lesson.publishedVersion);
        if (!version) fail(409, "A published lesson version is missing.");
        const references = version.references ? "\n\n## 参考资料\n\n" + version.references : "";
        files.set(lessonFilename(link.number), `# ${mdLabel(lesson.title)}\n\n${version.content}${references}\n`);
      }
      const { brief, document, version } = outline;
      const index = document.lessons.map(lesson => {
        const name = lessonFilename(lesson.number);
        const title = mdLabel(lesson.topic);
        return files.has(name) ? `- ${lesson.number}. [${title}](./${name})`
          : `- ${lesson.number}. ${title}（正文待发布）`;
      });
      const reading = [
        `# ${mdLabel(brief.title)}`, `课程大纲 v${version}`, "## 学习目标", brief.goal,
        ...(document.prerequisites ? ["## 先修要求", document.prerequisites] : []),
        "## 课程目录", index.join("\n"),
      ];
      files.set("README.md", reading.join("\n\n") + "\n");
      let bytes = 0;
      for (const markdown of files.values()) {
        const size = Buffer.byteLength(markdown);
        if (size > 1024 * 1024) fail(413, "Each Markdown file must be 1 MiB or smaller.");
        bytes += size;
      }
      if (bytes > 8 * 1024 * 1024) fail(413, "A course snapshot must be 8 MiB or smaller.");
      return { files } as const;
    });
    if ("receipt" in snapshot) return snapshot.receipt;

    const selection = { mode: "custom" as const, revision };
    const credentials = await this.settings.credentials(owner, selection);
    const client = this.client(credentials, AbortSignal.timeout(45_000));
    const path = "lighttick/courses/" + digest([owner, id]).slice(0, 24) +
      "/" + digest([...snapshot.files]).slice(0, 32);
    const checkAccess = async () => {
      await this.settings.assertCurrent(owner, selection);
      await routes.access(owner);
    };
    const commit = await client.publish(path, snapshot.files, checkAccess);
    const readme = path + "/README.md";
    const result = {
      provider: providerName(credentials),
      repository: credentials.repository,
      branch: credentials.branch,
      commit,
      path: readme,
      url: client.webUrl(commit, readme),
    };
    return this.settings.command(owner, operation, RECEIPT_TYPE, id, "publish", body, async () => result);
  }
}
