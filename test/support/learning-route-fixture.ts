export function routeFixture() {
  return { brief: { title: "Synthetic course", goal: "Apply a concept", level: "Beginner", minutes: 20, pacing: "self_paced", lesson_count: 2 },
    document: { prerequisites: "No prerequisites", stages: [{ title: "Foundation", goal: "Understand" }, { title: "Practice", goal: "Transfer" }], lessons: [
      { number: 1, topic: "First", goal: "Explain", exercise: "Try", assessment: "Check", minutes: 15, stage: 1, kind: "lesson", requires: [] },
      { number: 2, topic: "Review", goal: "Transfer", exercise: "Apply", assessment: "Review evidence", minutes: 20, stage: 2, kind: "review", requires: [1] },
    ] } };
}
