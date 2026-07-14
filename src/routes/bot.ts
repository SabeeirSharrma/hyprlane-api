import { Hono } from 'hono';
import { requireBot } from '../middleware/auth.js';
import { supaQuery, supaInsert, supaUpdate, supaUpsert, supaCount } from '../lib/supabase.js';
import { generateToken } from '../lib/crypto.js';
import type { Env } from '../types.js';

const bot = new Hono<{ Bindings: Env }>();

bot.use('*', requireBot);

// GET /:guildId/config — bot reads guild config
bot.get('/:guildId/config', async (c) => {
  const { guildId } = c.req.param();

  const rows = await supaQuery(c.env, 'guild_config', `?guild_id=eq.${guildId}&select=*`);

  if (!rows[0]) {
    return c.json({
      guild_id: guildId,
      verified_role_id: '',
      log_channel_id: '',
      mod_role_id: '',
      verification_channel_id: '',
      enrolled_features: [],
      feature_config: {},
      plan: 'free',
    });
  }

  return c.json(rows[0]);
});

// PUT /:guildId/config — bot writes guild config (via /hyprlane setup)
bot.put('/:guildId/config', async (c) => {
  const { guildId } = c.req.param();
  const body = await c.req.json();

  await supaUpsert(c.env, 'guild_config', { guild_id: guildId, ...body });

  return c.json({ ok: true });
});

// GET /:guildId/members/:userId/status
bot.get('/:guildId/members/:userId/status', async (c) => {
  const { guildId, userId } = c.req.param();

  const rows = await supaQuery(c.env, 'verified_users', `?discord_id=eq.${userId}&select=*`);
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
    disposable_email_flag: user.disposable_email_flag,
    local_status: localStatus || null,
    verified_guild_count: user.verified_guild_count,
  });
});

// POST /:guildId/verification-links
bot.post('/:guildId/verification-links', async (c) => {
  const { guildId } = c.req.param();
  const body = await c.req.json<{ discord_id: string }>();

  const token = generateToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000);

  await supaInsert(c.env, 'pending_tokens', {
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

// POST /:guildId/members/:userId/setstatus
bot.post('/:guildId/members/:userId/setstatus', async (c) => {
  const { guildId, userId } = c.req.param();
  const body = await c.req.json<{ status: string }>();

  const rows = await supaQuery(
    c.env,
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

  await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${userId}`, {
    guild_overrides: overrides,
    verified_guild_count: user.verified_guild_count + guildCountDelta,
  });

  return c.json({ ok: true, local_status: body.status });
});

// POST /:guildId/members/:userId/revoke — bot revokes member (local only)
bot.post('/:guildId/members/:userId/revoke', async (c) => {
  const { guildId, userId } = c.req.param();

  const rows = await supaQuery(
    c.env,
    'verified_users',
    `?discord_id=eq.${userId}&select=guild_overrides,verified_guild_count`,
  );

  const user = rows[0];
  if (!user) return c.json({ error: 'User not found' }, 404);

  const overrides = user.guild_overrides || {};
  const wasVerified = overrides[guildId]?.local_status === 'verified';

  overrides[guildId] = {
    local_status: 'unverified',
    updated_at: new Date().toISOString(),
  };

  await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${userId}`, {
    guild_overrides: overrides,
    verified_guild_count: user.verified_guild_count - (wasVerified ? 1 : 0),
  });

  return c.json({ ok: true });
});

// GET /:guildId/verified-members — bot reads verified members
bot.get('/:guildId/verified-members', async (c) => {
  const { guildId } = c.req.param();

  const rows = await supaQuery(
    c.env,
    'verified_users',
    `?status=eq.active&select=discord_id,verified_at,method,status,verified_guild_count,guild_overrides`,
  );

  const members = rows.filter(u => {
    const override = u.guild_overrides?.[guildId];
    return override?.local_status !== 'unverified';
  });

  return c.json(members);
});

// GET /:guildId/stats — bot reads guild stats
bot.get('/:guildId/stats', async (c) => {
  const { guildId } = c.req.param();

  const allActive = await supaQuery(
    c.env,
    'verified_users',
    `?status=eq.active&select=discord_id,guild_overrides`,
  );

  const verifiedCount = allActive.filter(u => {
    const override = u.guild_overrides?.[guildId];
    return override?.local_status === 'verified';
  }).length;

  const flaggedCount = 0;

  return c.json({
    verified_count: verifiedCount,
    flagged_count: flaggedCount,
  });
});

// POST /:guildId/role-assignments/poll — bot polls for users who need roles assigned
bot.post('/:guildId/role-assignments/poll', async (c) => {
  const { guildId } = c.req.param();

  const rows = await supaQuery(
    c.env,
    'verified_users',
    `?status=eq.active&select=discord_id,guild_overrides`,
  );

  const needsRole = rows
    .filter(u => {
      const override = u.guild_overrides?.[guildId];
      return override?.local_status === 'verified' && !override?.role_assigned;
    })
    .map(u => u.discord_id);

  return c.json({ needs_role: needsRole });
});

// POST /:guildId/role-assignments/confirm — bot confirms role was assigned
bot.post('/:guildId/role-assignments/confirm', async (c) => {
  const { guildId } = c.req.param();
  const body = await c.req.json<{ discord_ids: string[] }>();

  for (const discordId of body.discord_ids) {
    const rows = await supaQuery(
      c.env,
      'verified_users',
      `?discord_id=eq.${discordId}&select=guild_overrides`,
    );

    const user = rows[0];
    if (!user) continue;

    const overrides = user.guild_overrides || {};
    if (overrides[guildId]) {
      overrides[guildId].role_assigned = true;
      overrides[guildId].role_assigned_at = new Date().toISOString();
    }

    await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${discordId}`, {
      guild_overrides: overrides,
    });
  }

  return c.json({ ok: true });
});

export default bot;
