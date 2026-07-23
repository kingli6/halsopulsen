/* ================================================================
   HälsoPulsen Challenge — app.js
================================================================ */

const { createClient } = supabase;
const db = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ── State ─────────────────────────────────────────────────────────
const state = {
  competition: null,
  participants: [],
  entries: [],
  messages: [],
  commentary: null,
  myParticipant: null,
  myToken: null,
  currentDayNumber: 1,
  genderFilter: 'all',
  todayEntry: null
};

// ── Helpers ───────────────────────────────────────────────────────
function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('p') || null;
}

function formatValue(val, unit) {
  if (unit === 'seconds') {
    const v = Math.round(Number(val));
    const m = Math.floor(v / 60);
    const s = v % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }
  return `${val} ${unit}`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getDayNumber(startDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

function getValueColor(value, max) {
  if (!max || !value) return '';
  const ratio = value / max;
  if (ratio >= 0.85) return 'logged-best';
  if (ratio >= 0.65) return 'logged-high';
  if (ratio >= 0.4)  return 'logged-mid';
  return 'logged-low';
}

function rankMedal(rank) {
  if (rank === 1) return { cls: 'gold',   icon: '🥇' };
  if (rank === 2) return { cls: 'silver', icon: '🥈' };
  if (rank === 3) return { cls: 'bronze', icon: '🥉' };
  return { cls: '', icon: `#${rank}` };
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Load data ─────────────────────────────────────────────────────
async function loadCompetition() {
  const { data, error } = await db
    .from('competitions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadParticipants(competitionId) {
  const { data, error } = await db
    .from('participants')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function loadEntries(competitionId) {
  const { data, error } = await db
    .from('entries')
    .select('*')
    .eq('competition_id', competitionId)
    .order('day_number');
  if (error) throw error;
  return data || [];
}

async function loadMessages(competitionId) {
  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function loadCommentary(competitionId) {
  const { data, error } = await db
    .from('ai_commentary')
    .select('*')
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Render Hero ───────────────────────────────────────────────────
function renderHero() {
  const c = state.competition;
  const day = state.currentDayNumber;
  const pct = Math.min(100, Math.round((day / c.duration_days) * 100));
  const endDate = new Date(c.start_date);
  endDate.setDate(endDate.getDate() + c.duration_days - 1);

  document.getElementById('heroActivityType').textContent = c.activity_type;
  document.getElementById('heroTitle').textContent = c.name;
  document.getElementById('heroDateRange').textContent =
    `${formatDate(c.start_date)} – ${formatDate(endDate)}`;
  document.getElementById('heroDayInfo').textContent =
    `Day ${Math.min(day, c.duration_days)} of ${c.duration_days}`;
  document.getElementById('heroParticipants').textContent =
    `${state.participants.length} participant${state.participants.length !== 1 ? 's' : ''}`;
  document.getElementById('heroProgressPct').textContent = `${pct}%`;
  document.getElementById('heroProgressFill').style.width = `${pct}%`;

  if (state.myParticipant) {
    document.getElementById('myName').textContent = state.myParticipant.name;
    document.getElementById('welcomeChip').style.display = 'flex';
  }
}

// ── Render Commentary ─────────────────────────────────────────────
function renderCommentary() {
  const c = state.commentary;
  const el = document.getElementById('commentaryContent');
  const badge = document.getElementById('commentaryWeekBadge');

  if (!c) {
    el.innerHTML = `<div class="commentary-empty">🎙️ No commentary yet — check back after the first week!</div>`;
    badge.textContent = 'Week —';
    return;
  }

  badge.textContent = c.title || `Week ${c.week_number}`;
  el.innerHTML = `<p class="commentary-text">${c.content.replace(/\n/g, '<br>')}</p>`;
}

// ── Render Leaderboard ────────────────────────────────────────────
function getBestValue(participantId) {
  const pEntries = state.entries.filter(e => e.participant_id === participantId);
  if (!pEntries.length) return 0;
  const vals = pEntries.map(e => Number(e.value));
  return state.competition.higher_is_better
    ? Math.max(...vals)
    : Math.min(...vals);
}

function sortParticipants(participants) {
  return [...participants].sort((a, b) => {
    const aV = getBestValue(a.id);
    const bV = getBestValue(b.id);
    if (aV === 0 && bV === 0) return 0;
    if (aV === 0) return 1;
    if (bV === 0) return -1;
    return state.competition.higher_is_better ? bV - aV : aV - bV;
  });
}

function renderLeaderboard() {
  const container = document.getElementById('leaderboard');
  const filter = state.genderFilter;

  let visible = state.participants;
  if (filter !== 'all') visible = visible.filter(p => p.gender === filter);

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No participants yet</div></div>`;
    return;
  }

  const sorted = sortParticipants(visible);
  const allMax = Math.max(...state.entries.map(e => Number(e.value)), 1);
  const duration = state.competition.duration_days;
  const today = state.currentDayNumber;
  const unit = state.competition.unit;

  container.innerHTML = sorted.map((p, idx) => {
    const rank = idx + 1;
    const medal = rankMedal(rank);
    const pEntries = state.entries.filter(e => e.participant_id === p.id);
    const entryMap = {};
    pEntries.forEach(e => { entryMap[e.day_number] = e; });
    const best = getBestValue(p.id);
    const daysLogged = pEntries.length;
    const isMe = state.myParticipant && p.id === state.myParticipant.id;

    // Day grid cells
    const cells = Array.from({ length: duration }, (_, i) => {
      const dayN = i + 1;
      const entry = entryMap[dayN];
      if (entry) {
        const colorCls = getValueColor(entry.value, allMax);
        return `<div class="day-cell ${colorCls}" title="Day ${dayN}: ${formatValue(entry.value, unit)}"></div>`;
      }
      if (dayN === today && dayN <= duration) {
        return `<div class="day-cell today-empty" title="Day ${dayN}: not logged yet"></div>`;
      }
      if (dayN < today) {
        return `<div class="day-cell past-empty" title="Day ${dayN}: missed"></div>`;
      }
      return `<div class="day-cell future"></div>`;
    }).join('');

    const rankBadgeCls = medal.cls ? `rank-badge ${medal.cls}` : 'rank-badge';

    return `
    <div class="participant-card ${isMe ? 'is-me' : ''} ${medal.cls ? `rank-${rank}` : ''}">
      <div class="participant-row">
        <div class="${rankBadgeCls}">${medal.icon}</div>
        <div class="participant-name">
          ${p.name}${isMe ? '<span class="you-tag">YOU</span>' : ''}
        </div>
        <div class="participant-stats">
          ${best ? `<span class="stat-pill best">Best: ${formatValue(best, unit)}</span>` : ''}
          <span class="stat-pill">${daysLogged}/${duration} days</span>
          ${p.gender !== 'other' ? `<span class="stat-pill">${p.gender === 'male' ? '♂' : '♀'}</span>` : ''}
        </div>
      </div>
      <div class="day-grid-wrapper">
        <div class="day-grid">${cells}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Render Personal Stats ─────────────────────────────────────────
function renderPersonalStats() {
  if (!state.myParticipant) return;
  const p = state.myParticipant;
  const unit = state.competition.unit;
  const pEntries = state.entries.filter(e => e.participant_id === p.id);
  const values = pEntries.map(e => Number(e.value));
  const best = values.length ? Math.max(...values) : 0;
  const avg  = values.length ? values.reduce((a,b) => a+b, 0) / values.length : 0;
  const days = pEntries.length;

  // Overall rank
  const sorted = sortParticipants(state.participants);
  const overallRank = sorted.findIndex(x => x.id === p.id) + 1;

  // Gender rank
  const sameGender = state.participants.filter(x => x.gender === p.gender && p.gender !== 'other');
  const genderSorted = sortParticipants(sameGender);
  const genderRank = genderSorted.findIndex(x => x.id === p.id) + 1;

  document.getElementById('personalName').textContent = p.name;
  document.getElementById('statBest').textContent = best ? formatValue(best, unit) : '—';
  document.getElementById('statAvg').textContent  = avg  ? formatValue(Math.round(avg), unit) : '—';
  document.getElementById('statDays').textContent = `${days}/${state.competition.duration_days}`;
  document.getElementById('statRank').textContent = overallRank ? `#${overallRank}` : '—';

  if (sameGender.length > 1 && genderRank) {
    document.getElementById('statGenderRankCard').style.display = '';
    document.getElementById('statGenderRank').textContent = `#${genderRank}`;
    document.getElementById('statGenderRankLabel').textContent =
      `${p.gender === 'male' ? 'Male' : 'Female'} Rank`;
  }

  // Bar chart
  renderBarChart(pEntries, unit);
}

function renderBarChart(entries, unit) {
  const chart = document.getElementById('personalChart');
  if (!entries.length) { chart.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.875rem;padding:1rem;">No entries yet — start logging!</p>'; return; }

  const maxVal = Math.max(...entries.map(e => Number(e.value)));
  const today = state.currentDayNumber;
  chart.innerHTML = entries.map(e => {
    const pct = maxVal > 0 ? (Number(e.value) / maxVal) * 80 : 4;
    const isToday = e.day_number === today;
    return `
    <div class="bar-item">
      <div class="bar ${isToday ? 'is-today' : ''}" style="height:${pct}px"
           title="Day ${e.day_number}: ${formatValue(e.value, unit)}">
      </div>
      <span class="bar-label">D${e.day_number}</span>
    </div>`;
  }).join('');
}

// ── Render Chat ───────────────────────────────────────────────────
function renderChat() {
  const msgs = state.messages;
  const pinned = msgs.filter(m => m.is_pinned);
  const regular = msgs.filter(m => !m.is_pinned);

  // Pinned
  const pinnedSection = document.getElementById('pinnedSection');
  const pinnedList = document.getElementById('pinnedList');
  if (pinned.length) {
    pinnedSection.style.display = '';
    pinnedList.innerHTML = pinned.map(m => `
      <div class="pinned-tip">
        ${m.content}
        <div class="tip-author">— ${m.author_name}</div>
      </div>`).join('');
  } else {
    pinnedSection.style.display = 'none';
  }

  // Messages
  const feed = document.getElementById('messagesFeed');
  if (!regular.length) {
    feed.innerHTML = '<div class="no-messages">Be the first to say something! 👋</div>';
    return;
  }
  feed.innerHTML = regular.map(m => `
    <div class="message">
      <div class="message-avatar">${initials(m.author_name)}</div>
      <div class="message-body">
        <div class="message-header">
          <span class="message-author">${m.author_name}</span>
          <span class="message-time">${timeAgo(m.created_at)}</span>
        </div>
        <div class="message-content">${m.content}</div>
      </div>
    </div>`).join('');
  feed.scrollTop = feed.scrollHeight;
}

// ── Log Entry Modal ───────────────────────────────────────────────
function showLogModal() {
  const day = Math.min(state.currentDayNumber, state.competition.duration_days);
  document.getElementById('logDayNum').textContent = day;
  document.getElementById('logModal').classList.add('open');
  document.getElementById('timeMinutes').value = 0;
  document.getElementById('timeSeconds').value = 0;
  document.getElementById('logNote').value = '';
  updateTimePreview();
}
function hideLogModal() {
  document.getElementById('logModal').classList.remove('open');
}

function updateTimePreview() {
  const m = parseInt(document.getElementById('timeMinutes').value) || 0;
  const s = parseInt(document.getElementById('timeSeconds').value) || 0;
  const total = m * 60 + s;
  document.getElementById('timePreview').textContent =
    total > 0 ? formatValue(total, 'seconds') + ` (${total} seconds)` : '0 seconds';
}

async function submitEntry() {
  const m = parseInt(document.getElementById('timeMinutes').value) || 0;
  const s = parseInt(document.getElementById('timeSeconds').value) || 0;
  const totalSeconds = m * 60 + s;

  if (totalSeconds <= 0) {
    alert('Please enter a time greater than 0!');
    return;
  }

  const submitBtn = document.getElementById('logModalSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  const day = Math.min(state.currentDayNumber, state.competition.duration_days);
  const note = document.getElementById('logNote').value.trim();

  const { data, error } = await db.from('entries').insert({
    participant_id: state.myParticipant.id,
    competition_id: state.competition.id,
    day_number: day,
    value: totalSeconds,
    note: note || null
  }).select().single();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Save entry ✓';

  if (error) {
    if (error.code === '23505') {
      alert("You've already logged today! Only one entry per day.");
    } else {
      alert('Error saving: ' + error.message);
    }
    return;
  }

  hideLogModal();
  state.entries.push(data);
  state.todayEntry = data;
  updateLogButton();
  renderLeaderboard();
  renderPersonalStats();
}

function updateLogButton() {
  if (!state.myParticipant) return;
  const day = Math.min(state.currentDayNumber, state.competition.duration_days);
  const todayEntry = state.entries.find(
    e => e.participant_id === state.myParticipant.id && e.day_number === day
  );

  const btn = document.getElementById('logTodayBtn');
  const msg = document.getElementById('alreadyLoggedMsg');
  const todayDisplay = document.getElementById('todayValueDisplay');

  const isOver = state.currentDayNumber > state.competition.duration_days;

  if (isOver) {
    btn.disabled = true;
    btn.textContent = '🏁 Challenge complete!';
    msg.style.display = 'none';
  } else if (todayEntry) {
    btn.style.display = 'none';
    msg.style.display = 'block';
    todayDisplay.textContent = formatValue(todayEntry.value, state.competition.unit);
  } else {
    btn.style.display = '';
    msg.style.display = 'none';
  }
}

// ── Chat submit ───────────────────────────────────────────────────
async function submitChat(e) {
  e.preventDefault();
  const nameEl = document.getElementById('chatName');
  const msgEl  = document.getElementById('chatMessage');
  const author = nameEl.value.trim();
  const content = msgEl.value.trim();

  if (!author) { nameEl.focus(); return; }
  if (!content) { msgEl.focus(); return; }

  const payload = {
    competition_id: state.competition.id,
    author_name: author,
    content,
    is_pinned: false,
    participant_id: state.myParticipant ? state.myParticipant.id : null
  };

  const { data, error } = await db.from('messages').insert(payload).select().single();
  if (error) { alert('Could not send: ' + error.message); return; }

  msgEl.value = '';
  state.messages.push(data);
  renderChat();
}

// ── Realtime subscriptions ────────────────────────────────────────
function subscribeRealtime() {
  db.channel('challenge-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entries' }, payload => {
      state.entries.push(payload.new);
      renderLeaderboard();
      if (state.myParticipant && payload.new.participant_id === state.myParticipant.id) {
        renderPersonalStats();
        updateLogButton();
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const exists = state.messages.find(m => m.id === payload.new.id);
      if (!exists) {
        state.messages.push(payload.new);
        renderChat();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      const idx = state.messages.findIndex(m => m.id === payload.new.id);
      if (idx > -1) state.messages[idx] = payload.new;
      renderChat();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_commentary' }, payload => {
      state.commentary = payload.new;
      renderCommentary();
    })
    .subscribe();
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  state.myToken = getToken();

  try {
    state.competition = await loadCompetition();
  } catch (err) {
    document.getElementById('loadingState').innerHTML =
      `<div class="error-banner" style="max-width:500px;margin:4rem auto;">Failed to load: ${err.message}</div>`;
    return;
  }

  document.getElementById('loadingState').style.display = 'none';

  if (!state.competition) {
    document.getElementById('noCompetition').style.display = 'block';
    return;
  }

  state.currentDayNumber = getDayNumber(state.competition.start_date);

  // Load all data in parallel
  const [participants, entries, messages, commentary] = await Promise.all([
    loadParticipants(state.competition.id),
    loadEntries(state.competition.id),
    loadMessages(state.competition.id),
    loadCommentary(state.competition.id)
  ]);

  state.participants = participants;
  state.entries      = entries;
  state.messages     = messages;
  state.commentary   = commentary;

  // Find participant from token
  if (state.myToken) {
    state.myParticipant = state.participants.find(p => p.token === state.myToken) || null;
    if (state.myParticipant) {
      document.getElementById('chatName').value = state.myParticipant.name;
      document.getElementById('chatName').readOnly = true;
    }
  }

  document.title = `${state.competition.name} — HälsoPulsen`;
  document.getElementById('mainContent').style.display = '';

  renderHero();
  renderCommentary();
  renderLeaderboard();
  renderChat();

  if (state.myParticipant) {
    document.getElementById('logSection').style.display = '';
    document.getElementById('personalSection').style.display = '';
    renderPersonalStats();
    updateLogButton();
  }

  subscribeRealtime();
}

// ── Event listeners ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();

  // Filter tabs
  document.getElementById('filterTabs').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.genderFilter = tab.dataset.filter;
    renderLeaderboard();
  });

  // Log button
  document.getElementById('logTodayBtn').addEventListener('click', showLogModal);
  document.getElementById('logModalCancel').addEventListener('click', hideLogModal);
  document.getElementById('logModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideLogModal();
  });
  document.getElementById('logModalSubmit').addEventListener('click', submitEntry);

  // Time preview
  document.getElementById('timeMinutes').addEventListener('input', updateTimePreview);
  document.getElementById('timeSeconds').addEventListener('input', updateTimePreview);
  // Clamp seconds
  document.getElementById('timeSeconds').addEventListener('blur', e => {
    let v = parseInt(e.target.value) || 0;
    if (v > 59) { e.target.value = 59; }
    updateTimePreview();
  });
  document.getElementById('timeMinutes').addEventListener('blur', e => {
    let v = parseInt(e.target.value) || 0;
    if (v < 0) { e.target.value = 0; }
    updateTimePreview();
  });

  // Chat
  document.getElementById('chatForm').addEventListener('submit', submitChat);
});

