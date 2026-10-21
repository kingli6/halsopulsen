const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.env.SESSION_SECRET = "workoutplanner-link-unit-test-secret";
const {
  findClientDataByToken,
  generateClientAccessToken,
  getClientAccessLink,
  getProgramAccessLink,
  hashClientAccessToken,
  hasClientAccessToken,
  revokeClientAccessLink,
  revokeProgramAccessLink,
  regenerateClientAccessLink,
  regenerateProgramAccessLink
} = require("../workoutplanner/client-access");
const {
  isCompleteProgramForCurrent,
  listProgramVersions,
  saveProgram
} = require("../workoutplanner/program-library");

async function run() {
  const completeProgram = {
    name: "Current version candidate",
    startDate: "2026-10-12",
    weeks: [{
      weekNumber: 1,
      days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: weekday === 1,
        exercises: weekday === 1 ? [{
          name: "Squat",
          activityType: "strength",
          format: "sets",
          targetValue: 8,
          targetUnit: "reps",
          sets: 1
        }, {
          name: "Easy run",
          activityType: "cardio",
          format: "continuous",
          targetValue: 35,
          targetUnit: "minutes",
          sets: 1
        }] : []
      }))
    }]
  };
  assert.strictEqual(isCompleteProgramForCurrent(completeProgram), true);
  assert.strictEqual(
    isCompleteProgramForCurrent({ ...completeProgram, startDate: "" }),
    false,
    "A missing start date must leave the save as a draft."
  );
  assert.strictEqual(
    isCompleteProgramForCurrent({
      ...completeProgram,
      weeks: [{ ...completeProgram.weeks[0], days: completeProgram.weeks[0].days.slice(1) }]
    }),
    false,
    "A week with fewer than seven explicit days must leave the save as a draft."
  );
  assert.strictEqual(
    isCompleteProgramForCurrent({
      ...completeProgram,
      weeks: [{
        ...completeProgram.weeks[0],
        days: completeProgram.weeks[0].days.map(day => ({ ...day, enabled: false, exercises: [] }))
      }]
    }),
    false,
    "A program without an active workout must leave the save as a draft."
  );

  const coachId = "11111111-1111-4111-8111-111111111111";
  const programId = "22222222-2222-4222-8222-222222222222";
  const versionId = "33333333-3333-4333-8333-333333333333";
  const editedVersionId = "55555555-5555-4555-8555-555555555555";
  function makeSavedRows(program, options = {}) {
    const savedVersionId = options.versionId || versionId;
    const currentVersionId = options.currentVersionId || savedVersionId;
    const revision = options.revision ?? 5;
    const versionNumber = options.versionNumber ?? 1;
    const versionStatus = options.versionStatus || "published";
    return program.weeks.flatMap(week => week.days.flatMap(day => {
      const activities = day.exercises.length ? day.exercises : [null];
      const isRest = !day.enabled || !day.exercises.length;
      return activities.map((activity, activityIndex) => {
        const isStrengthReps = activity?.activityType === "strength"
          && !["seconds", "minutes"].includes(activity.targetUnit);
        const isTimedActivity = activity
          && (activity.activityType === "guided" || activity.activityType === "cardio");
        return {
          program_id: programId,
          client_id: null,
          program_name: program.name,
          program_description: program.description || "",
          person_name: "Ada",
          program_status: "active",
          program_kind: "library",
          source_program_id: null,
          source_version_id: null,
          current_version_id: currentVersionId,
          program_revision: revision,
          program_updated_at: "2026-10-11T10:00:00.000Z",
          start_date: program.startDate,
          version_id: savedVersionId,
          version_number: versionNumber,
          version_status: versionStatus,
          week_id: "week-a",
          week_number: week.weekNumber,
          week_name: week.name || week.phase || "Week 1",
          phase: week.phase || "Foundation",
          progression_notes: week.progressionNotes || "",
          success_metric: week.successMetric || "",
          workout_id: `workout-${day.weekday}`,
          day_of_week: day.weekday === 0 ? 7 : day.weekday,
          workout_name: day.name || (isRest ? "Rest / open day" : "Workout"),
          workout_description: day.description || "",
          session_type: day.sessionType || "Other",
          warmup: day.warmup || "",
          cooldown: day.cooldown || "",
          is_rest: isRest,
          workout_exercise_id: activity ? `exercise-row-${day.weekday}-${activityIndex}` : null,
          sort_order: activity ? activityIndex + 1 : null,
          exercise_id: activity
            ? (isStrengthReps
              ? "44444444-4444-4444-8444-444444444444"
              : "66666666-6666-4666-8666-666666666666")
            : null,
          sets: activity ? activity.sets : null,
          reps: isStrengthReps ? Math.trunc(activity.targetValue) : null,
          duration: isTimedActivity ? activity.targetValue : null,
          duration_unit: isTimedActivity ? "minutes" : null,
          distance: null,
          distance_unit: null,
          load: activity?.load ?? null,
          load_unit: activity?.loadUnit || "kg",
          rir: activity?.rir ?? null,
          tempo: activity?.tempo || null,
          rest_seconds: activity ? activity.restSeconds || 0 : null,
          intensity: typeof activity?.intensity === "number" ? activity.intensity : null,
          intensity_unit: null,
          work_seconds: null,
          recovery_seconds: null,
          rounds: null,
          notes: activity?.notes || null,
          resource_url: activity?.resourceUrl || null,
          planner_metadata: activity ? {
            activityType: activity.activityType,
            format: activity.format,
            targetUnit: activity.targetUnit,
            goal: activity.goal || "",
            heartRateTarget: activity.heartRateTarget || "",
            intensity: activity.intensity ?? "",
            description: activity.description || ""
          } : null,
          exercise_name: activity?.name || null,
          category: activity?.activityType || null,
          current_version_number: versionNumber
        };
      });
    }));
  }
  const savedRows = makeSavedRows(completeProgram);
  function createNoOpDatabase(rows = savedRows, revision = 5) {
    const queries = [];
    return {
      queries,
      async connect() {
        return {
          async query(sql, values) {
            queries.push({ sql, values });
            if (sql === "begin" || sql === "commit" || sql === "rollback") {
              return { rowCount: 0, rows: [] };
            }
            if (sql.includes("for update")) {
              return {
                rowCount: 1,
                rows: [{
                  id: programId,
                  kind: "library",
                  client_id: null,
                  current_version_id: versionId,
                  revision,
                  person_name: "Ada"
                }]
              };
            }
            return { rowCount: rows.length, rows };
          },
          release() {}
        };
      }
    };
  }
  const noOpDatabase = createNoOpDatabase();
  const noOpSave = await saveProgram(
    noOpDatabase,
    coachId,
    { ...completeProgram, version: 9 },
    programId,
    "Ada",
    { makeCurrentWhenValid: true, expectedRevision: 5 }
  );
  assert.strictEqual(noOpSave.unchanged, true, "An unchanged save must not create another program version.");
  assert.strictEqual(noOpSave.version, 1);
  assert.strictEqual(noOpSave.revision, 5);
  assert.strictEqual(noOpSave.isCurrent, true);
  assert.strictEqual(completeProgram.weeks[0].days[1].exercises[0].exerciseId, undefined);
  assert.strictEqual(savedRows.find(row => row.category === "strength").reps, 8);
  assert.strictEqual(completeProgram.weeks[0].days[1].exercises[1].durationMinutes, undefined);
  assert.strictEqual(
    savedRows.find(row => row.category === "cardio").duration,
    35,
    "The saved cardio row should restore its derived duration."
  );
  assert.doesNotMatch(
    noOpDatabase.queries.map(query => query.sql).join("\n"),
    /insert into public\.program_versions|delete from public\.program_weeks|update public\.programs/i
  );

  const restOnlyProgram = {
    ...completeProgram,
    weeks: completeProgram.weeks.map(week => ({
      ...week,
      days: week.days.map(day => ({ ...day, enabled: false, exercises: [] }))
    }))
  };
  const restDatabase = createNoOpDatabase(makeSavedRows(restOnlyProgram));
  const restSave = await saveProgram(
    restDatabase,
    coachId,
    restOnlyProgram,
    programId,
    "Ada",
    { makeCurrentWhenValid: true, expectedRevision: 5 }
  );
  assert.strictEqual(restSave.unchanged, true, "An unchanged all-rest program must remain unchanged.");
  assert.strictEqual(restSave.version, 1);
  assert.doesNotMatch(
    restDatabase.queries.map(query => query.sql).join("\n"),
    /insert into public\.program_versions|delete from public\.program_weeks|update public\.programs/i
  );

  const editedProgram = {
    ...completeProgram,
    weeks: completeProgram.weeks.map(week => ({
      ...week,
      days: week.days.map(day => ({
        ...day,
        exercises: day.exercises.map(activity => activity.activityType === "strength"
          ? { ...activity, targetValue: 9 }
          : activity)
      }))
    }))
  };
  const editedRows = makeSavedRows(editedProgram, {
    revision: 6,
    versionId: editedVersionId,
    currentVersionId: editedVersionId,
    versionNumber: 2
  });
  function createEditDatabase(finalRows) {
    const queries = [];
    let createdWorkouts = 0;
    let loadedProgramCount = 0;
    return {
      queries,
      async connect() {
        return {
          async query(sql, values) {
            queries.push({ sql, values });
            const normalizedSql = sql.toLowerCase();
            if (["begin", "commit", "rollback"].includes(normalizedSql)) {
              return { rowCount: 0, rows: [] };
            }
            if (normalizedSql.includes("select id, kind, client_id, current_version_id, revision")) {
              return {
                rowCount: 1,
                rows: [{
                  id: programId,
                  kind: "library",
                  client_id: null,
                  current_version_id: versionId,
                  revision: 5,
                  person_name: "Ada"
                }]
              };
            }
            if (normalizedSql.includes("from public.programs p")) {
              loadedProgramCount += 1;
              const rows = loadedProgramCount === 1 ? savedRows : finalRows;
              return { rowCount: rows.length, rows };
            }
            if (normalizedSql.includes("from public.program_versions") && normalizedSql.includes("for update")) {
              return {
                rowCount: 1,
                rows: [{ id: versionId, version_number: 1, status: "published" }]
              };
            }
            if (normalizedSql.includes("insert into public.program_versions")) {
              return { rowCount: 1, rows: [{ id: editedVersionId }] };
            }
            if (normalizedSql.includes("insert into public.program_weeks")) {
              return { rowCount: 1, rows: [{ id: "edited-week" }] };
            }
            if (normalizedSql.includes("insert into public.workouts")) {
              createdWorkouts += 1;
              return { rowCount: 1, rows: [{ id: `edited-workout-${createdWorkouts}` }] };
            }
            if (normalizedSql.includes("from public.exercises")) {
              const exerciseId = values[0] === "Squat"
                ? "44444444-4444-4444-8444-444444444444"
                : "66666666-6666-4666-8666-666666666666";
              return { rowCount: 1, rows: [{ id: exerciseId }] };
            }
            if (normalizedSql.includes("group by pw.id")) {
              return { rowCount: 1, rows: [{ workout_count: 7, day_count: 7 }] };
            }
            if (normalizedSql.includes("active_workout_count")) {
              return { rowCount: 1, rows: [{ active_workout_count: 1 }] };
            }
            return { rowCount: 1, rows: [] };
          },
          release() {}
        };
      }
    };
  }
  const editDatabase = createEditDatabase(editedRows);
  const editSave = await saveProgram(
    editDatabase,
    coachId,
    editedProgram,
    programId,
    "Ada",
    { makeCurrentWhenValid: true, expectedRevision: 5 }
  );
  assert.strictEqual(editSave.unchanged, false, "Changing prescribed reps must trigger a save.");
  assert.strictEqual(editSave.version, 2, "A changed published program must create the next version.");
  assert.strictEqual(editSave.revision, 6);
  assert.strictEqual(editSave.becameCurrent, true);
  assert.match(
    editDatabase.queries.map(query => query.sql).join("\n"),
    /insert into public\.program_versions/i
  );
  const editExerciseWrite = editDatabase.queries.find(query =>
    /insert into public\.workout_exercises/i.test(query.sql)
    && query.values[1] === "Squat"
  );
  assert.ok(editExerciseWrite, "The edited strength exercise name must be written directly to its prescription.");
  assert.strictEqual(editExerciseWrite.values[4], 9, "The edited prescribed reps must be persisted.");
  assert.doesNotMatch(
    editDatabase.queries.map(query => query.sql).join("\n"),
    /insert into public\.exercises/i,
    "Saving a workout must not create a global exercise catalog row."
  );
  assert.ok(editDatabase.queries.some(query =>
    /update public\.program_versions/i.test(query.sql)
    && /status = 'published'/i.test(query.sql)
  ), "The valid edited version must be promoted.");
  assert.ok(editDatabase.queries.some(query =>
    /update public\.programs/i.test(query.sql)
    && /current_version_id = \$1/i.test(query.sql)
  ), "The program must point at the promoted version.");
  assert.ok(editDatabase.queries.some(query =>
    /update public\.programs/i.test(query.sql)
    && /revision = revision \+ 1/i.test(query.sql)
  ), "A real edit must increment the program revision.");

  const staleDatabase = createNoOpDatabase();
  await assert.rejects(
    () => saveProgram(
      staleDatabase,
      coachId,
      completeProgram,
      programId,
      "Ada",
      { makeCurrentWhenValid: true, expectedRevision: 4 }
    ),
    error => error.statusCode === 409 && error.code === "STALE_REVISION"
  );
  assert.doesNotMatch(
    staleDatabase.queries.map(query => query.sql).join("\n"),
    /from public\.programs p/i,
    "Stale revisions must be rejected after the root revision check but before loading program content."
  );
  assert.doesNotMatch(
    staleDatabase.queries.map(query => query.sql).join("\n"),
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:programs|program_versions|program_weeks|workouts|workout_exercises|assignments)\b/i,
    "A stale revision must not write program or assignment records."
  );

  const token = generateClientAccessToken();
  assert.strictEqual(Buffer.from(token, "base64url").length, 32);
  assert.match(hashClientAccessToken(token), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hashClientAccessToken(token), token);
  assert.strictEqual(
    generateClientAccessToken("link-id-a"),
    generateClientAccessToken("link-id-a")
  );
  assert.notStrictEqual(
    generateClientAccessToken("link-id-a"),
    generateClientAccessToken("link-id-b")
  );

  let historyQuery = "";
  const versions = await listProgramVersions({
    async query(sql, values) {
      historyQuery = sql;
      assert.deepStrictEqual(values, [
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111"
      ]);
      return {
        rows: [
          {
            id: "version-current",
            version_number: 3,
            status: "published",
            created_at: "2026-10-01T10:00:00.000Z",
            published_at: "2026-10-02T10:00:00.000Z"
          },
          {
            id: "version-old",
            version_number: 2,
            status: "archived",
            created_at: "2026-09-20T10:00:00.000Z",
            published_at: "2026-09-21T10:00:00.000Z"
          }
        ]
      };
    }
  }, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  assert.match(historyQuery, /p\.coach_profile_id = \$2/);
  assert.match(historyQuery, /pv\.status in \('published', 'archived'\)/);
  assert.doesNotMatch(historyQuery, /p\.kind = 'client'/);
  assert.deepStrictEqual(versions.map(version => [version.version, version.status]), [
    [3, "published"],
    [2, "archived"]
  ]);

  const transactionQueries = [];
  const transactionClient = {
    async query(sql, values) {
      transactionQueries.push({ sql, values });
      if (sql.includes("SELECT c.id, c.display_name")) {
        return {
          rowCount: 1,
          rows: [{
            id: "client-a",
            display_name: "Ada",
            program_id: "program-a",
            program_name: "Strength"
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const generated = await regenerateClientAccessLink(
    { async connect() { return transactionClient; } },
    "coach-a",
    "client-a",
    "program-a"
  );
  assert.ok(generated.token);
  const insert = transactionQueries.find(query => query.sql.includes("INSERT INTO public.client_access_links"));
  const linkId = insert.values[0];
  const storedValue = insert.values[3];
  assert.strictEqual(insert.values[1], "client-a");
  assert.strictEqual(insert.values[2], "program-a");
  assert.strictEqual(insert.values[4], "coach-a");
  assert.strictEqual(storedValue, hashClientAccessToken(generated.token));
  assert.notStrictEqual(storedValue, generated.token);

  const recovered = await getClientAccessLink({
    async query(sql, values) {
      assert.deepStrictEqual(values, ["coach-a", "client-a", "program-a"]);
      assert.match(sql, /l\.revoked_at IS NULL/);
      return {
        rowCount: 1,
        rows: [{
          id: linkId,
          token_hash: storedValue,
          client_id: "client-a",
          display_name: "Ada",
          program_id: "program-a",
          program_name: "Strength"
        }]
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(recovered.recoverable, true);
  assert.strictEqual(recovered.token, generated.token);

  const legacyLink = await getClientAccessLink({
    async query() {
      return {
        rowCount: 1,
        rows: [{
          id: linkId,
          token_hash: hashClientAccessToken("legacy-random-token"),
          client_id: "client-a",
          display_name: "Ada",
          program_id: "program-a",
          program_name: "Strength"
        }]
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(legacyLink.recoverable, false);
  assert.strictEqual(legacyLink.token, null);

  const queries = [];
  const data = await findClientDataByToken({
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return {
          rowCount: 1,
          rows: [{
            client_id: "client-a",
            display_name: "Ada",
            active: true,
            program_id: "program-a",
            program_name: "Strength",
            program_kind: "client"
          }]
        };
      }
      return {
        rowCount: 1,
        rows: [{ id: "assignment-a", workout_name: "Strength", exercises: [] }]
      };
    }
  }, generated.token);
  assert.deepStrictEqual(data.client, { displayName: "Ada" });
  assert.deepStrictEqual(data.program, { id: "program-a", name: "Strength" });
  assert.strictEqual(data.assignments[0].id, "assignment-a");
  assert.deepStrictEqual(queries[1].values, ["client-a", "program-a"]);

  const directLinkId = "direct-link-a";
  const directToken = generateClientAccessToken(directLinkId);
  const directTokenHash = hashClientAccessToken(directToken);
  const directTransactionQueries = [];
  const directTransactionClient = {
    async query(sql, values) {
      directTransactionQueries.push({ sql, values });
      if (sql.includes("SELECT p.id, p.name, p.person_name")) {
        assert.match(sql, /p\.kind = 'library'/);
        assert.match(sql, /p\.current_version_id IS NOT NULL/i);
        assert.match(sql, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);
        return {
          rowCount: 1,
          rows: [{ id: "program-a", name: "Strength", person_name: "Ada" }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const directGenerated = await regenerateProgramAccessLink(
    { async connect() { return directTransactionClient; } },
    "coach-a",
    "program-a"
  );
  assert.ok(directGenerated.token);
  const directInsert = directTransactionQueries.find(query =>
    query.sql.includes("INSERT INTO public.client_access_links")
  );
  assert.match(directInsert.sql, /VALUES \(\$1, NULL, \$2, \$3, \$4\)/);
  assert.strictEqual(directInsert.values[1], "program-a");
  assert.strictEqual(directInsert.values[2], hashClientAccessToken(directGenerated.token));
  assert.strictEqual(directInsert.values[3], "coach-a");

  const directRecovered = await getProgramAccessLink({
    async query(sql, values) {
      assert.deepStrictEqual(values, ["coach-a", "program-a"]);
      assert.match(sql, /l\.client_id IS NULL/);
      assert.match(sql, /p\.current_version_id IS NOT NULL/i);
      assert.match(sql, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);
      return {
        rowCount: 1,
        rows: [{
          id: directLinkId,
          token_hash: directTokenHash,
          program_id: "program-a",
          program_name: "Strength",
          person_name: "Ada"
        }]
      };
    }
  }, "coach-a", "program-a");
  assert.strictEqual(directRecovered.recoverable, true);
  assert.strictEqual(directRecovered.token, directToken);

  const directQueries = [];
  const directData = await findClientDataByToken({
    async query(sql, values) {
      directQueries.push({ sql, values });
      if (directQueries.length === 1) {
        return {
          rowCount: 1,
          rows: [{
            client_id: null,
            display_name: null,
            active: null,
            program_id: "program-a",
            program_name: "Unpublished draft title",
            program_kind: "library"
          }]
        };
      }
      return {
        rowCount: 1,
        rows: [{
          program_name: "Published program",
          version_number: 4,
          scheduled_date: "2026-10-05",
          day_of_week: 1,
          week_number: 1,
          workout_name: "Published workout",
          exercises: []
        }]
      };
    }
  }, directToken);
  assert.strictEqual(directData.directProgram, true);
  assert.strictEqual(directData.client, null);
  assert.strictEqual(directData.program.name, "Published program");
  assert.strictEqual(directData.program.version, 4);
  assert.strictEqual(directData.assignments[0].program_name, "Published program");
  assert.match(directQueries[1].sql, /COALESCE\(p\.published_start_date, p\.start_date\)/i);
  assert.match(directQueries[1].sql, /candidate\.id = p\.current_version_id/i);
  assert.match(directQueries[1].sql, /candidate\.status = 'published'/i);
  assert.doesNotMatch(directQueries[1].sql, /ORDER BY candidate\.version_number DESC/i);
  assert.match(
    directQueries[1].sql,
    /GROUP BY p\.id, pv\.id, pw\.id, w\.id, pv\.version_number, pv\.published_at/
  );
  assert.doesNotMatch(directQueries[1].sql, /FROM public\.assignments/i);

  let directAccessQuery = "";
  assert.strictEqual(await hasClientAccessToken({
    async query(sql, values) {
      directAccessQuery = sql;
      assert.deepStrictEqual(values, [directTokenHash]);
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
  }, directToken), true);
  assert.match(directAccessQuery, /l\.client_id IS NULL/);
  assert.match(directAccessQuery, /p\.current_version_id IS NOT NULL/i);
  assert.match(directAccessQuery, /COALESCE\(p\.published_start_date, p\.start_date\) IS NOT NULL/i);

  const directRevokeQueries = [];
  const directRevoked = await revokeProgramAccessLink({
    async connect() {
      return {
        async query(sql, values) {
          directRevokeQueries.push({ sql, values });
          if (sql.includes("SELECT p.id, p.name, p.person_name")) {
            return {
              rowCount: 1,
              rows: [{ id: "program-a", name: "Strength", person_name: "Ada" }]
            };
          }
          if (sql.includes("UPDATE public.client_access_links")) {
            return { rowCount: 1, rows: [{ id: "direct-link-a" }] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {}
      };
    }
  }, "coach-a", "program-a");
  assert.strictEqual(directRevoked.revoked, true);
  assert.match(
    directRevokeQueries.find(query => query.sql.includes("UPDATE public.client_access_links")).sql,
    /client_id IS NULL/
  );

  const revokeQueries = [];
  const revoked = await revokeClientAccessLink({
    async connect() {
      return {
        async query(sql, values) {
          revokeQueries.push({ sql, values });
          if (sql.includes("SELECT c.id, c.display_name")) {
            return {
              rowCount: 1,
              rows: [{
                id: "client-a",
                display_name: "Ada",
                program_id: "program-a",
                program_name: "Strength"
              }]
            };
          }
          return { rowCount: 1, rows: [{ id: "link-a" }] };
        },
        release() {}
      };
    }
  }, "coach-a", "client-a", "program-a");
  assert.strictEqual(revoked.revoked, true);
  assert.deepStrictEqual(
    revokeQueries.find(query => query.sql.includes("UPDATE public.client_access_links")).values,
    ["client-a", "program-a"]
  );

  const missing = await findClientDataByToken({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  }, "invalid-token");
  assert.strictEqual(missing, null);

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "010_program-bound-client-access-links.sql"),
    "utf8"
  );
  assert.match(migration, /add column program_id uuid/);
  assert.match(migration, /client_access_links_program_client_fkey/);
  assert.match(migration, /client_access_links_one_active_per_program/);
  const directMigration = fs.readFileSync(
    path.join(__dirname, "..", "db", "workoutplanner-migrations", "011_direct-program-publishing.sql"),
    "utf8"
  );
  assert.match(directMigration, /add column person_name text not null default ''/i);
  assert.match(directMigration, /add column published_start_date date/i);
  assert.match(directMigration, /alter column client_id drop not null/i);
  assert.match(directMigration, /client_access_links_one_active_per_direct_program/i);
  assert.match(directMigration, /new\.client_id is distinct from old\.client_id/i);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.get\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.post\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/clients\/:clientId\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.get\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.post\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.match(server, /app\.delete\('\/api\/workoutplanner\/programs\/:programId\/link', requireWorkoutPlannerOwner/);
  assert.doesNotMatch(server, /app\.post\('\/api\/workoutplanner\/clients',/);
  assert.match(server, /function requireWorkoutPlannerOwner\(req, res, next\)[\s\S]*?if \(readAdminSession\(req\)\)[\s\S]*?requireLocalWorkoutPlannerCoach/);
  assert.match(server, /app\.get\('\/api\/client\/:token'/);
  assert.match(server, /app\.get\(\['\/p\/:token'/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.match(server, /res\.setHeader\('Referrer-Policy', 'no-referrer'\)/);
  const clientUi = fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8");
  assert.match(clientUi, /\/api\/client\/\$\{encodeURIComponent\(clientPage\.token\)\}\/sessions/);
  assert.match(clientUi, /method:\s*["']POST["']/);
  assert.doesNotMatch(clientUi, /api\/plans\/share|method:\s*["'](?:PUT|DELETE)|sessionList|renderSessions/);
  const adminPage = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan", "index.html"), "utf8");
  assert.doesNotMatch(adminPage, /clientCreateForm|clientCreateSection|id="clientList"/);
  assert.doesNotMatch(adminPage, /cloneProgramClientNameInput|cloneProgramNameInput|id="cloneProgramForm"/);
  const planner = fs.readFileSync(path.join(__dirname, "..", "dashboard", "plan.js"), "utf8");
  assert.match(planner, /data-create-client-copy/);
  assert.match(planner, /data-client-copy-select/);
  assert.doesNotMatch(planner, /data-clone-database-program|beginLegacyClone|legacyCloneProgramForm/);
  assert.match(planner, /\/api\/workoutplanner\/programs\/\$\{encodeURIComponent\(programId\)\}\/clone/);
  assert.match(planner, /fresh\.publishedProgram = null/);
  assert.match(planner, /data-source-version-id="\$\{escapePlanHtml\(program\.currentVersionId\)\}"/);
  assert.match(planner, /adminDatabaseWorkspace && program\.kind === "library"/);
  assert.match(planner, /loadDatabaseLibrary\(\), loadClients\(\)/);
  assert.match(planner, /data-copy-client-link/);
  assert.match(planner, /Current private link copied\. It has not been changed\./);
  assert.match(planner, /Open private link/);
  assert.match(planner, /target="_blank" rel="noopener"/);
  assert.match(planner, /data-rotate-client-link/);
  assert.match(planner, /data-create-program-link/);
  assert.match(planner, /data-rotate-program-link/);
  assert.match(planner, /data-revoke-program-link/);
  assert.match(planner, /data-toggle-program-history/);
  assert.match(planner, /restoreSelectedDatabaseProgramMetadata/);
  const programLibrary = fs.readFileSync(path.join(__dirname, "..", "workoutplanner", "program-library.js"), "utf8");
  const publishImplementation = programLibrary.slice(
    programLibrary.indexOf("async function publishProgram"),
    programLibrary.indexOf("async function cloneLibraryProgramVersion")
  );
  assert.match(publishImplementation, /p\.kind = 'library' and p\.client_id is null/);
  assert.match(publishImplementation, /and p\.client_id is not null/);
   assert.match(publishImplementation, /current_version_id = \$1/);
   assert.match(publishImplementation, /published_start_date = start_date/);
  assert.match(publishImplementation, /status = case when kind = 'client' then 'active' else status end/);
   assert.match(publishImplementation, /revision = revision \+ 1/);
  assert.doesNotMatch(publishImplementation, /client_access_links/i);
  const cloneImplementation = programLibrary.slice(
    programLibrary.indexOf("async function cloneLibraryProgramVersion"),
    programLibrary.indexOf("module.exports")
  );
  assert.match(cloneImplementation, /where c\.id = \$1/);
  assert.doesNotMatch(cloneImplementation, /insert into public\.(?:profiles|clients)\s*\(/i);
  assert.doesNotMatch(cloneImplementation, /clientName|clientIdentity/);
  assert.match(server, /req\.body\?\.clientId/);
  assert.doesNotMatch(server, /req\.body\?\.clientName/);
  assert.match(server, /\/api\/workoutplanner\/programs\/:programId\/versions/);
  const publicPage = fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.js"), "utf8");
  assert.match(publicPage, /Boolean\(result\.data\.directProgram\)/);
  assert.match(publicPage, /Published training plan/);
  assert.match(publicPage, /directProgram && item\.version_number/);
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "client.html"), "utf8"),
    /href="https:\/\/halsopulsen\.se\/"/
  );

  console.log("WorkoutPlanner private client-link tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});