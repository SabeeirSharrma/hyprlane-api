-- Hyprlane v0.1 — Initial schema
-- Run this in your Supabase SQL editor (or via `supabase db push`)

-- ============================================================
-- verified_users — global identity, phone-link, abuse state
-- ============================================================
CREATE TABLE verified_users (
  discord_id TEXT PRIMARY KEY,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL DEFAULT 'oauth_turnstile',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'flagged_needs_phone', 'removed_duplicate')),
  phone_hash TEXT UNIQUE,
  phone_linked_at TIMESTAMPTZ,
  recent_join_count INT NOT NULL DEFAULT 0,
  recent_join_window_start TIMESTAMPTZ,
  flagged_reason TEXT,
  disposable_email_flag BOOLEAN NOT NULL DEFAULT false,
  verified_guild_count INT NOT NULL DEFAULT 0,
  guild_overrides JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- pending_tokens — single-use verification links
-- ============================================================
CREATE TABLE pending_tokens (
  token TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_pending_tokens_discord ON pending_tokens(discord_id);
CREATE INDEX idx_pending_tokens_expires ON pending_tokens(expires_at);

-- ============================================================
-- guild_config — per-server settings
-- ============================================================
CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,
  verified_role_id TEXT NOT NULL,
  log_channel_id TEXT,
  mod_role_id TEXT,
  enrolled_features TEXT[] NOT NULL DEFAULT '{}',
  feature_config JSONB NOT NULL DEFAULT '{}',
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'paid')),
  vanity_slug TEXT UNIQUE
);

CREATE INDEX idx_guild_config_plan ON guild_config(plan);

-- ============================================================
-- RLS — only service-role can read/write
-- ============================================================
ALTER TABLE verified_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_config ENABLE ROW LEVEL SECURITY;

-- No anon policies — service-role key bypasses RLS automatically
