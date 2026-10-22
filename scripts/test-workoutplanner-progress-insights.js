const assert = require("assert");
const { findStrengthLoadImprovements } = require("../dashboard/progress-insights");

const sessions = [
  {
    id: "session-new",
    status: "completed",
    performedOn: "2026-10-20",
    exercises: [{
      name: "Goblet squat",
      actualSets: [
        { reps: 8, load: 20, loadUnit: "kg" },
        { reps: 8, load: 22, loadUnit: "kg" }
      ]
    }]
  },
  {
    id: "session-old",
    status: "completed",
    performedOn: "2026-10-13",
    exercises: [{
      name: "Goblet squat",
      actualSets: [
        { reps: 8, load: 18, loadUnit: "kg" },
        { reps: 8, load: 20, loadUnit: "kg" }
      ]
    }]
  },
  {
    status: "completed",
    performedOn: "2026-10-19",
    exercises: [{
      name: "Bench press",
      actualSets: [{ reps: 5, load: 50, loadUnit: "kg" }]
    }]
  },
  {
    status: "completed",
    performedOn: "2026-10-12",
    exercises: [{
      name: "Bench press",
      actualSets: [{ reps: 8, load: 45, loadUnit: "kg" }]
    }]
  },
  {
    status: "skipped",
    performedOn: "2026-10-21",
    exercises: [{
      name: "Deadlift",
      actualSets: [{ reps: 5, load: 100, loadUnit: "kg" }]
    }]
  },
  {
    status: "completed",
    performedOn: "2026-10-14",
    exercises: [{
      name: "Deadlift",
      actualSets: [{ reps: 5, load: 90, loadUnit: "kg" }]
    }]
  }
];

const insights = findStrengthLoadImprovements(sessions);
assert.strictEqual(insights.length, 1, "Only a same-exercise, same-sets, same-reps load increase is enough to highlight.");
assert.deepStrictEqual(insights[0], {
  exerciseName: "Goblet squat",
  fromLoad: 20,
  toLoad: 22,
  unit: "kg",
  setCount: 2,
  repsLabel: "8/8",
  fromDate: "2026-10-13",
  toDate: "2026-10-20",
  fromSessionId: "session-old",
  toSessionId: "session-new"
});

assert.deepStrictEqual(findStrengthLoadImprovements([{
  status: "completed",
  performedOn: "2026-10-22",
  exercises: [{
    name: "Row",
    actualSets: [{ reps: 10, load: 0, loadUnit: "kg" }]
  }]
}]), [], "A single or incomplete measurement must not be called an improvement.");

console.log("WorkoutPlanner progress-insight checks passed.");
