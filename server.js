const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const ws = require('ws');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

const SESSION_COOKIE_NAME = 'halsopulsen_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const adminSessions = new Map();

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});
}

function sessionSignature(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('base64url');
}

function readAdminSession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE_NAME] || '';
  const separator = raw.lastIndexOf('.');
  if (separator < 1) return null;
  const token = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sessionSignature(token);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const session = adminSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${token}.${sessionSignature(token)}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  next();
}

function sameSecret(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminRedirectPath(req) {
  const originalUrl = String(req.originalUrl || '');
  const queryStart = originalUrl.indexOf('?');
  return `/admin/plans${queryStart === -1 ? '' : originalUrl.slice(queryStart)}`;
}

app.get('/api/admin/session', (req, res) => {
  res.json({ ok: true, authenticated: Boolean(readAdminSession(req)) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ ok: false, error: 'Admin sign-in has not been configured yet.' });
  }
  if (!sameSecret(req.body?.password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'That password is not correct.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, {
    ownerHash: adminOwnerHash(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  setAdminCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const raw = parseCookies(req)[SESSION_COOKIE_NAME] || '';
  const separator = raw.lastIndexOf('.');
  if (separator > 0) adminSessions.delete(raw.slice(0, separator));
  clearAdminCookie(res);
  res.json({ ok: true });
});

// Keep the old planner and generic dashboard URLs from looking like participant
// accounts now that the product has explicit admin and participant boundaries.
app.get(['/dashboard', '/dashboard/'], (req, res) => res.redirect('/admin'));
app.get(['/dashboard/index.html'], (req, res) => res.redirect('/admin'));
app.get(['/dashboard/plan', '/dashboard/plan/'], (req, res) => res.redirect(adminRedirectPath(req)));
app.get(['/dashboard/plan/index.html'], (req, res) => res.redirect('/admin/plans'));
app.get('/admin', (req, res) => {
  if (readAdminSession(req)) return res.redirect('/admin/plans');
  res.sendFile(path.join(__dirname, 'dashboard', 'admin', 'index.html'));
});
app.get(['/admin/plans', '/admin/plans/'], (req, res) => {
  if (!readAdminSession(req)) return res.redirect(`/admin?next=${encodeURIComponent(adminRedirectPath(req))}`);
  res.sendFile(path.join(__dirname, 'dashboard', 'plan', 'index.html'));
});
app.get(['/p/:token', '/p/:token/'], (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'index.html')));

app.use(express.static(path.join(__dirname)));

const SUPABASE_READY = !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
const supabase = SUPABASE_READY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { realtime: { transport: ws } })
  : null;

const OPENAI_READY = !!process.env.OPENAI_API_KEY;
const openai = OPENAI_READY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const PLAN_STORAGE_DIR = path.join(__dirname, 'storage');
const PLAN_STORAGE_PATH = path.join(PLAN_STORAGE_DIR, 'published-plans.json');

if (!SUPABASE_READY) console.warn('⚠  SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — challenge features disabled.');
if (!OPENAI_READY)  console.warn('⚠  OPENAI_API_KEY not set — AI commentary disabled.');
if (!process.env.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD not set — admin sign-in disabled until configured.');

function adminOwnerHash() {
  return crypto.createHash('sha256').update('halsopulsen-admin-owner').digest('hex');
}

function readPublishedPlans() {
  try {
    if (!fs.existsSync(PLAN_STORAGE_PATH)) return [];
    const value = JSON.parse(fs.readFileSync(PLAN_STORAGE_PATH, 'utf8'));
    const plans = Array.isArray(value) ? value : [];
    const activePlans = plans.filter(plan => !plan.deletedAt);
    if (activePlans.length !== plans.length) writePublishedPlans(activePlans);
    return activePlans;
  } catch (error) {
    console.error('Could not read published plans:', error.message);
    return [];
  }
}

function writePublishedPlans(plans) {
  fs.mkdirSync(PLAN_STORAGE_DIR, { recursive: true });
  const temporaryPath = `${PLAN_STORAGE_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(plans, null, 2));
  fs.renameSync(temporaryPath, PLAN_STORAGE_PATH);
}

function publicPlanSummary(plan) {
  const program = plan.program || {};
  const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
  const logs = Array.isArray(plan.logs) ? plan.logs : [];
  return {
    id: plan.id,
    name: plan.name,
    personName: plan.personName || 'Participant',
    goal: plan.goal,
    description: plan.description,
    version: plan.version,
    phase: program.phase || 'Foundation',
    weekNumber: Number(program.weekNumber) || 1,
    durationWeeks: Number(program.durationWeeks) || 1,
    startDate: program.startDate || '',
    progressionNotes: program.progressionNotes || '',
    successMetric: program.successMetric || '',
    publishedAt: plan.publishedAt,
    sharePath: plan.shareToken ? `/p/${plan.shareToken}/` : '',
    hasParticipantActivity: logs.length > 0 || assignments.some(assignment =>
      assignment?.moved || (assignment?.status && assignment.status !== 'planned')
    )
  };
}

function ownerPlanSummaries(plans) {
  const childPlanIds = new Set(plans.map(plan => plan.parentPlanId).filter(Boolean));
  return plans.map(plan => ({
    ...publicPlanSummary(plan),
    isCurrent: !childPlanIds.has(plan.id)
  }));
}

function validatePlanPayload(body) {
  if (!body) return 'A plan payload is required.';
  const program = body.program;
  const hasWeeks = Array.isArray(program?.weeks) && program.weeks.length > 0;
  const hasLegacyDays = Array.isArray(program?.days) && program.days.length === 7;
  if (!hasWeeks && !hasLegacyDays) {
    return 'A complete program with at least one seven-day week is required.';
  }
  if (hasWeeks && program.weeks.some(week => !Array.isArray(week?.days) || week.days.length !== 7)) {
    return 'Every program week must contain seven days.';
  }
  if (JSON.stringify(program).length > 150000) {
    return 'The program is too large.';
  }
  return null;
}

function parseISODate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeekISO(value) {
  const date = parseISODate(value) || new Date();
  date.setDate(date.getDate() - date.getDay());
  return formatISODate(date);
}

function addDaysISO(value, amount) {
  const date = parseISODate(value) || new Date();
  date.setDate(date.getDate() + amount);
  return formatISODate(date);
}

function daysBetweenISO(start, end) {
  const startDate = parseISODate(start);
  const endDate = parseISODate(end);
  return startDate && endDate ? Math.round((endDate - startDate) / 86400000) : 0;
}

function workoutForProgramDate(program, date) {
  const weeks = Array.isArray(program?.weeks) && program.weeks.length ? program.weeks : [program];
  const start = startOfWeekISO(program?.startDate);
  const weekIndex = Math.max(0, Math.min(weeks.length - 1, Math.floor(daysBetweenISO(start, date) / 7)));
  const weekday = parseISODate(date).getDay();
  const week = weeks[weekIndex];
  const day = Array.isArray(week?.days)
    ? week.days.find(item => Number(item.weekday) === weekday)
    : null;
  return day?.enabled && Array.isArray(day.exercises) && day.exercises.length ? { week, day } : null;
}

function assignmentsForUpdatedProgram(program, existingAssignments, assignmentPrefix, effectiveDate) {
  const assignments = Array.isArray(existingAssignments) ? existingAssignments : [];
  const start = startOfWeekISO(program?.startDate);
  const end = addDaysISO(start, (Array.isArray(program?.weeks) && program.weeks.length ? program.weeks.length : 1) * 7 - 1);
  const preserved = assignments.filter(assignment => {
    const status = assignment?.status || 'planned';
    return Boolean(assignment?.moved) || status !== 'planned' || String(assignment?.date || '') < effectiveDate;
  });
  const occupiedDates = new Set(
    preserved.flatMap(assignment => [assignment?.date, assignment?.recommendedDate]).filter(Boolean)
  );
  const generated = [];
  const firstDate = effectiveDate > start ? effectiveDate : start;
  for (let index = 0; index <= daysBetweenISO(firstDate, end); index += 1) {
    const date = addDaysISO(firstDate, index);
    if (occupiedDates.has(date)) continue;
    const scheduled = workoutForProgramDate(program, date);
    if (!scheduled) continue;
    generated.push({
      id: `${assignmentPrefix || 'assignment'}-${date}`,
      date,
      recommendedDate: date,
      status: 'planned',
      moved: false,
      weekNumber: Number(scheduled.week?.weekNumber) || 1,
      workout: scheduled.day
    });
  }
  return [...preserved, ...generated].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function demoExercise(name, activityType, targetValue, targetUnit, options = {}) {
  return {
    name,
    activityType,
    format: activityType === 'strength' ? 'sets' : 'continuous',
    sets: Number(options.sets) || 1,
    targetValue,
    targetUnit,
    load: options.load || '',
    loadUnit: options.loadUnit || 'kg',
    intensity: options.intensity || '',
    goal: options.goal || '',
    description: options.description || '',
    notes: options.notes || '',
    restSeconds: Number(options.restSeconds) || 0
  };
}

function demoDay(weekday, name, sessionType, exercises, options = {}) {
  return {
    weekday,
    enabled: Boolean(name),
    name: name || '',
    description: options.description || '',
    sessionType: sessionType || 'Rest / open day',
    warmup: options.warmup || '',
    cooldown: options.cooldown || '',
    exercises: exercises || []
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function jerryDemoPlan() {
  const weekSpecs = [
    {
      phase: 'Base build',
      progressionNotes: 'Keep two reps in reserve and leave the gym feeling ready to return.',
      successMetric: 'Complete three focused sessions without rushing the final set.',
      load: 42.5,
      runMinutes: 28
    },
    {
      phase: 'Base build',
      progressionNotes: 'Add one small amount of load where the final set stayed controlled.',
      successMetric: 'Complete the planned work and finish with steady energy.',
      load: 45,
      runMinutes: 30
    },
    {
      phase: 'Build',
      progressionNotes: 'Keep the same rhythm; progress only if technique stays consistent.',
      successMetric: 'Keep the Wednesday effort conversational and complete Friday strong.',
      load: 47.5,
      runMinutes: 32
    },
    {
      phase: 'Build',
      progressionNotes: 'Consolidate the work before the next training block.',
      successMetric: 'Finish the week feeling more capable, not depleted.',
      load: 50,
      runMinutes: 35
    }
  ];
  const weeks = weekSpecs.map((spec, index) => ({
    weekNumber: index + 1,
    phase: spec.phase,
    progressionNotes: spec.progressionNotes,
    successMetric: spec.successMetric,
    days: [
      demoDay(0, '', 'Rest / open day', []),
      demoDay(1, 'Full-body strength', 'Strength', [
        demoExercise('Goblet squat', 'strength', 8, 'reps', { sets: 3, load: spec.load, goal: 'Smooth, controlled reps', restSeconds: 90 }),
        demoExercise('Dumbbell row', 'strength', 10, 'reps', { sets: 3, load: 16, restSeconds: 75 }),
        demoExercise('Dead bug', 'strength', 8, 'reps / side', { sets: 2, restSeconds: 45 })
      ], { warmup: '5 min easy bike + hip mobility', cooldown: '2 min easy breathing' }),
      demoDay(2, '', 'Rest / open day', []),
      demoDay(3, 'Easy run', 'Cardio', [
        demoExercise('Easy run', 'cardio', spec.runMinutes, 'minutes', { intensity: 'Conversational', goal: 'Finish with steady breathing' })
      ], { warmup: '5 min walk', cooldown: '3 min walk' }),
      demoDay(4, '', 'Rest / open day', []),
      demoDay(5, 'Strength and carry', 'Strength', [
        demoExercise('Romanian deadlift', 'strength', 8, 'reps', { sets: 3, load: spec.load + 7.5, restSeconds: 100 }),
        demoExercise('Incline push-up', 'strength', 10, 'reps', { sets: 3, restSeconds: 60 }),
        demoExercise('Suitcase carry', 'strength', 30, 'seconds / side', { sets: 2, load: 18, restSeconds: 45 })
      ], { warmup: '5 min brisk walk + shoulder circles', cooldown: 'Calf and chest stretch' }),
      demoDay(6, 'Mobility reset', 'Guided', [
        demoExercise('Mobility flow', 'guided', 18, 'minutes', { intensity: 'Easy', goal: 'Leave feeling looser' })
      ], { warmup: 'Quiet space and a mat', cooldown: 'One minute of relaxed breathing' })
    ]
  }));
  const program = {
    name: 'Jerry · Consistent base',
    description: 'A four-week foundation block built around strength, easy running, and recovery.',
    version: 1,
    phase: weeks[0].phase,
    weekNumber: 1,
    durationWeeks: weeks.length,
    startDate: '2026-07-13',
    progressionNotes: weeks[0].progressionNotes,
    successMetric: weeks[0].successMetric,
    weeks
  };
  const assignments = [];
  const start = '2026-07-13';
  const end = addDaysISO(start, weeks.length * 7 - 1);
  for (let index = 0; index <= daysBetweenISO(start, end); index += 1) {
    const date = addDaysISO(start, index);
    const scheduled = workoutForProgramDate(program, date);
    if (!scheduled) continue;
    assignments.push({
      id: `v1-assignment-${date}`,
      date,
      recommendedDate: date,
      status: 'planned',
      moved: false,
      weekNumber: Number(scheduled.week.weekNumber) || 1,
      workout: cloneJson(scheduled.day)
    });
  }
  const completedDates = new Map([
    ['2026-07-13', { difficulty: 6, energy: 7, note: 'Good first session. Kept everything controlled.' }],
    ['2026-07-15', { difficulty: 5, energy: 8, note: 'Easy pace as planned; breathing stayed relaxed.' }],
    ['2026-07-17', { difficulty: 7, energy: 6, note: 'Last set was challenging but technique stayed solid.' }],
    ['2026-07-19', { sourceDate: '2026-07-18', difficulty: 4, energy: 7, note: 'Moved one day to make room for the weekend. Felt restorative.' }],
    ['2026-07-20', { difficulty: 7, energy: 7, note: 'Added a little load and still had room in reserve.' }],
    ['2026-07-22', { difficulty: 6, energy: 6, note: 'Steady run. The final five minutes felt smoother.' }],
    ['2026-07-24', { difficulty: 8, energy: 5, note: 'Busy week, but completed the key work. Took longer rests.' }],
    ['2026-07-26', { sourceDate: '2026-07-25', difficulty: 5, energy: 8, note: 'Short mobility reset after a long day. Helped a lot.' }],
    ['2026-07-27', { difficulty: 7, energy: 7, note: 'Good return after the weekend. Reps felt more confident.' }],
    ['2026-07-29', { difficulty: 6, energy: 7, note: 'Comfortable conversational pace from start to finish.' }]
  ]);
  const logs = [];
  for (const [date, details] of completedDates) {
    const assignment = assignments.find(item => item.recommendedDate === (details.sourceDate || date));
    if (!assignment) continue;
    assignment.date = date;
    assignment.status = 'completed';
    assignment.moved = assignment.recommendedDate !== date;
    const exercises = assignment.workout.exercises.map((activity, activityIndex) => ({
      ...cloneJson(activity),
      sets: Array.from({ length: Number(activity.sets) || 1 }, (_, setIndex) => ({
        planned: activity.targetValue,
        completed: activity.targetValue,
        intensity: activity.intensity || (activityIndex === 0 && setIndex === 0 ? 'Steady' : '')
      }))
    }));
    logs.push({
      id: `log-jerry-${date}`,
      assignmentId: assignment.id,
      workoutName: assignment.workout.name,
      date,
      exercises,
      difficulty: String(details.difficulty),
      energy: String(details.energy),
      note: details.note,
      createdAt: `${date}T18:30:00.000Z`
    });
  }
  assignments.sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: crypto.randomUUID(),
    shareToken: crypto.randomBytes(24).toString('base64url'),
    ownerKeyHash: adminOwnerHash(),
    name: program.name,
    personName: 'Jerry',
    goal: 'Build a consistent training rhythm',
    description: program.description,
    version: 1,
    program,
    assignments,
    logs,
    history: [],
    parentPlanId: null,
    demoKey: 'jerry',
    publishedAt: new Date().toISOString()
  };
}

// ── Published personal training plans ─────────────────────────────
app.post('/api/plans/publish', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const validationError = validatePlanPayload(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const plans = readPublishedPlans();
  const parentPlan = req.body.parentPlanId
    ? plans.find(item => item.id === req.body.parentPlanId && !item.deletedAt)
    : null;
  const submittedHistory = Array.isArray(req.body.history) ? req.body.history : [];
  const history = submittedHistory.filter(item => item?.planId !== parentPlan?.id);
  if (parentPlan) {
    history.unshift({
      planId: parentPlan.id,
      version: parentPlan.version,
      name: parentPlan.name,
      publishedAt: parentPlan.publishedAt,
      program: parentPlan.program,
      assignments: Array.isArray(parentPlan.assignments) ? parentPlan.assignments : [],
      logs: Array.isArray(parentPlan.logs) ? parentPlan.logs : []
    });
  }
  const plan = {
    id: crypto.randomUUID(),
    shareToken: crypto.randomBytes(24).toString('base64url'),
    ownerKeyHash: adminOwnerHash(),
    name: String(req.body.program.name || 'Training plan').slice(0, 100),
    personName: String(req.body.personName || 'Participant').slice(0, 100),
    goal: String(req.body.goal || '').slice(0, 160),
    description: String(req.body.program.description || '').slice(0, 300),
    version: Number(req.body.program.version) || 1,
    program: req.body.program,
    assignments: Array.isArray(req.body.assignments) ? req.body.assignments : [],
    logs: Array.isArray(req.body.logs) ? req.body.logs : [],
    history,
    parentPlanId: req.body.parentPlanId || null,
    publishedAt: new Date().toISOString()
  };
  plans.push(plan);
  writePublishedPlans(plans);
  res.status(201).json({
    ok: true,
    plan: {
      ...publicPlanSummary(plan),
      program: plan.program,
      personName: plan.personName,
      goal: plan.goal,
      assignments: plan.assignments,
      logs: plan.logs,
      history: plan.history
    }
  });
});

app.post('/api/plans/demo/jerry', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const plans = readPublishedPlans();
  const existing = plans.find(item =>
    !item.deletedAt &&
    item.demoKey === 'jerry'
  );
  if (existing) {
    return res.json({
      ok: true,
      created: false,
      plan: {
        ...publicPlanSummary(existing),
        program: existing.program,
        personName: existing.personName,
        goal: existing.goal,
        assignments: existing.assignments,
        logs: existing.logs,
        history: existing.history
      }
    });
  }
  const plan = jerryDemoPlan(adminOwnerHash());
  plans.push(plan);
  writePublishedPlans(plans);
  res.status(201).json({
    ok: true,
    created: true,
    plan: {
      ...publicPlanSummary(plan),
      program: plan.program,
      personName: plan.personName,
      goal: plan.goal,
      assignments: plan.assignments,
      logs: plan.logs,
      history: plan.history
    }
  });
});

app.get('/api/plans/owner', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const plans = readPublishedPlans()
    .filter(plan => !plan.deletedAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  res.json({ ok: true, plans: ownerPlanSummaries(plans) });
});

app.get('/api/plans/owner/:id', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const plan = readPublishedPlans().find(item => item.id === req.params.id && !item.deletedAt);
  if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found.' });
  res.json({
    ok: true,
    plan: {
      ...publicPlanSummary(plan),
      program: plan.program,
      personName: plan.personName,
      goal: plan.goal,
      assignments: plan.assignments,
      logs: plan.logs,
      history: plan.history
    }
  });
});

app.put('/api/plans/owner/:id', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const validationError = validatePlanPayload(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item =>
    item.id === req.params.id &&
    !item.deletedAt
  );
  if (planIndex === -1) return res.status(404).json({ ok: false, error: 'Plan not found.' });

  const plan = plans[planIndex];
  const program = { ...req.body.program, version: plan.version };
  const effectiveDate = parseISODate(req.body.effectiveDate)
    ? String(req.body.effectiveDate)
    : formatISODate(new Date());
  const assignments = assignmentsForUpdatedProgram(
    program,
    plan.assignments,
    `v${plan.version}-assignment`,
    effectiveDate
  );
  plans[planIndex] = {
    ...plan,
    name: String(program.name || plan.name).slice(0, 100),
    personName: String(req.body.personName || plan.personName || 'Participant').slice(0, 100),
    goal: String(req.body.goal || '').slice(0, 160),
    description: String(program.description || '').slice(0, 300),
    program,
    assignments,
    logs: Array.isArray(plan.logs) ? plan.logs : [],
    updatedAt: new Date().toISOString()
  };
  writePublishedPlans(plans);

  const updated = plans[planIndex];
  res.json({
    ok: true,
    plan: {
      ...publicPlanSummary(updated),
      program: updated.program,
      personName: updated.personName,
      goal: updated.goal,
      assignments: updated.assignments,
      logs: updated.logs,
      history: updated.history
    }
  });
});

app.delete('/api/plans/owner/:id', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });

  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item =>
    item.id === req.params.id &&
    !item.deletedAt
  );
  if (planIndex === -1) return res.status(404).json({ ok: false, error: 'Plan not found.' });

  const deletedPlan = plans[planIndex];
  const remainingPlans = plans
    .filter((_, index) => index !== planIndex)
    .map(plan => {
      return {
        ...plan,
        parentPlanId: plan.parentPlanId === deletedPlan.id ? null : plan.parentPlanId,
        history: Array.isArray(plan.history)
          ? plan.history.filter(item => item?.planId !== deletedPlan.id)
          : plan.history
      };
    });
  writePublishedPlans(remainingPlans);
  res.json({
    ok: true,
    id: req.params.id,
    logsDeleted: true,
    historyReferencesDeleted: true
  });
});

app.get('/api/plans/share/:token', (req, res) => {
  const plan = readPublishedPlans().find(item => item.shareToken === req.params.token);
  if (!plan) return res.status(404).json({ ok: false, error: 'Shared plan not found.' });
  res.json({
    ok: true,
    plan: {
      id: plan.id,
      name: plan.name,
      personName: plan.personName || 'Participant',
      goal: plan.goal,
      description: plan.description,
      version: plan.version,
      publishedAt: plan.publishedAt,
      program: plan.program,
      assignments: plan.assignments,
      logs: plan.logs,
      history: plan.history
    }
  });
});

app.put('/api/plans/share/:token/state', (req, res) => {
  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item => item.shareToken === req.params.token);
  if (planIndex === -1) return res.status(404).json({ ok: false, error: 'Shared plan not found.' });
  const { assignments, logs } = req.body || {};
  if (!Array.isArray(assignments) || !Array.isArray(logs) || JSON.stringify({ assignments, logs }).length > 250000) {
    return res.status(400).json({ ok: false, error: 'Invalid plan state.' });
  }
  plans[planIndex].assignments = assignments;
  plans[planIndex].logs = logs;
  writePublishedPlans(plans);
  res.json({ ok: true });
});

// ── Admin: verify password ───────────────────────────────────────
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  res.json({ ok: Boolean(ADMIN_PASSWORD) && sameSecret(password, ADMIN_PASSWORD) });
});

// ── Generate AI commentary ───────────────────────────────────────
app.post('/api/commentary', async (req, res) => {
  if (!SUPABASE_READY || !OPENAI_READY) {
    return res.status(503).json({ ok: false, error: 'Server not fully configured (missing secrets).' });
  }
  try {
    const { competitionId, password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(403).json({ ok: false, error: 'Unauthorized' });
    }

    const { data: competition, error: compErr } = await supabase
      .from('competitions')
      .select('*')
      .eq('id', competitionId)
      .single();

    if (compErr) return res.status(400).json({ ok: false, error: compErr.message });

    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('competition_id', competitionId);

    const { data: entries } = await supabase
      .from('entries')
      .select('*')
      .eq('competition_id', competitionId)
      .order('day_number');

    // Build stats per participant
    const stats = (participants || []).map(p => {
      const pEntries = (entries || []).filter(e => e.participant_id === p.id);
      const values = pEntries.map(e => Number(e.value));
      const best = values.length ? Math.max(...values) : 0;
      const latest = values.length ? values[values.length - 1] : 0;
      const first = values.length ? values[0] : 0;
      const trend = values.length >= 2
        ? (latest > first ? 'improving 📈' : latest < first ? 'declining 📉' : 'steady ➡️')
        : 'just getting started';

      const formatVal = v => {
        if (competition.unit === 'seconds') {
          const m = Math.floor(v / 60);
          const s = Math.round(v % 60);
          return m > 0 ? `${m}m ${s}s` : `${s}s`;
        }
        return `${v} ${competition.unit_label}`;
      };

      return {
        name: p.name,
        gender: p.gender,
        daysLogged: pEntries.length,
        best: formatVal(best),
        latest: formatVal(latest),
        trend
      };
    });

    const startDate = new Date(competition.start_date);
    const today = new Date();
    const daysPassed = Math.max(1, Math.floor((today - startDate) / 86400000) + 1);
    const weekNumber = Math.ceil(daysPassed / 7);

    const sorted = [...stats].sort((a, b) => {
      const aVal = (entries || [])
        .filter(e => e.participant_id === (participants || []).find(p => p.name === a.name)?.id)
        .reduce((mx, e) => Math.max(mx, Number(e.value)), 0);
      const bVal = (entries || [])
        .filter(e => e.participant_id === (participants || []).find(p => p.name === b.name)?.id)
        .reduce((mx, e) => Math.max(mx, Number(e.value)), 0);
      return competition.higher_is_better ? bVal - aVal : aVal - bVal;
    });

    const leader = sorted[0];

    const prompt = `You are an enthusiastic sports TV commentator covering the "${competition.name}" fitness challenge.
This is a ${competition.duration_days}-day ${competition.activity_type} challenge (measuring in ${competition.unit_label}).
We are on day ${daysPassed} — this is the Week ${weekNumber} recap.

Participant standings (sorted by best performance):
${sorted.map((s, i) => `${i + 1}. ${s.name} — best: ${s.best}, latest: ${s.latest}, days logged: ${s.daysLogged}, trend: ${s.trend}`).join('\n')}

Write an exciting, entertaining Week ${weekNumber} sports commentary (2–3 short paragraphs).
- Use a broadcast TV commentator voice — energetic, vivid, fun
- Mention participants by first name
- Highlight the leader, any underdogs, interesting trends
- End with a motivating call to action for the week ahead
- English only. No markdown headers.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 450
    });

    const content = completion.choices[0].message.content;

    const { data: commentary, error: insertErr } = await supabase
      .from('ai_commentary')
      .insert({
        competition_id: competitionId,
        week_number: weekNumber,
        title: `Week ${weekNumber} — Day ${daysPassed} Recap`,
        content
      })
      .select()
      .single();

    if (insertErr) return res.status(400).json({ ok: false, error: insertErr.message });

    res.json({ ok: true, commentary });
  } catch (err) {
    console.error('Commentary error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── SPA fallback: challenge/* → challenge/index.html ─────────────
app.get('/challenge', (req, res) => {
  res.sendFile(path.join(__dirname, 'challenge', 'index.html'));
});

app.get(['/dashboard/share/:token', '/dashboard/share/:token/'], (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(308, `/p/${encodeURIComponent(req.params.token)}${query ? `?${query}` : ''}`);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('HälsoPulsen running on port 5000');
});
