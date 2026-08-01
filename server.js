const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const ws = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const SUPABASE_READY = !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
const supabase = SUPABASE_READY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { realtime: { transport: ws } })
  : null;

const OPENAI_READY = !!process.env.OPENAI_API_KEY;
const openai = OPENAI_READY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'halsopulsen2026';
const PLAN_STORAGE_DIR = path.join(__dirname, 'storage');
const PLAN_STORAGE_PATH = path.join(PLAN_STORAGE_DIR, 'published-plans.json');

if (!SUPABASE_READY) console.warn('⚠  SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — challenge features disabled.');
if (!OPENAI_READY)  console.warn('⚠  OPENAI_API_KEY not set — AI commentary disabled.');

function hashOwnerKey(ownerKey) {
  return crypto.createHash('sha256').update(String(ownerKey || '')).digest('hex');
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
    sharePath: plan.shareToken ? `/dashboard/share/${plan.shareToken}/` : '',
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
  if (!body || typeof body.ownerKey !== 'string' || body.ownerKey.length < 16) {
    return 'A valid owner key is required.';
  }
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

// ── Published personal training plans ─────────────────────────────
// This is deliberately small prototype storage. The owner key is a
// browser-held bearer key until proper authentication is added.
app.post('/api/plans/publish', (req, res) => {
  const validationError = validatePlanPayload(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const plans = readPublishedPlans();
  const parentPlan = req.body.parentPlanId
    ? plans.find(item => item.id === req.body.parentPlanId && !item.deletedAt && item.ownerKeyHash === hashOwnerKey(req.body.ownerKey))
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
    ownerKeyHash: hashOwnerKey(req.body.ownerKey),
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

app.get('/api/plans/owner', (req, res) => {
  const ownerKey = String(req.get('x-owner-key') || req.query.ownerKey || '');
  if (ownerKey.length < 16) return res.status(400).json({ ok: false, error: 'A valid owner key is required.' });
  const ownerKeyHash = hashOwnerKey(ownerKey);
  const plans = readPublishedPlans()
    .filter(plan => !plan.deletedAt && plan.ownerKeyHash === ownerKeyHash)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  res.json({ ok: true, plans: ownerPlanSummaries(plans) });
});

app.get('/api/plans/owner/:id', (req, res) => {
  const ownerKey = String(req.get('x-owner-key') || req.query.ownerKey || '');
  const plan = readPublishedPlans().find(item => item.id === req.params.id && !item.deletedAt && item.ownerKeyHash === hashOwnerKey(ownerKey));
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
  const ownerKey = String(req.get('x-owner-key') || '');
  const validationError = validatePlanPayload({ ...req.body, ownerKey });
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item =>
    item.id === req.params.id &&
    !item.deletedAt &&
    item.ownerKeyHash === hashOwnerKey(ownerKey)
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
  const ownerKey = String(req.get('x-owner-key') || '');
  if (ownerKey.length < 16) return res.status(400).json({ ok: false, error: 'A valid owner key is required.' });

  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item =>
    item.id === req.params.id &&
    !item.deletedAt &&
    item.ownerKeyHash === hashOwnerKey(ownerKey)
  );
  if (planIndex === -1) return res.status(404).json({ ok: false, error: 'Plan not found.' });

  const deletedPlan = plans[planIndex];
  const remainingPlans = plans
    .filter((_, index) => index !== planIndex)
    .map(plan => {
      if (plan.ownerKeyHash !== deletedPlan.ownerKeyHash) return plan;
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
  res.json({ ok: password === ADMIN_PASSWORD });
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
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.listen(5000, '0.0.0.0', () => {
  console.log('HälsoPulsen running on port 5000');
});
