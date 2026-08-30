const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { clerkMiddleware, getAuth } = require('@clerk/express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { bookingRouter } = require('./booking/routes');
const { bookingAdminRouter } = require('./booking/admin-routes');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const CLERK_PROXY_PATH = '/api/__clerk';
if (process.env.NODE_ENV === 'production' && process.env.CLERK_SECRET_KEY) {
  app.use(CLERK_PROXY_PATH, createProxyMiddleware({
    target: 'https://frontend-api.clerk.dev',
    changeOrigin: true,
    pathRewrite: { [`^${CLERK_PROXY_PATH}`]: '' },
    onProxyReq(proxyReq, req) {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      proxyReq.setHeader('Clerk-Proxy-Url', `${protocol}://${host}${CLERK_PROXY_PATH}`);
      proxyReq.setHeader('Clerk-Secret-Key', process.env.CLERK_SECRET_KEY);
    }
  }));
}
app.use(clerkMiddleware());
app.use(express.json({ limit: '512kb', strict: true }));

const MAX_PROGRAM_WEEKS = 52;
const MAX_DAY_ACTIVITIES = 30;
const MAX_ASSIGNMENTS = 1000;
const MAX_LOGS = 1500;
const MAX_HISTORY = 100;
const MAX_TEMPLATES = 500;
const MAX_STATE_REQUEST_IDS = 50;

function requestAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function createRateLimiter({ name, windowMs, max }) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60 * 1000));
  cleanup.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${requestAddress(req)}`;
    const previous = buckets.get(key);
    const bucket = previous && previous.resetAt > now
      ? previous
      : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'Too many requests. Please wait a moment and try again.'
      });
    }
    next();
  };
}

const apiRateLimiter = createRateLimiter({
  name: 'api',
  windowMs: 60 * 1000,
  max: 180
});
const mutationRateLimiter = createRateLimiter({
  name: 'mutation',
  windowMs: 60 * 1000,
  max: 90
});
const loginRateLimiter = createRateLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 12
});

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

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  apiRateLimiter(req, res, next);
});
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  mutationRateLimiter(req, res, next);
});
app.use('/api/booking', bookingRouter);
app.use('/api/booking/admin', (req, res, next) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  next();
}, bookingAdminRouter);

app.get('/api/auth/config', (req, res) => {
  res.json({ ok: true, publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '' });
});

app.get('/api/auth/me', (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.json({ ok: true, authenticated: false });
  const { user } = getOrCreateUser(userId);
  res.json({ ok: true, authenticated: true, user: { id: user.id } });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ ok: true, authenticated: Boolean(readAdminSession(req)) });
});

app.post('/api/admin/login', loginRateLimiter, (req, res) => {
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
app.get(['/account', '/account/'], (req, res) => res.sendFile(path.join(__dirname, 'account.html')));
app.get(['/booking', '/booking/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'booking', 'index.html'));
});
app.get(['/plans', '/plans/'], (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'plan', 'index.html')));
app.get(['/admin/plans', '/admin/plans/'], (req, res) => {
  if (!readAdminSession(req)) return res.redirect(`/admin?next=${encodeURIComponent(adminRedirectPath(req))}`);
  res.sendFile(path.join(__dirname, 'dashboard', 'plan', 'index.html'));
});
function serveBookingAdminPage(req, res) {
  if (!readAdminSession(req)) {
    return res.redirect(`/admin?next=${encodeURIComponent('/admin/booking/')}`);
  }
  return res.sendFile(path.join(__dirname, 'dashboard', 'admin', 'booking.html'));
}
app.get(['/admin/booking', '/admin/booking/'], serveBookingAdminPage);
app.get('/dashboard/admin/booking.html', serveBookingAdminPage);
app.get(['/p/:token', '/p/:token/'], (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'index.html')));
// Keep legacy challenge URLs redirected after retiring the old implementation.
app.get(['/challenge', '/challenge/'], (req, res) => res.redirect('/'));
app.get('/challenge/*', (req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname)));

const PLAN_STORAGE_DIR = path.join(__dirname, 'storage');
const PLAN_STORAGE_PATH = path.join(PLAN_STORAGE_DIR, 'published-plans.json');
const TEMPLATE_STORAGE_PATH = path.join(PLAN_STORAGE_DIR, 'template-library.json');
const USER_STORAGE_PATH = path.join(PLAN_STORAGE_DIR, 'users.json');
const MAX_USER_PRESETS = 100;
const MAX_USER_PLANS = 100;

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

function readTemplates() {
  try {
    if (!fs.existsSync(TEMPLATE_STORAGE_PATH)) return [];
    const value = JSON.parse(fs.readFileSync(TEMPLATE_STORAGE_PATH, 'utf8'));
    return Array.isArray(value) ? value.filter(template => !template.deletedAt) : [];
  } catch (error) {
    console.error('Could not read template library:', error.message);
    return [];
  }
}

function writeTemplates(templates) {
  fs.mkdirSync(PLAN_STORAGE_DIR, { recursive: true });
  const temporaryPath = `${TEMPLATE_STORAGE_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(templates, null, 2));
  fs.renameSync(temporaryPath, TEMPLATE_STORAGE_PATH);
}

