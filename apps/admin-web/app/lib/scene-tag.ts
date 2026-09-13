export const SCENE_TAG_COLORS: Record<string, string> = {
  kickoff_turn: "blue",
  kickoff_turn_imported_book: "purple",
  write_turn: "green",
  history_chapter_qa: "orange",
};

export function sceneTagColor(sceneKey: string): string {
  return SCENE_TAG_COLORS[sceneKey] ?? "default";
}
