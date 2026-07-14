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

// GET /guilds/:guildId/bot-status — check if bot is in the guild
dashboard.get('/guilds/:guildId/bot-status', async (c) => {
  const { guildId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  // Check if bot is in the guild by fetching guild info with bot token
  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return c.json({ in_guild: true }); // Assume yes if no token configured
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (res.ok) {
      return c.json({ in_guild: true });
    } else if (res.status === 403 || res.status === 404) {
      return c.json({ in_guild: false });
    } else {
      // Unknown error, assume bot might be in
      return c.json({ in_guild: true });
    }
  } catch {
    return c.json({ in_guild: true }); // Assume yes on network error
  }
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
      verification_channel_id: '',
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

// GET /guilds/:guildId/verified-members — per-guild (includes verified + pending_mod_review)
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
    `?status=eq.active&select=discord_id,verified_at,method,status,verified_guild_count,guild_overrides`,
  );

  // Include users who are verified OR pending mod review in THIS guild
  const members = rows.filter(u => {
    const override = u.guild_overrides?.[guildId];
    const localStatus = override?.local_status;
    return localStatus === 'verified' || localStatus === 'pending_mod_review';
  });

  return c.json(members);
});

// POST /guilds/:guildId/members/:userId/setstatus — dashboard mod action
dashboard.post('/guilds/:guildId/members/:userId/setstatus', async (c) => {
  const { guildId, userId } = c.req.param();
  const session = c.get('session');
  if (!session?.access_token) return c.json({ error: 'Missing access token' }, 401);

  if (!(await hasManageGuild(session.access_token, guildId))) {
    return c.json({ error: 'No permission' }, 403);
  }

  const body = await c.req.json<{ status: string }>();

  const rows = await supaQuery(
    c.env,
    'verified_users',
    `?discord_id=eq.${userId}&select=guild_overrides,verified_guild_count`,
  );

  const user = rows[0];
  if (!user) return c.json({ error: 'User not found' }, 404);

  const overrides = user.guild_overrides || {};
  const existing = overrides[guildId];

  if (body.status === 'verified') {
    overrides[guildId] = {
      local_status: 'verified',
      updated_by: session.discord_id,
      updated_at: new Date().toISOString(),
    };
  } else if (body.status === 'unverified') {
    overrides[guildId] = {
      local_status: 'unverified',
      updated_by: session.discord_id,
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

  const pendingCount = allActive.filter(u => {
    const override = u.guild_overrides?.[guildId];
    return override?.local_status === 'pending_mod_review';
  }).length;

  const flaggedCount = 0;

  return c.json({
    verified_count: verifiedCount,
    pending_count: pendingCount,
    flagged_count: flaggedCount,
  });
});

export default dashboard;