function readUsers() {
  try {
    if (!fs.existsSync(USER_STORAGE_PATH)) return [];
    const value = JSON.parse(fs.readFileSync(USER_STORAGE_PATH, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error('Could not read users:', error.message);
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(PLAN_STORAGE_DIR, { recursive: true });
  const temporaryPath = `${USER_STORAGE_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(users, null, 2));
  fs.renameSync(temporaryPath, USER_STORAGE_PATH);
}

function currentUserId(req) {
  const auth = getAuth(req);
  return auth?.userId || auth?.sessionClaims?.userId || null;
}

function requireUser(req, res, next) {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Sign in required.' });
  req.userId = userId;
  next();
}

function getOrCreateUser(userId) {
  const users = readUsers();
  let user = users.find(item => item.id === userId);
  if (!user) {
    user = { id: userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), presets: [], plans: [] };
    users.push(user);
    writeUsers(users);
  }
  return { users, user };
}

function safePreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    rounds: preset.rounds,
    blocks: preset.blocks
  };
}

function validateUserPreset(body) {
  const name = String(body?.name || '').trim();
  const rounds = Number(body?.rounds);
  const blocks = body?.blocks;
  if (!name || name.length > 100) return 'Preset name must be between 1 and 100 characters.';
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) return 'Rounds must be between 1 and 100.';
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 100) return 'A preset needs between 1 and 100 blocks.';
  if (blocks.some(block => !block || !['work', 'rest'].includes(block.type)
    || !String(block.label || '').trim() || String(block.label).length > 80
    || !Number.isInteger(Number(block.duration)) || Number(block.duration) < 1 || Number(block.duration) > 3600)) {
    return 'Each block needs a valid label, type, and duration.';
  }
  return null;
}

function publicUserPlan(plan) {
  return { id: plan.id, name: plan.name, data: plan.data, createdAt: plan.createdAt, updatedAt: plan.updatedAt };
}

function validateUserPlan(body) {
  const validationError = validatePlanPayload(body);
  if (validationError) return validationError;
  if (String(body?.name || body?.program?.name || '').trim().length > 100) return 'Plan names must be 100 characters or fewer.';
  return null;
}

app.get('/api/user/presets', requireUser, (req, res) => {
  const { user } = getOrCreateUser(req.userId);
  res.json({ ok: true, presets: user.presets.map(safePreset) });
});

app.post('/api/user/presets', requireUser, (req, res) => {
  const validationError = validateUserPreset(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  const { users, user } = getOrCreateUser(req.userId);
  if (user.presets.length >= MAX_USER_PRESETS) {
    return res.status(429).json({ ok: false, error: 'You have reached the saved preset limit.' });
  }
  const preset = {
    id: crypto.randomUUID(),
    name: String(req.body.name).trim(),
    rounds: Number(req.body.rounds),
    blocks: req.body.blocks.map((block, index) => ({
      id: index + 1,
      type: block.type,
      label: String(block.label).trim(),
      duration: Number(block.duration)
    })),
    createdAt: new Date().toISOString()
  };
  user.presets.push(preset);
  user.updatedAt = new Date().toISOString();
  writeUsers(users);
  res.status(201).json({ ok: true, preset: safePreset(preset) });
});

app.delete('/api/user/presets/:id', requireUser, (req, res) => {
  const { users, user } = getOrCreateUser(req.userId);
  const before = user.presets.length;
  user.presets = user.presets.filter(preset => preset.id !== req.params.id);
  if (before === user.presets.length) return res.status(404).json({ ok: false, error: 'Preset not found.' });
  user.updatedAt = new Date().toISOString();
  writeUsers(users);
  res.json({ ok: true, id: req.params.id });
});

app.get('/api/user/plans', requireUser, (req, res) => {
  const { user } = getOrCreateUser(req.userId);
  res.json({ ok: true, plans: user.plans.map(publicUserPlan) });
});

app.post('/api/user/plans', requireUser, (req, res) => {
  const validationError = validateUserPlan(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  const { users, user } = getOrCreateUser(req.userId);
  if (user.plans.length >= MAX_USER_PLANS) {
    return res.status(429).json({ ok: false, error: 'You have reached the saved plan limit.' });
  }
  const now = new Date().toISOString();
  const plan = {
    id: crypto.randomUUID(),
    name: String(req.body.name || req.body.program.name || 'Training plan').trim().slice(0, 100),
    data: cloneJson(req.body),
    createdAt: now,
    updatedAt: now
  };
  user.plans.unshift(plan);
  user.updatedAt = now;
  writeUsers(users);
  res.status(201).json({ ok: true, plan: publicUserPlan(plan) });
});

app.put('/api/user/plans/:id', requireUser, (req, res) => {
  const validationError = validateUserPlan(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  const { users, user } = getOrCreateUser(req.userId);
  const plan = user.plans.find(item => item.id === req.params.id);
  if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found.' });
  plan.name = String(req.body.name || req.body.program.name || plan.name).trim().slice(0, 100);
  plan.data = cloneJson(req.body);
  plan.updatedAt = new Date().toISOString();
  user.updatedAt = plan.updatedAt;
  writeUsers(users);
  res.json({ ok: true, plan: publicUserPlan(plan) });
});

app.delete('/api/user/plans/:id', requireUser, (req, res) => {
  const { users, user } = getOrCreateUser(req.userId);
  const before = user.plans.length;
  user.plans = user.plans.filter(plan => plan.id !== req.params.id);
  if (before === user.plans.length) return res.status(404).json({ ok: false, error: 'Plan not found.' });
  user.updatedAt = new Date().toISOString();
  writeUsers(users);
  res.json({ ok: true, id: req.params.id });
});

function publicTemplate(template) {
  return {
    id: template.id,
    type: template.type,
    name: template.name,
    data: template.data,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt || template.createdAt
  };
}

function validateTemplatePayload(body) {
  const type = String(body?.type || '');
  const allowedTypes = new Set(['activity', 'workout', 'week']);
  if (!allowedTypes.has(type)) return 'Choose an activity, day workout, or week template.';
  if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return 'A template snapshot is required.';
  }
  if (String(body.name || body.data.name || '').trim().length > 100) {
    return 'Template names must be 100 characters or fewer.';
  }
  if (JSON.stringify(body.data).length > 120000) return 'That template is too large.';
  if (type === 'activity' && !String(body.data.name || '').trim()) return 'An activity needs a name.';
  if (type === 'workout' && (!String(body.data.name || '').trim() || !Array.isArray(body.data.exercises) || !body.data.exercises.length)) {
    return 'A workout needs a name and at least one activity.';
  }
  if (type === 'workout' && body.data.exercises.length > MAX_DAY_ACTIVITIES) {
    return `A workout cannot contain more than ${MAX_DAY_ACTIVITIES} activities.`;
  }
  if (type === 'week' && (!Array.isArray(body.data.days) || body.data.days.length !== 7)) {
    return 'A week template must contain seven days.';
  }
  if (type === 'week' && body.data.days.some(day => Array.isArray(day?.exercises) && day.exercises.length > MAX_DAY_ACTIVITIES)) {
    return `A day cannot contain more than ${MAX_DAY_ACTIVITIES} activities.`;
  }
  return null;
}

app.get('/api/templates', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const templates = readTemplates()
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  res.json({ ok: true, templates: templates.map(publicTemplate) });
});

app.post('/api/templates', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const validationError = validateTemplatePayload(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const now = new Date().toISOString();
  const template = {
    id: crypto.randomUUID(),
    type: String(req.body.type),
    name: String(req.body.name || req.body.data.name || 'Untitled template').trim().slice(0, 100),
    data: cloneJson(req.body.data),
    createdAt: now,
    updatedAt: now
  };
  const templates = readTemplates();
  if (templates.length >= MAX_TEMPLATES) {
    return res.status(429).json({ ok: false, error: 'The reusable library has reached its limit. Delete an old template before adding another.' });
  }
  templates.push(template);
  writeTemplates(templates);
  res.status(201).json({ ok: true, template: publicTemplate(template) });
});

app.delete('/api/templates/:id', (req, res) => {
  if (!readAdminSession(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  const templates = readTemplates();
  const template = templates.find(item => item.id === req.params.id);
  if (!template) return res.status(404).json({ ok: false, error: 'Template not found.' });
  writeTemplates(templates.filter(item => item.id !== req.params.id));
  res.json({ ok: true, id: req.params.id });
});

function publicPlanSummary(plan) {
  const program = plan.program || {};
  const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
  const logs = Array.isArray(plan.logs) ? plan.logs : [];
  const stateRevision = Number.isInteger(plan.stateRevision) && plan.stateRevision >= 0
    ? plan.stateRevision
    : 0;
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
    stateRevision,
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'A plan payload is required.';
  const program = body.program;
  const hasWeeks = Array.isArray(program?.weeks) && program.weeks.length > 0;
  const hasLegacyDays = Array.isArray(program?.days) && program.days.length === 7;
  if (!hasWeeks && !hasLegacyDays) {
    return 'A complete program with at least one seven-day week is required.';
  }
  const weeks = hasWeeks ? program.weeks : [program];
  if (weeks.length > MAX_PROGRAM_WEEKS) {
    return `A program cannot contain more than ${MAX_PROGRAM_WEEKS} weeks.`;
  }
  if (hasWeeks && program.weeks.some(week => !Array.isArray(week?.days) || week.days.length !== 7)) {
    return 'Every program week must contain seven days.';
  }
  if (weeks.some(week => {
    const days = Array.isArray(week?.days) ? week.days : [];
    return days.some(day => Array.isArray(day?.exercises) && day.exercises.length > MAX_DAY_ACTIVITIES);
  })) {
    return `A day cannot contain more than ${MAX_DAY_ACTIVITIES} activities.`;
  }
  if (JSON.stringify(program).length > 150000) {
    return 'The program is too large.';
  }
  if (Array.isArray(body.assignments) && body.assignments.length > MAX_ASSIGNMENTS) {
    return 'The plan contains too many assignments.';
  }
  if (Array.isArray(body.logs) && body.logs.length > MAX_LOGS) {
    return 'The plan contains too many log entries.';
  }
  if (Array.isArray(body.history) && body.history.length > MAX_HISTORY) {
    return 'The plan contains too many historical versions.';
  }
  return null;
}

function validateSharedStatePayload(body) {
  const assignments = body?.assignments;
  const logs = body?.logs;
  if (!Array.isArray(assignments) || !Array.isArray(logs)) return 'Invalid plan state.';
  if (!Number.isInteger(body?.stateRevision) || body.stateRevision < 0) {
    return 'A valid shared plan revision is required.';
  }
  const requestId = String(body?.requestId || '').trim();
  if (!requestId || requestId.length > 120) {
    return 'A valid shared save request ID is required.';
  }
  if (assignments.length > MAX_ASSIGNMENTS || logs.length > MAX_LOGS) {
    return 'The shared plan contains too many records.';
  }
  if (JSON.stringify({ assignments, logs }).length > 250000) {
    return 'The shared plan state is too large.';
  }
  return null;
}

function parseISODate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;
  return date;
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
    stateRevision: 0,
    stateRequestIds: [],
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
    stateRevision: 0,
    stateRequestIds: [],
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
  const plan = jerryDemoPlan();
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
      history: plan.history,
      stateRevision: Number.isInteger(plan.stateRevision) && plan.stateRevision >= 0 ? plan.stateRevision : 0
    }
  });
});

app.put('/api/plans/share/:token/state', (req, res) => {
  // The JSON file is a single-process prototype store. Its synchronous read/modify/write
  // is not safe across multiple Node instances; use a transactional store before scaling out.
  const plans = readPublishedPlans();
  const planIndex = plans.findIndex(item => item.shareToken === req.params.token);
  if (planIndex === -1) return res.status(404).json({ ok: false, error: 'Shared plan not found.' });
  const validationError = validateSharedStatePayload(req.body);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  const plan = plans[planIndex];
  const currentRevision = Number.isInteger(plan.stateRevision) && plan.stateRevision >= 0
    ? plan.stateRevision
    : 0;
  const requestId = String(req.body.requestId).trim();
  const stateRequestIds = Array.isArray(plan.stateRequestIds)
    ? plan.stateRequestIds.filter(item => typeof item === 'string')
    : [];

  if (stateRequestIds.includes(requestId)) {
    return res.json({
      ok: true,
      duplicate: true,
      stateRevision: currentRevision
    });
  }

  if (req.body.stateRevision !== currentRevision) {
    return res.status(409).json({
      ok: false,
      conflict: true,
      stateRevision: currentRevision,
      error: 'This training log changed elsewhere. Reload the latest log before saving.'
    });
  }

  const { assignments, logs } = req.body;
  const nextRevision = currentRevision + 1;
  plan.assignments = assignments;
  plan.logs = logs;
  plan.stateRevision = nextRevision;
  plan.stateRequestIds = [...stateRequestIds, requestId].slice(-MAX_STATE_REQUEST_IDS);
  plan.updatedAt = new Date().toISOString();
  writePublishedPlans(plans);
  res.json({ ok: true, duplicate: false, stateRevision: nextRevision });
});

app.get(['/dashboard/share/:token', '/dashboard/share/:token/'], (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(308, `/p/${encodeURIComponent(req.params.token)}${query ? `?${query}` : ''}`);
});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'That request is too large.' });
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({ ok: false, error: 'The request body is not valid JSON.' });
  }
  if (req.path.startsWith('/api')) {
    console.error('API request failed:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'The server could not complete that request.' });
  }
  next(error);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('HälsoPulsen running on port 5000');
});
