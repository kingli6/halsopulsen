const express = require('express');
const path = require('path');
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

if (!SUPABASE_READY) console.warn('⚠  SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — challenge features disabled.');
if (!OPENAI_READY)  console.warn('⚠  OPENAI_API_KEY not set — AI commentary disabled.');

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

app.listen(5000, '0.0.0.0', () => {
  console.log('HälsoPulsen running on port 5000');
});
