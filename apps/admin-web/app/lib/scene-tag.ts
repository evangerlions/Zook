export const SCENE_TAG_COLORS: Record<string, string> = {
  kickoff: "blue",
  kickoff_turn: "blue",
  import_book: "purple",
  imported_kickoff: "purple",
  kickoff_turn_imported_book: "purple",
  writing: "green",
  write_turn: "green",
  advance_chapter: "green",
  history_qa: "orange",
  history_chapter_qa: "orange",
};

export function sceneTagColor(sceneKey: string): string {
  return SCENE_TAG_COLORS[sceneKey] ?? "default";
}
