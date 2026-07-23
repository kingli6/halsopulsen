-- ================================================================
-- HälsoPulsen Challenges — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ================================================================

-- Competitions
CREATE TABLE IF NOT EXISTS competitions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'Dead Hang',
  unit          TEXT NOT NULL DEFAULT 'seconds',
  unit_label    TEXT NOT NULL DEFAULT 'seconds',
  higher_is_better BOOLEAN DEFAULT true,
  duration_days INTEGER NOT NULL DEFAULT 30,
  start_date    DATE NOT NULL,
  is_active     BOOLEAN DEFAULT false,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Participants
CREATE TABLE IF NOT EXISTS participants (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  gender         TEXT CHECK (gender IN ('male', 'female', 'other')) DEFAULT 'other',
  token          TEXT UNIQUE NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Entries (one per participant per day)
CREATE TABLE IF NOT EXISTS entries (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
  day_number     INTEGER NOT NULL CHECK (day_number >= 1),
  value          NUMERIC NOT NULL CHECK (value >= 0),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(participant_id, day_number)
);

-- Messages (chat)
CREATE TABLE IF NOT EXISTS messages (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  author_name    TEXT NOT NULL,
  content        TEXT NOT NULL,
  is_pinned      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- AI Commentary
CREATE TABLE IF NOT EXISTS ai_commentary (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
  week_number    INTEGER,
  title          TEXT,
  content        TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------
-- Disable RLS (open access — suitable for a private friend group)
-- ----------------------------------------------------------------
ALTER TABLE competitions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE participants    DISABLE ROW LEVEL SECURITY;
ALTER TABLE entries         DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages        DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_commentary   DISABLE ROW LEVEL SECURITY;

-- Grant access to anon role (used by publishable key)
GRANT ALL ON competitions   TO anon, authenticated;
GRANT ALL ON participants   TO anon, authenticated;
GRANT ALL ON entries        TO anon, authenticated;
GRANT ALL ON messages       TO anon, authenticated;
GRANT ALL ON ai_commentary  TO anon, authenticated;
