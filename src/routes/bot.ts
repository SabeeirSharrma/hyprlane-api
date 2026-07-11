import { Hono } from 'hono';
import { requireBot } from '../middleware/auth.js';
import { supaQuery, supaInsert, supaUpsert, supaUpdate, type SupabaseEnv } from '../lib/supabase.js';
import { generateToken } from '../lib/crypto.js';

const bot = new Hono();

bot.use('*', requireBot);

// GET /:guildId/members/:userId/status
bot.get('/:guildId/members/:userId/status', async (c) => {
  const { guildId, userId } = c.req.param();
  const env = c.env as SupabaseEnv;

  const rows = await supaQuery(env, 'verified_users', `?discord_id=eq.${userId}&select=*`);
  const user = rows[0];

  if (!user) {
    return c.json({ verified: false, status: 'not_found' });
  }

  const override = user.guild_overrides?.[guildId];
  const localStatus = override?.local_status;

  return c.json({
    verified: user.status === 'active' && localStatus !== 'unverified',
    status: user.status,
    verified_at: user.verified_at,
    method: user.method,
    phone_linked: !!user.phone_hash,
    disposable_email_flag: user.disposable_email_flag,
    local_status: localStatus || null,
    verified_guild_count: user.verified_guild_count,
    guild_overrides: user.guild_overrides,
  });
});

// POST /:guildId/verification-links
bot.post('/:guildId/verification-links', async (c) => {
  const { guildId } = c.req.param();
  const body = await c.req.json<{ discord_id: string }>();
  const env = c.env as SupabaseEnv;

  const token = generateToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000);

  await supaInsert(env, 'pending_tokens', {
    token,
    discord_id: body.discord_id,
    guild_id: guildId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    used: false,
  });

  return c.json({
    token,
    url: `https://hyprlane.qd.je/verify/?token=${token}`,
    expires_at: expires.toISOString(),
  });
});

// GET /users/:discordId/hlid-card — mounted separately at /users in index.ts

// POST /:guildId/members/:userId/setstatus
bot.post('/:guildId/members/:userId/setstatus', async (c) => {
  const { guildId, userId } = c.req.param();
  const body = await c.req.json<{ status: string }>();
  const env = c.env as SupabaseEnv;

  const rows = await supaQuery(
    env,
    'verified_users',
    `?discord_id=eq.${userId}&select=guild_overrides,verified_guild_count`,
  );

  const user = rows[0];
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const overrides = user.guild_overrides || {};
  const existing = overrides[guildId];

  if (body.status === 'verified') {
    overrides[guildId] = {
      local_status: 'verified',
      updated_at: new Date().toISOString(),
    };
  } else if (body.status === 'unverified') {
    overrides[guildId] = {
      local_status: 'unverified',
      updated_at: new Date().toISOString(),
    };
  } else {
    delete overrides[guildId];
  }

  const guildCountDelta =
    body.status === 'verified' && existing?.local_status !== 'verified' ? 1
    : body.status === 'unverified' && existing?.local_status === 'verified' ? -1
    : 0;

  await supaUpdate(env, 'verified_users', `?discord_id=eq.${userId}`, {
    guild_overrides: overrides,
    verified_guild_count: user.verified_guild_count + guildCountDelta,
  });

  return c.json({ ok: true, local_status: body.status });
});

export default bot;
