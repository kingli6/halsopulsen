(function attachWorkoutPlannerUnifiedMockData(root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  if (root) root.WorkoutPlannerUnifiedMockData = data;
})(typeof window === "undefined" ? globalThis : window, function createWorkoutPlannerUnifiedMockData() {
  "use strict";

  const workouts = [
    {
      id: "strength-a",
      name: "Full-body strength A",
      type: "Strength",
      availability: "program",
      duration: 45,
      status: "completed",
      description: "A steady full-body session with a comfortable pace and controlled reps.",
      updated: "Used in Foundations",
      warmup: "5 min easy walk, then a few light practice reps.",
      cooldown: "Easy walk until your breathing settles.",
      exercises: [
        {
          id: "goblet-squat",
          name: "Goblet squat",
          sets: 3,
          reps: 8,
          weight: 20,
          rest: 90,
          instruction: "Pause briefly at a comfortable depth.",
          displayPrescription: "3 sets · 8 reps · 20 kg"
        },
        {
          id: "incline-push-up",
          name: "Incline push-up",
          sets: 3,
          reps: 10,
          weight: null,
          rest: 60,
          instruction: "Use a stable surface that lets you keep a smooth tempo.",
          displayPrescription: "3 sets · 10 reps"
        },
        {
          id: "dumbbell-row",
          name: "One-arm dumbbell row",
          sets: 3,
          reps: 10,
          weight: 12,
          rest: 60,
          instruction: "10 reps each side.",
          displayPrescription: "3 sets · 10 reps · each side"
        }
      ]
    },
    {
      id: "easy-aerobic",
      name: "Easy cardio + mobility",
      type: "Cardio",
      availability: "program",
      duration: 35,
      status: "completed",
      description: "Build an easy aerobic base without chasing pace.",
      updated: "Used in Foundations",
      warmup: "Start with five minutes at a relaxed pace.",
      cooldown: "Finish with an easy walk and gentle mobility.",
      exercises: [
        {
          id: "walk-jog",
          name: "Outdoor walk or easy jog",
          sets: 1,
          reps: 30,
          weight: null,
          rest: 0,
          instruction: "30 minutes at a conversational effort; walk whenever needed.",
          displayPrescription: "30 min · easy effort"
        },
        {
          id: "hip-mobility",
          name: "Hip mobility flow",
          sets: 1,
          reps: 5,
          weight: null,
          rest: 0,
          instruction: "Move smoothly through a comfortable range on each side.",
          displayPrescription: "5 min · relaxed range"
        }
      ]
    },
    {
      id: "strength-b",
      name: "Strength B",
      type: "Strength",
      availability: "both",
      duration: 50,
      status: "completed",
      description: "A lower-body and trunk session focused on balance and control.",
      updated: "Used in Foundations",
      warmup: "5 min brisk walk and a few easy bodyweight repetitions.",
      cooldown: "Gentle breathing and relaxed hip mobility.",
      exercises: [
        {
          id: "reverse-lunge",
          name: "Reverse lunge",
          sets: 3,
          reps: 8,
          weight: null,
          rest: 75,
          instruction: "8 reps each side; hold support if useful.",
          displayPrescription: "3 sets · 8 each side"
        },
        {
          id: "glute-bridge",
          name: "Glute bridge",
          sets: 3,
          reps: 12,
          weight: null,
          rest: 60,
          instruction: "Pause briefly at the top of each repetition.",
          displayPrescription: "3 sets · 12 reps"
        },
        {
          id: "dead-bug",
          name: "Dead bug",
          sets: 3,
          reps: 8,
          weight: null,
          rest: 45,
          instruction: "8 reps each side; keep the movement controlled.",
          displayPrescription: "3 sets · 8 each side"
        }
      ]
    },
    {
      id: "mobility-reset",
      name: "Mobility reset",
      type: "Mobility",
      availability: "independent",
      duration: 10,
      status: "available",
      description: "A short movement break to loosen up without pushing intensity.",
      updated: "Available to client",
      warmup: "",
      cooldown: "",
      exercises: [
        {
          id: "worlds-greatest-stretch",
          name: "World’s greatest stretch",
          sets: 2,
          reps: 5,
          weight: null,
          rest: 20,
          instruction: "Move through each side slowly and comfortably.",
          displayPrescription: "2 sets · 5 each side"
        },
        {
          id: "thoracic-rotation",
          name: "Open-book rotation",
          sets: 2,
          reps: 8,
          weight: null,
          rest: 20,
          instruction: "8 gentle repetitions per side.",
          displayPrescription: "2 sets · 8 each side"
        }
      ]
    }
  ];

  const program = {
    name: "Strength & Mobility Foundations",
    durationWeeks: 2,
    sessionsPerWeek: 3,
    schedule: [
      { workoutId: "strength-a", weekday: 0, time: "08:30", label: "Program", status: "completed" },
      { workoutId: "easy-aerobic", weekday: 2, time: "Flexible", label: "Program", status: "completed" },
      { workoutId: "strength-b", weekday: 4, time: "Flexible", label: "Program", status: "completed" }
    ],
    optionalSessions: [
      { workoutId: "mobility-reset", weekday: 2, time: "Optional", label: "Anytime" }
    ],
    recentSessions: [
      { workoutId: "strength-a", weeksAgo: 1, note: "Good energy" },
      { workoutId: "easy-aerobic", weeksAgo: 1, note: "Easy effort" },
      { workoutId: "strength-b", weeksAgo: 1, note: "Felt steady" }
    ],
    independentWorkoutIds: ["mobility-reset"]
  };

  return { program, workouts };
});
