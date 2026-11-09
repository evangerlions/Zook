import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";

/** Call only inside the owner transaction. Authority and reading grant cover every historical publication. */
export async function nativeLessonSource(
  repo: LightTickRepository,
  owner: LightTickOwner,
  id: string,
  version?: string,
) {
  const authority = await repo.getLearningAuthority(owner);
  if (!authority || authority.phase === "legacy")
    return { native: false as const };
  if (authority.phase !== "zook" || !authority.readingEnabled)
    return { native: true as const };
  const lesson = await repo.getNativeLesson(owner, id);
  if (!lesson || lesson.archived || !lesson.publishedVersion)
    return { native: true as const };
  const collection = await repo.getLearningCollection(
    owner,
    lesson.collectionId,
  );
  if (!collection || collection.archived) return { native: true as const };
  const publication = await repo.getLessonPublication(
    owner,
    id,
    version ?? lesson.publishedVersion,
  );
  if (!publication) return { native: true as const };
  return {
    native: true as const,
    lesson,
    publication,
    binding: authority.sourceBinding ?? "native-learning",
  };
}
