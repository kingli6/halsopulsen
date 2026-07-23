/* ================================================================
   HälsoPulsen Challenge — admin.js
================================================================ */

const { createClient } = supabase;
const db = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let adminPassword = '';
let allCompetitions = [];
let allParticipants = [];

// ── Auth ──────────────────────────────────────────────────────────
const ADMIN_HASH = '54cb9702a7cec251a5b3d5d300af10b62e2a28ffeb53072d3aa768d98561e408';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password) {
  // Fallback: client-side hash check (always works, GitHub Pages + Replit)
  const hash = await sha256(password);
  if (hash === ADMIN_HASH) return true;
  // Also try server endpoint (only available on Replit/deployed backend)
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      const json = await res.json();
      return json.ok === true;
    }
  } catch {}
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────
function generateToken(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${slug}-${rand}`;
}

function getParticipantLink(token) {
  const base = window.location.origin;
  return `${base}/challenge/?p=${token}`;
}

function showAlert(elId, msg, type = 'success') {
  const el = document.getElementById(elId);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Load data ─────────────────────────────────────────────────────
async function loadAll() {
  const [comps, parts] = await Promise.all([
    db.from('competitions').select('*').order('created_at', { ascending: false }),
    db.from('participants').select('*').order('created_at')
  ]);
  allCompetitions = comps.data || [];
  allParticipants = parts.data || [];
}

// ── Competitions tab ──────────────────────────────────────────────
async function renderCompetitions() {
  const list = document.getElementById('competitionsList');
  if (!allCompetitions.length) {
    list.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">No competitions yet. Create one above!</p>';
    return;
  }
  list.innerHTML = allCompetitions.map(c => {
    const partCount = allParticipants.filter(p => p.competition_id === c.id).length;
    return `
    <div class="competition-list-item">
      <div style="flex:1;">
        <div style="font-weight:700;">${c.name}</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.2rem;">
          ${c.activity_type} · ${c.duration_days} days · starts ${formatDate(c.start_date)} · ${partCount} participants
        </div>
      </div>
      ${c.is_active ? '<span class="comp-active-badge">ACTIVE</span>' : ''}
      ${!c.is_active
        ? `<button class="btn btn-sm btn-outline" onclick="setActive('${c.id}')">Set active</button>`
        : `<button class="btn btn-sm btn-outline" onclick="setActive(null)">Deactivate</button>`
      }
    </div>`;
  }).join('');
}

async function createCompetition() {
  const name     = document.getElementById('compName').value.trim();
  const activity = document.getElementById('compActivity').value.trim();
  const unitVal  = document.getElementById('compUnit').value;
  const duration = parseInt(document.getElementById('compDuration').value);
  const startDate = document.getElementById('compStartDate').value;
  const higher   = document.getElementById('compHigher').value === 'true';
  const desc     = document.getElementById('compDesc').value.trim();

  if (!name || !activity || !startDate) {
    showAlert('compAlert', 'Please fill in name, activity type, and start date.', 'error');
    return;
  }

  const unitLabels = { seconds: 'seconds', reps: 'reps', km: 'km', meters: 'metres', minutes: 'min' };

  const btn = document.getElementById('createCompBtn');
  btn.disabled = true; btn.textContent = 'Creating...';

  const { data, error } = await db.from('competitions').insert({
    name, activity_type: activity, unit: unitVal,
    unit_label: unitLabels[unitVal] || unitVal,
    higher_is_better: higher, duration_days: duration,
    start_date: startDate, description: desc || null,
    is_active: false
  }).select().single();

  btn.disabled = false; btn.textContent = 'Create competition';

  if (error) { showAlert('compAlert', error.message, 'error'); return; }

  allCompetitions.unshift(data);
  showAlert('compAlert', `"${name}" created! Set it as active when ready.`, 'success');
  renderCompetitions();
  populateCompetitionSelects();
  document.getElementById('compName').value = '';
}

async function setActive(id) {
  // Deactivate all first
  await db.from('competitions').update({ is_active: false }).neq('id', 'none');
  if (id) await db.from('competitions').update({ is_active: true }).eq('id', id);
  await loadAll();
  renderCompetitions();
}

// ── Participants tab ──────────────────────────────────────────────
function populateCompetitionSelects() {
  const selects = ['partCompetition', 'partFilterComp', 'commCompetition', 'chatFilterComp'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = allCompetitions.length
      ? allCompetitions.map(c =>
          `<option value="${c.id}" ${c.is_active ? '(Active) ' : ''}>${c.name}${c.is_active ? ' ✓' : ''}</option>`
        ).join('')
      : '<option value="">No competitions yet</option>';
    if (prev) el.value = prev;
  });
}

async function renderParticipants() {
  const list = document.getElementById('participantList');
  const compId = document.getElementById('partFilterComp').value;
  const filtered = compId ? allParticipants.filter(p => p.competition_id === compId) : allParticipants;

  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">No participants yet.</p>';
    return;
  }

  list.innerHTML = filtered.map(p => {
    const link = getParticipantLink(p.token);
    const genderIcon = p.gender === 'male' ? '♂' : p.gender === 'female' ? '♀' : '—';
    return `
    <div class="participant-list-item">
      <div class="participant-list-name">${p.name} <span style="font-size:0.8rem;color:var(--color-text-muted)">${genderIcon}</span></div>
      <div class="participant-list-link" onclick="copyLink('${link}', this)" title="Click to copy">${link}</div>
      <span class="copy-feedback" id="fb-${p.id}">Copied!</span>
      <button class="btn btn-sm btn-danger" onclick="deleteParticipant('${p.id}', '${p.name}')">×</button>
    </div>`;
  }).join('');
}

async function addParticipant() {
  const compId = document.getElementById('partCompetition').value;
  const name   = document.getElementById('partName').value.trim();
  const gender = document.getElementById('partGender').value;

  if (!compId) { showAlert('partAlert', 'Select a competition first.', 'error'); return; }
  if (!name)   { showAlert('partAlert', 'Enter a participant name.', 'error'); return; }

  const token = generateToken(name);
  const btn = document.getElementById('addPartBtn');
  btn.disabled = true; btn.textContent = 'Generating...';

  const { data, error } = await db.from('participants').insert({
    competition_id: compId, name, gender, token
  }).select().single();

  btn.disabled = false; btn.textContent = 'Generate link';

  if (error) { showAlert('partAlert', error.message, 'error'); return; }

  allParticipants.push(data);
  document.getElementById('partName').value = '';

  const link = getParticipantLink(token);
  showAlert('partAlert', `✅ Link for ${name} created! Share: ${link}`, 'success');
  renderParticipants();
}

async function deleteParticipant(id, name) {
  if (!confirm(`Remove "${name}" from the competition? This will also delete all their entries.`)) return;
  await db.from('participants').delete().eq('id', id);
  allParticipants = allParticipants.filter(p => p.id !== id);
  renderParticipants();
}

function copyLink(link, el) {
  navigator.clipboard.writeText(link).then(() => {
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = link; }, 2000);
  });
}

// ── Commentary tab ────────────────────────────────────────────────
async function generateCommentary() {
  const compId = document.getElementById('commCompetition').value;
  if (!compId) { showAlert('commAlert', 'Select a competition.', 'error'); return; }

  const btn = document.getElementById('generateCommBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  try {
    const res = await fetch('/api/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitionId: compId, password: adminPassword })
    });
    const json = await res.json();

    if (!json.ok) throw new Error(json.error || 'Unknown error');

    showAlert('commAlert', '🎙️ Commentary generated and published!', 'success');
    loadCommentaryHistory();
  } catch (err) {
    showAlert('commAlert', 'Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate this week\'s commentary ✨';
  }
}

async function loadCommentaryHistory() {
  const compId = document.getElementById('commCompetition').value;
  const container = document.getElementById('commentaryHistory');
  if (!compId) { container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">Select a competition.</p>'; return; }

  const { data } = await db.from('ai_commentary').select('*')
    .eq('competition_id', compId).order('created_at', { ascending: false });

  if (!data?.length) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">No commentary generated yet.</p>';
    return;
  }
  container.innerHTML = data.map(c => `
    <div class="commentary-history-item">
      <div class="commentary-history-title">
        <span>${c.title || `Week ${c.week_number}`}</span>
        <span style="font-size:0.75rem;color:var(--color-text-muted);">${new Date(c.created_at).toLocaleString('en-GB')}</span>
      </div>
      <div class="commentary-history-text">${c.content.slice(0, 220)}${c.content.length > 220 ? '…' : ''}</div>
    </div>`).join('');
}

// ── Chat tab ──────────────────────────────────────────────────────
async function loadAdminChat() {
  const compId = document.getElementById('chatFilterComp').value;
  const container = document.getElementById('adminChatList');
  if (!compId) { container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">Select a competition.</p>'; return; }

  const { data } = await db.from('messages').select('*')
    .eq('competition_id', compId).order('created_at', { ascending: false });

  if (!data?.length) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;">No messages yet.</p>';
    return;
  }

  container.innerHTML = data.map(m => `
    <div style="display:flex;gap:1rem;align-items:flex-start;padding:0.75rem;background:var(--color-bg);border-radius:6px;border:1px solid var(--color-border);margin-bottom:0.5rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div style="font-weight:700;font-size:0.875rem;">${m.author_name}
          ${m.is_pinned ? '<span style="background:#FEF9C3;color:#B45309;font-size:0.65rem;padding:0.1rem 0.4rem;border-radius:9999px;margin-left:0.3rem;font-weight:700;">📌 PINNED</span>' : ''}
        </div>
        <div style="font-size:0.8rem;color:var(--color-text-muted);">${new Date(m.created_at).toLocaleString('en-GB')}</div>
        <div style="font-size:0.875rem;margin-top:0.25rem;">${m.content}</div>
      </div>
      <div style="display:flex;gap:0.4rem;flex-shrink:0;">
        <button class="btn btn-sm btn-outline" onclick="togglePin('${m.id}', ${m.is_pinned})">
          ${m.is_pinned ? '📌 Unpin' : '📌 Pin'}
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteMessage('${m.id}')">Delete</button>
      </div>
    </div>`).join('');
}

async function togglePin(id, currentlyPinned) {
  await db.from('messages').update({ is_pinned: !currentlyPinned }).eq('id', id);
  loadAdminChat();
}
async function deleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  await db.from('messages').delete().eq('id', id);
  loadAdminChat();
}

// ── Tabs ──────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.admin-tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`panel-${tabName}`).classList.add('active');

  if (tabName === 'commentary') loadCommentaryHistory();
  if (tabName === 'chat') loadAdminChat();
}

// ── Init ──────────────────────────────────────────────────────────
async function initAdmin() {
  // Set default start date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('compStartDate').value = today;

  await loadAll();
  populateCompetitionSelects();
  renderCompetitions();
  renderParticipants();
}

// ── Events ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Login
  const doLogin = async () => {
    const pw = document.getElementById('adminPassword').value;
    const ok = await verifyPassword(pw);
    if (!ok) {
      document.getElementById('loginError').style.display = '';
      return;
    }
    adminPassword = pw;
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminContent').classList.add('visible');
    initAdmin();
  };

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Create competition
  document.getElementById('createCompBtn').addEventListener('click', createCompetition);

  // Add participant
  document.getElementById('addPartBtn').addEventListener('click', addParticipant);

  // Filter participants
  document.getElementById('partFilterComp').addEventListener('change', renderParticipants);

  // Generate commentary
  document.getElementById('generateCommBtn').addEventListener('click', generateCommentary);
  document.getElementById('commCompetition').addEventListener('change', loadCommentaryHistory);

  // Filter chat
  document.getElementById('chatFilterComp').addEventListener('change', loadAdminChat);
});
