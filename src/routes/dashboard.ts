import { Hono } from 'hono';
import { requireSession } from '../middleware/auth.js';
import { supaQuery, supaUpsert, supaUpdate, supaCount } from '../lib/supabase.js';
import { getUserGuilds } from '../lib/discord.js';
import type { Env, SessionData } from '../types.js';

const dashboard = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

dashboard.use('*', requireSession);

// Helper: check if the caller has MANAGE_GUILD (0x20) on the target guild
async function hasManageGuild(accessToken: string, guildId: string): Promise<boolean> {
  const guilds = await getUserGuilds(accessToken);
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) return false;
  const perms = BigInt(guild.permissions);
  return (perms & 0x20n) === 0x20n;
}

// GET /guilds — list user's manageable guilds
dashboard.get('/guilds', async (c) => {
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);
  const guilds = await getUserGuilds(session.access_token);
  return c.json(
    guilds
      .filter(g => (BigInt(g.permissions) & 0x20n) === 0x20n)
      .map(g => ({ id: g.id, name: g.name, icon: g.icon })),
  );
});

// GET /guilds/:guildId/config
dashboard.get('/guilds/:guildId/config', async (c) => {
  const { guildId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  const rows = await supaQuery(c.env, 'guild_config', `?guild_id=eq.${guildId}&select=*`);

  if (!rows[0]) {
    return c.json({
      guild_id: guildId,
      verified_role_id: '',
      log_channel_id: '',
      mod_role_id: '',
      enrolled_features: [],
      feature_config: {},
      plan: 'free',
    });
  }

  return c.json(rows[0]);
});

// PUT /guilds/:guildId/config
dashboard.put('/guilds/:guildId/config', async (c) => {
  const { guildId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  const body = await c.req.json();

  await supaUpsert(c.env, 'guild_config', { guild_id: guildId, ...body });

  return c.json({ ok: true });
});

// GET /guilds/:guildId/verified-members — per-guild
dashboard.get('/guilds/:guildId/verified-members', async (c) => {
  const { guildId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  const rows = await supaQuery(
    c.env,
    'verified_users',
    `?status=eq.active&select=discord_id,verified_at,method,status,phone_hash,verified_guild_count,guild_overrides`,
  );

  // Only include users who are verified in THIS guild
  const members = rows.filter(u => {
    const override = u.guild_overrides?.[guildId];
    return override?.local_status === 'verified';
  });

  return c.json(members);
});

// POST /guilds/:guildId/members/:userId/revoke
dashboard.post('/guilds/:guildId/members/:userId/revoke', async (c) => {
  const { guildId, userId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

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

// GET /guilds/:guildId/stats — per-guild
dashboard.get('/guilds/:guildId/stats', async (c) => {
  const { guildId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  // Fetch all active users and filter by guild
  const allActive = await supaQuery(
    c.env,
    'verified_users',
    `?status=eq.active&select=discord_id,guild_overrides`,
  );

  const verifiedCount = allActive.filter(u => {
    const override = u.guild_overrides?.[guildId];
    return override?.local_status === 'verified';
  }).length;

  const flaggedCount = await supaCount(c.env, 'verified_users', '?status=eq.flagged_needs_phone');

  return c.json({
    verified_count: verifiedCount,
    flagged_count: flaggedCount,
  });
});

export default dashboard;
