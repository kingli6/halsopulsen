(function attachMockPreviewHarness(root, factory) {
  const harness = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = harness;
  if (root) root.WorkoutPlannerMockHarness = harness;
})(typeof window !== "undefined" ? window : globalThis, function createHarnessModule() {
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const isoDate = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  function mondayOf(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function strengthExercise(name, sets, reps, load, notes = "") {
    return {
      name,
      activityType: "strength",
      format: "sets",
      sets,
      targetValue: reps,
      targetUnit: "reps",
      load,
      loadUnit: "kg",
      rir: 2,
      restSeconds: 90,
      tempo: "2-1-2",
      notes
    };
  }

  function cardioExercise(name, duration, notes = "") {
    return {
      name,
      activityType: "cardio",
      format: "continuous",
      targetValue: duration,
      targetUnit: "minutes",
      intensity: "Easy",
      heartRateTarget: "Conversational pace",
      notes
    };
  }

  function guidedExercise(name, duration, notes = "") {
    return {
      name,
      activityType: "guided",
      format: "guided",
      targetValue: duration,
      targetUnit: "minutes",
      durationMinutes: duration,
      goal: notes,
      notes
    };
  }

  function makeDay(weekday, workout) {
    if (!workout) {
      return {
        weekday,
        enabled: false,
        name: "",
        description: "",
        sessionType: "Rest / open day",
        warmup: "",
        cooldown: "",
        exercises: []
      };
    }
    return {
      weekday,
      enabled: true,
      name: workout.name,
      description: workout.description,
      sessionType: workout.sessionType,
      warmup: workout.warmup || "",
      cooldown: workout.cooldown || "",
      exercises: clone(workout.exercises || [])
    };
  }

  function makeWeek(weekNumber, phase, progressionNotes, workouts) {
    return {
      weekNumber,
      name: `Week ${weekNumber} · ${phase}`,
      phase,
      progressionNotes,
      successMetric: "Complete the planned sessions with controlled technique.",
      days: Array.from({ length: 7 }, (_, weekday) => makeDay(weekday, workouts[weekday]))
    };
  }

  function makeState() {
    const monday = mondayOf(new Date());
    const publishedProgram = {
      name: "Strength & Mobility Foundations",
      description: "A steady two-week block focused on repeatable strength sessions and comfortable movement.",
      version: 3,
      phase: "Foundation",
      weekNumber: 1,
      durationWeeks: 2,
      startDate: isoDate(monday),
      progressionNotes: "Keep two good repetitions in reserve. Add load only when every set feels controlled.",
      successMetric: "Complete three sessions each week and note energy after training.",
      weeks: [
        makeWeek(1, "Foundation", "Learn the movements and keep effort comfortable.", {
          1: {
            name: "Strength A",
            description: "Full-body strength with a steady pace.",
            sessionType: "Strength",
            warmup: "5 min easy walk + hip and shoulder mobility.",
            cooldown: "Walk until breathing returns to normal.",
            exercises: [
              strengthExercise("Goblet squat", 3, 8, 20, "Pause briefly at a comfortable depth."),
              strengthExercise("Incline push-up", 3, 10, null, "Use a height that keeps every rep smooth."),
              strengthExercise("One-arm dumbbell row", 3, 10, 12, "Each side.")
            ]
          },
          3: {
            name: "Easy aerobic session",
            description: "Build an easy aerobic base without chasing pace.",
            sessionType: "Cardio",
            warmup: "Start with five minutes at a relaxed pace.",
            cooldown: "Finish with an easy walk.",
            exercises: [
              cardioExercise("Outdoor walk or easy jog", 28, "Conversational effort; walk whenever needed.")
            ]
          },
          5: {
            name: "Strength B + mobility",
            description: "A short strength session followed by relaxed mobility.",
            sessionType: "Mixed",
            warmup: "5 min brisk walk.",
            cooldown: "Gentle breathing and hip mobility.",
            exercises: [
              strengthExercise("Reverse lunge", 3, 8, null, "Each side; hold support if useful."),
              strengthExercise("Glute bridge", 3, 12, null),
              guidedExercise("Hip mobility flow", 10, "Move through a comfortable range.")
            ]
          }
        }),
        makeWeek(2, "Build", "Repeat the same pattern; add one repetition only if recovery is good.", {
          1: {
            name: "Strength A · Build",
            description: "Repeat the familiar full-body session.",
            sessionType: "Strength",
            warmup: "5 min easy walk + two light practice sets.",
            cooldown: "Easy walk and relaxed breathing.",
            exercises: [
              strengthExercise("Goblet squat", 3, 9, 20, "Add one rep per set if the previous week felt comfortable."),
              strengthExercise("Incline push-up", 3, 10, null),
              strengthExercise("One-arm dumbbell row", 3, 11, 12, "Each side.")
            ]
          },
          3: {
            name: "Easy aerobic session",
            description: "A relaxed repeat of the first week's aerobic work.",
            sessionType: "Cardio",
            warmup: "Begin slowly for five minutes.",
            cooldown: "Finish at an easy walking pace.",
            exercises: [
              cardioExercise("Outdoor walk or easy jog", 30, "Keep the effort conversational.")
            ]
          },
          5: {
            name: "Strength B + mobility",
            description: "Keep the same movements and focus on balance.",
            sessionType: "Mixed",
            warmup: "5 min brisk walk.",
            cooldown: "Gentle breathing and hip mobility.",
            exercises: [
              strengthExercise("Reverse lunge", 3, 9, null, "Each side."),
              strengthExercise("Glute bridge", 3, 13, null),
              guidedExercise("Hip mobility flow", 12, "Move smoothly without forcing range.")
            ]
          }
        })
      ]
    };

    const draftProgram = {
      name: "Return-to-Running · Saved draft",
      description: "A gradual three-week return with walk-run intervals and simple strength work.",
      version: 1,
      phase: "Return to running",
      weekNumber: 1,
      durationWeeks: 3,
      startDate: isoDate(addDays(monday, 7)),
      progressionNotes: "Keep the running intervals easy. Repeat a week if recovery is incomplete.",
      successMetric: "Finish each session feeling able to continue.",
      weeks: [
        makeWeek(1, "Re-entry", "Alternate easy jogging and walking.", {
          1: {
            name: "Walk-run intervals",
            description: "Short, relaxed jog intervals.",
            sessionType: "Cardio",
            warmup: "5 min brisk walk.",
            cooldown: "5 min easy walk.",
            exercises: [
              { ...cardioExercise("Walk-run intervals", 24, "6 rounds: 1 min easy jog, 3 min walk."), format: "intervals", rounds: 6, workSeconds: 60, recoverySeconds: 180 }
            ]
          },
          4: {
            name: "Foundational strength",
            description: "Easy lower-body and trunk strength.",
            sessionType: "Strength",
            exercises: [
              strengthExercise("Sit-to-stand", 2, 10, null),
              strengthExercise("Calf raise", 2, 12, null),
              strengthExercise("Bird dog", 2, 8, null, "Each side.")
            ]
          }
        }),
        makeWeek(2, "Repeat", "Repeat the same intervals; add time only if the first week felt easy.", {
          1: {
            name: "Walk-run intervals",
            description: "Keep every jog interval relaxed.",
            sessionType: "Cardio",
            warmup: "5 min brisk walk.",
            cooldown: "5 min easy walk.",
            exercises: [
              { ...cardioExercise("Walk-run intervals", 28, "7 rounds: 1 min easy jog, 3 min walk."), format: "intervals", rounds: 7, workSeconds: 60, recoverySeconds: 180 }
            ]
          },
          4: {
            name: "Foundational strength",
            description: "Repeat the strength session with comfortable range of motion.",
            sessionType: "Strength",
            exercises: [
              strengthExercise("Sit-to-stand", 2, 11, null),
              strengthExercise("Calf raise", 2, 13, null),
              strengthExercise("Bird dog", 2, 9, null, "Each side.")
            ]
          }
        }),
        makeWeek(3, "Progress", "A third week is saved as a draft example, not yet published.", {
          1: {
            name: "Walk-run intervals",
            description: "Progress only if the previous sessions felt comfortable.",
            sessionType: "Cardio",
            exercises: [
              { ...cardioExercise("Walk-run intervals", 32, "8 rounds: 1 min easy jog, 3 min walk."), format: "intervals", rounds: 8, workSeconds: 60, recoverySeconds: 180 }
            ]
          }
        })
      ]
    };

    const historyDateOne = isoDate(addDays(monday, -14));
    const historyDateTwo = isoDate(addDays(monday, -7));
    const recentSessions = [
      {
        id: "mock-session-recent",
        status: "completed",
        performedOn: historyDateTwo,
        program: { versionNumber: 3 },
        workoutName: "Strength A",
        note: "Good energy; kept the final set smooth.",
        exercises: [
          {
            name: "Goblet squat",
            prescription: { activityType: "strength", sets: 3, reps: 8, load: 20, loadUnit: "kg" },
            actualSets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 8, load: 20, loadUnit: "kg" }))
          },
          {
            name: "Incline push-up",
            prescription: { activityType: "strength", sets: 3, reps: 10 },
            actualSets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 10 }))
          }
        ]
      },
      {
        id: "mock-session-older",
        status: "completed",
        performedOn: historyDateOne,
        program: { versionNumber: 2 },
        workoutName: "Strength A",
        note: "First week back to regular training.",
        exercises: [
          {
            name: "Goblet squat",
            prescription: { activityType: "strength", sets: 3, reps: 8, load: 18, loadUnit: "kg" },
            actualSets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 8, load: 18, loadUnit: "kg" }))
          }
        ]
      }
    ];

    const clientExercise = (id, name, sets, reps, load, extra = {}) => ({
      id,
      name,
      sets,
      reps,
      load: load ?? null,
      loadUnit: "kg",
      category: "strength",
      format: "sets",
      ...extra
    });

    const assignments = [
      {
        id: "mock-assignment-strength-a",
        workout_id: "mock-workout-strength-a",
        program_version_id: "mock-version-strength-v3",
        scheduled_date: isoDate(monday),
        status: "planned",
        program_name: publishedProgram.name,
        version_number: 3,
        week_number: 1,
        workout_name: "Strength A",
        workout_description: "Full-body strength with a steady pace.",
        warmup: "5 min easy walk + hip and shoulder mobility.",
        cooldown: "Walk until breathing returns to normal.",
        exercises: [
          {
            ...clientExercise("mock-exercise-goblet", "Goblet squat", 3, 8, 20, { notes: "Pause briefly at a comfortable depth." }),
            previousPerformance: {
              performedOn: historyDateTwo,
              sets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 8, load: 20, loadUnit: "kg" }))
            }
          },
          {
            ...clientExercise("mock-exercise-push-up", "Incline push-up", 3, 10, null),
            previousPerformance: {
              performedOn: historyDateTwo,
              sets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 10 }))
            }
          },
          clientExercise("mock-exercise-row", "One-arm dumbbell row", 3, 10, 12, { notes: "Each side." })
        ]
      },
      {
        id: "mock-assignment-cardio",
        workout_id: "mock-workout-cardio",
        program_version_id: "mock-version-strength-v3",
        scheduled_date: isoDate(addDays(monday, 2)),
        status: "planned",
        program_name: publishedProgram.name,
        version_number: 3,
        week_number: 1,
        workout_name: "Easy aerobic session",
        workout_description: "Build an easy aerobic base without chasing pace.",
        warmup: "Start with five minutes at a relaxed pace.",
        cooldown: "Finish with an easy walk.",
        exercises: [{
          id: "mock-exercise-walk-jog",
          name: "Outdoor walk or easy jog",
          sets: 1,
          reps: null,
          category: "cardio",
          format: "continuous",
          duration: 28,
          durationUnit: "minutes",
          distanceUnit: "km",
          notes: "Conversational effort; walk whenever needed."
        }]
      },
      {
        id: "mock-assignment-strength-b",
        workout_id: "mock-workout-strength-b",
        program_version_id: "mock-version-strength-v3",
        scheduled_date: isoDate(addDays(monday, 4)),
        status: "planned",
        program_name: publishedProgram.name,
        version_number: 3,
        week_number: 1,
        workout_name: "Strength B + mobility",
        workout_description: "A short strength session followed by relaxed mobility.",
        warmup: "5 min brisk walk.",
        cooldown: "Gentle breathing and hip mobility.",
        exercises: [
          clientExercise("mock-exercise-lunge", "Reverse lunge", 3, 8, null, { notes: "Each side; hold support if useful." }),
          clientExercise("mock-exercise-bridge", "Glute bridge", 3, 12, null),
          {
            id: "mock-exercise-mobility",
            name: "Hip mobility flow",
            sets: 1,
            reps: null,
            category: "guided",
            format: "guided",
            duration: 10,
            durationUnit: "minutes",
            notes: "Move through a comfortable range."
          }
        ]
      }
    ];

    const performanceHistory = [
      {
        sessionId: "mock-session-recent",
        performedOn: historyDateTwo,
        exerciseName: "Goblet squat",
        workoutName: "Strength A",
        sets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 8, load: 20, loadUnit: "kg" })),
        prescription: { version: 3, activityType: "strength", sets: 3, reps: 8, load: 20, loadUnit: "kg" }
      },
      {
        sessionId: "mock-session-older",
        performedOn: historyDateOne,
        exerciseName: "Goblet squat",
        workoutName: "Strength A",
        sets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 8, load: 18, loadUnit: "kg" })),
        prescription: { version: 2, activityType: "strength", sets: 3, reps: 8, load: 18, loadUnit: "kg" }
      },
      {
        sessionId: "mock-session-recent",
        performedOn: historyDateTwo,
        exerciseName: "Incline push-up",
        workoutName: "Strength A",
        sets: [1, 2, 3].map(setNumber => ({ setNumber, reps: 10 })),
        prescription: { version: 3, activityType: "strength", sets: 3, reps: 10 }
      }
    ];

    const makeRecord = ({ id, program, published, link, personName, archivedCount = 0, versionCount = 0 }) => {
      const version = Number(program.version) || 1;
      const currentVersionId = published ? `mock-version-${id}-v${version}` : null;
      const row = {
        id,
        kind: "library",
        name: program.name,
        description: program.description,
        version,
        versionStatus: published ? "published" : "draft",
        hasCurrentVersion: Boolean(published),
        hasPublishedVersion: Boolean(published),
        currentVersion: published ? version : null,
        currentVersionId,
        publishedVersionCount: versionCount || (published ? 1 : 0),
        archivedVersionCount: archivedCount,
        durationWeeks: program.weeks.length,
        updatedAt: new Date().toISOString(),
        startDate: program.startDate,
        publishedStartDate: published ? program.startDate : null,
        hasActivePrivateLink: Boolean(link)
      };
      const versions = published
        ? Array.from({ length: Math.max(1, versionCount || 1) }, (_, index) => {
          const versionNumber = Math.max(1, version - index);
          const date = isoDate(addDays(monday, -7 * index));
          return {
            version: versionNumber,
            status: index === 0 ? "published" : "archived",
            createdAt: date,
            publishedAt: date
          };
        })
        : [];
      return {
        row,
        program: clone(program),
        meta: {
          id,
          kind: "library",
          personName,
          revision: version,
          version,
          versionStatus: row.versionStatus,
          currentVersion: row.currentVersion,
          currentVersionId,
          clientId: null
        },
        versions
      };
    };

    const publishedRecord = makeRecord({
      id: "mock-program-strength",
      program: publishedProgram,
      published: true,
      link: true,
      personName: "Taylor",
      archivedCount: 2,
      versionCount: 1
    });
    const draftRecord = makeRecord({
      id: "mock-program-running-draft",
      program: draftProgram,
      published: false,
      link: false,
      personName: "Taylor"
    });

    const workoutTemplate = {
      id: "mock-template-strength-a",
      type: "workout",
      name: "Strength A · 35 minutes",
      data: clone(publishedProgram.weeks[0].days.find(day => day.weekday === 1))
    };
    const weekTemplate = {
      id: "mock-template-foundation-week",
      type: "week",
      name: "Foundation · three sessions",
      data: clone(publishedProgram.weeks[0])
    };

    return {
      programs: [publishedRecord, draftRecord],
      recipient: {
        token: "mock-recipient",
        data: {
          personName: "Taylor",
          directProgram: false,
          program: {
            id: publishedRecord.row.id,
            name: publishedProgram.name,
            version: publishedProgram.version,
            revision: publishedRecord.meta.revision
          },
          assignments,
          performanceHistory,
          editableProgram: clone(publishedProgram)
        }
      },
      recentSessions,
      templates: [workoutTemplate, weekTemplate],
      nextProgramNumber: 1,
      nextTemplateNumber: 1,
      nextSessionNumber: 1
    };
  }

  function getRecord(state, id) {
    return state.programs.find(record => record.row.id === id);
  }

  function refreshRecord(record) {
    record.row.name = record.program.name || "Untitled program";
    record.row.description = record.program.description || "";
    record.row.version = Number(record.program.version) || record.row.version || 1;
    record.row.durationWeeks = Array.isArray(record.program.weeks) ? record.program.weeks.length : 1;
    record.row.updatedAt = new Date().toISOString();
    record.row.startDate = record.program.startDate || null;
    record.row.publishedStartDate = record.row.hasCurrentVersion ? record.row.startDate : null;
    record.meta.version = record.row.version;
    record.meta.versionStatus = record.row.versionStatus;
  }

  function isComplete(program) {
    return Array.isArray(program?.weeks)
      && program.weeks.length > 0
      && program.weeks.every(week => Array.isArray(week.days)
        && week.days.some(day => day.enabled && Array.isArray(day.exercises) && day.exercises.length));
  }

  function listPrograms(state) {
    return state.programs.map(record => clone(record.row));
  }

  function programOverview(record, state) {
    return {
      program: {
        ...clone(record.row),
        currentVersionNumber: record.row.currentVersion,
        startDate: record.program.startDate
      },
      recentSessions: clone(state.recentSessions)
    };
  }

  function programMeta(record) {
    return {
      ...clone(record.meta),
      revision: Number(record.meta.revision) || 1,
      currentVersion: record.row.currentVersion,
      currentVersionId: record.row.currentVersionId
    };
  }

  function parseBody(body) {
    if (!body) return {};
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return {};
      }
    }
    return body;
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function recordClientSession(state, body) {
    const assignment = state.recipient.data.assignments.find(item => item.id === body.assignmentId);
    if (!assignment) return { status: 404, body: { ok: false, error: "Mock workout not found." } };
    const performedOn = body.performedOn || assignment.scheduled_date;
    const sessionId = `mock-session-new-${state.nextSessionNumber++}`;
    const historyItems = [];

    for (const submittedExercise of body.exercises || []) {
      const exercise = assignment.exercises.find(item => item.id === submittedExercise.workoutExerciseId);
      if (!exercise) continue;
      const sets = (submittedExercise.sets || [])
        .map((set, index) => ({
          setNumber: index + 1,
          reps: numberOrNull(set.reps),
          load: numberOrNull(set.load),
          loadUnit: set.loadUnit || exercise.loadUnit || "kg",
          duration: numberOrNull(set.duration),
          durationUnit: exercise.durationUnit || "minutes",
          distance: numberOrNull(set.distance),
          distanceUnit: set.distanceUnit || exercise.distanceUnit || "km"
        }))
        .filter(set => [set.reps, set.load, set.duration, set.distance].some(value => value !== null));
      if (!sets.length) continue;
      exercise.previousPerformance = { performedOn, sets: clone(sets) };
      historyItems.push({
        sessionId,
        performedOn,
        exerciseName: exercise.name,
        workoutName: assignment.workout_name,
        sets: clone(sets),
        prescription: {
          version: assignment.version_number,
          activityType: exercise.category,
          sets: exercise.sets,
          reps: exercise.reps,
          load: exercise.load,
          loadUnit: exercise.loadUnit,
          duration: exercise.duration,
          durationUnit: exercise.durationUnit,
          distance: exercise.distance,
          distanceUnit: exercise.distanceUnit
        }
      });
    }

    if (!historyItems.length) {
      return { status: 400, body: { ok: false, error: "Enter at least one completed set." } };
    }
    assignment.status = "completed";
    state.recipient.data.performanceHistory = [
      ...historyItems,
      ...state.recipient.data.performanceHistory
    ];
    const session = {
      id: sessionId,
      status: "completed",
      performedOn,
      workoutName: assignment.workout_name,
      note: String(body.note || ""),
      exercises: historyItems.map(item => ({
        name: item.exerciseName,
        actualSets: clone(item.sets)
      }))
    };
    return { status: 201, body: { ok: true, session } };
  }

  function createMockPreviewHarness(page) {
    const state = makeState();
    const requests = [];

    function handleRequest({ url, method = "GET", body }) {
      const parsedUrl = new URL(url, "http://workoutplanner-mock.local");
      const pathname = parsedUrl.pathname;
      const upperMethod = String(method || "GET").toUpperCase();
      if (pathname !== "/api" && !pathname.startsWith("/api/")) {
        return { handled: false, status: 0, body: null };
      }

      const parsedBody = parseBody(body);
      requests.push({ page, method: upperMethod, path: pathname });

      if (pathname === "/api/admin/logout" && upperMethod === "POST") {
        return { handled: true, status: 200, body: { ok: true } };
      }

      if (pathname === "/api/workoutplanner/programs" && upperMethod === "GET") {
        return { handled: true, status: 200, body: { ok: true, programs: listPrograms(state) } };
      }

      if (pathname === "/api/workoutplanner/programs" && upperMethod === "POST") {
        const program = clone(parsedBody.program || {});
        const id = `mock-program-new-${state.nextProgramNumber++}`;
        const version = Number(program.version) || 1;
        const record = {
          row: {
            id,
            kind: "library",
            name: program.name || "Untitled program",
            description: program.description || "",
            version,
            versionStatus: "draft",
            hasCurrentVersion: false,
            hasPublishedVersion: false,
            currentVersion: null,
            currentVersionId: null,
            publishedVersionCount: 0,
            archivedVersionCount: 0,
            durationWeeks: Array.isArray(program.weeks) ? program.weeks.length : 1,
            updatedAt: new Date().toISOString(),
            startDate: program.startDate || null,
            publishedStartDate: null,
            hasActivePrivateLink: false
          },
          program,
          meta: {
            id,
            kind: "library",
            personName: parsedBody.personName || "Taylor",
            revision: 1,
            version,
            versionStatus: "draft",
            currentVersion: null,
            currentVersionId: null,
            clientId: null
          },
          versions: []
        };
        state.programs.unshift(record);
        return {
          handled: true,
          status: 201,
          body: { ok: true, program: clone(record.program), meta: programMeta(record) }
        };
      }

      const programMatch = pathname.match(/^\/api\/workoutplanner\/programs\/([^/]+)(?:\/(overview|versions|link|publish))?$/);
      if (programMatch) {
        const id = decodeURIComponent(programMatch[1]);
        const action = programMatch[2] || "";
        const record = getRecord(state, id);
        if (!record) {
          return { handled: true, status: 404, body: { ok: false, error: "Mock program not found." } };
        }
        if (!action && upperMethod === "GET") {
          return {
            handled: true,
            status: 200,
            body: { ok: true, program: clone(record.program), meta: programMeta(record) }
          };
        }
        if (!action && upperMethod === "PUT") {
          record.program = clone(parsedBody.program || record.program);
          record.meta.personName = parsedBody.personName || record.meta.personName;
          record.meta.revision += 1;
          if (parsedBody.makeCurrentWhenValid && isComplete(record.program)) {
            const priorVersion = record.row.currentVersion;
            const nextVersion = Math.max(Number(record.row.version) || 1, Number(record.program.version) || 1) + 1;
            record.program.version = nextVersion;
            record.row.version = nextVersion;
            record.row.currentVersion = nextVersion;
            record.row.currentVersionId = `mock-version-${id}-v${nextVersion}`;
            record.row.hasCurrentVersion = true;
            record.row.hasPublishedVersion = true;
            record.row.versionStatus = "published";
            record.row.publishedVersionCount = Math.max(1, record.row.publishedVersionCount || 0);
            if (priorVersion) record.row.archivedVersionCount += 1;
            record.meta.currentVersion = nextVersion;
            record.meta.currentVersionId = record.row.currentVersionId;
            record.meta.version = nextVersion;
            record.meta.versionStatus = "published";
          }
          refreshRecord(record);
          return {
            handled: true,
            status: 200,
            body: {
              ok: true,
              program: clone(record.program),
              meta: { ...programMeta(record), isCurrent: Boolean(record.row.hasCurrentVersion), unchanged: false }
            }
          };
        }
        if (action === "publish" && upperMethod === "POST") {
          const oldVersion = record.row.currentVersion;
          const nextVersion = Math.max(Number(record.row.version) || 1, Number(record.program.version) || 1);
          record.program.version = nextVersion;
          record.row.version = nextVersion;
          record.row.currentVersion = nextVersion;
          record.row.currentVersionId = `mock-version-${id}-v${nextVersion}`;
          record.row.hasCurrentVersion = true;
          record.row.hasPublishedVersion = true;
          record.row.versionStatus = "published";
          record.row.publishedVersionCount += 1;
          if (oldVersion) record.row.archivedVersionCount += 1;
          record.versions.unshift({
            version: nextVersion,
            status: "published",
            createdAt: new Date().toISOString(),
            publishedAt: new Date().toISOString()
          });
          record.meta.revision += 1;
          record.meta.currentVersion = nextVersion;
          record.meta.currentVersionId = record.row.currentVersionId;
          record.meta.version = nextVersion;
          record.meta.versionStatus = "published";
          refreshRecord(record);
          return {
            handled: true,
            status: 200,
            body: {
              ok: true,
              program: clone(record.program),
              meta: {
                ...programMeta(record),
                versionId: record.row.currentVersionId,
                publishedAssignmentCount: 0
              }
            }
          };
        }
        if (action === "overview" && upperMethod === "GET") {
          return { handled: true, status: 200, body: { ok: true, overview: programOverview(record, state) } };
        }
        if (action === "versions" && upperMethod === "GET") {
          return { handled: true, status: 200, body: { ok: true, versions: clone(record.versions) } };
        }
        if (action === "link" && upperMethod === "GET") {
          if (!record.row.hasActivePrivateLink) {
            return { handled: true, status: 404, body: { ok: false, error: "No mock private link is active." } };
          }
          return {
            handled: true,
            status: 200,
            body: { ok: true, path: "/__dev/workoutplanner/recipient/" }
          };
        }
        if (action === "link" && upperMethod === "POST") {
          record.row.hasActivePrivateLink = true;
          return {
            handled: true,
            status: 201,
            body: { ok: true, created: true, path: "/__dev/workoutplanner/recipient/" }
          };
        }
        if (action === "link" && upperMethod === "DELETE") {
          const revoked = record.row.hasActivePrivateLink;
          record.row.hasActivePrivateLink = false;
          return { handled: true, status: 200, body: { ok: true, revoked } };
        }
      }

      const clientMatch = pathname.match(/^\/api\/client\/([^/]+)(?:\/(program|sessions))?$/);
      if (clientMatch && decodeURIComponent(clientMatch[1]) === state.recipient.token) {
        const action = clientMatch[2] || "";
        if (!action && upperMethod === "GET") {
          return { handled: true, status: 200, body: { ok: true, data: clone(state.recipient.data) } };
        }
        if (action === "program" && upperMethod === "GET") {
          return {
            handled: true,
            status: 200,
            body: {
              ok: true,
              program: clone(state.recipient.data.editableProgram),
              meta: {
                revision: state.recipient.data.program.revision,
                version: state.recipient.data.program.version
              }
            }
          };
        }
        if (action === "program" && upperMethod === "PUT") {
          state.recipient.data.editableProgram = clone(parsedBody.program || state.recipient.data.editableProgram);
          const version = Number(state.recipient.data.program.version) + 1;
          state.recipient.data.program.version = version;
          state.recipient.data.program.revision = Number(state.recipient.data.program.revision) + 1;
          return {
            handled: true,
            status: 200,
            body: {
              ok: true,
              program: clone(state.recipient.data.editableProgram),
              meta: {
                version,
                revision: state.recipient.data.program.revision,
                unchanged: false
              }
            }
          };
        }
        if (action === "sessions" && upperMethod === "POST") {
          return { handled: true, ...recordClientSession(state, parsedBody) };
        }
      }

      if (pathname === "/api/templates" && upperMethod === "GET") {
        return { handled: true, status: 200, body: { ok: true, templates: clone(state.templates) } };
      }
      if (pathname === "/api/templates" && upperMethod === "POST") {
        const template = {
          id: `mock-template-new-${state.nextTemplateNumber++}`,
          type: parsedBody.type || "workout",
          name: parsedBody.name || "Untitled template",
          data: clone(parsedBody.data || {})
        };
        state.templates.unshift(template);
        return { handled: true, status: 201, body: { ok: true, template: clone(template) } };
      }
      const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
      if (templateMatch && upperMethod === "DELETE") {
        const id = decodeURIComponent(templateMatch[1]);
        const previousCount = state.templates.length;
        state.templates = state.templates.filter(template => template.id !== id);
        return { handled: true, status: 200, body: { ok: true, deleted: state.templates.length < previousCount } };
      }

      return {
        handled: true,
        status: 404,
        body: { ok: false, error: "This API request is blocked in the mock preview." }
      };
    }

    function createFetch(nativeFetch, makeResponse, origin) {
      return async function mockPreviewFetch(input, init = {}) {
        const rawUrl = typeof input === "string" ? input : input?.url || String(input);
        const parsedUrl = new URL(rawUrl, origin || "http://workoutplanner-mock.local");
        if (parsedUrl.pathname !== "/api" && !parsedUrl.pathname.startsWith("/api/")) {
          return nativeFetch(input, init);
        }
        let body = init.body;
        if (body === undefined && input && typeof input.clone === "function") {
          try {
            body = await input.clone().text();
          } catch {
            body = "";
          }
        }
        const result = handleRequest({
          url: parsedUrl.href,
          method: init.method || input?.method || "GET",
          body
        });
        return makeResponse(result.body, result.status);
      };
    }

    return {
      page,
      state,
      requests,
      handleRequest,
      createFetch
    };
  }

  return {
    createMockPreviewHarness
  };
});
