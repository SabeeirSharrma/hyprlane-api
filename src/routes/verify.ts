import { Hono } from 'hono';
import { supaQuery, supaInsert, supaUpsert, supaUpdate, type SupabaseEnv } from '../lib/supabase.js';
import { hashPhone } from '../lib/crypto.js';

const verify = new Hono();

// GET /:token — validate token exists, unused, unexpired
verify.get('/:token', async (c) => {
  const { token } = c.req.param();
  const env = c.env as SupabaseEnv;

  const rows = await supaQuery(
    env,
    'pending_tokens',
    `?token=eq.${token}&select=discord_id,guild_id,expires_at,used`,
  );

  const data = rows[0];

  if (!data) {
    return c.json({ valid: false, reason: 'not_found' }, 404);
  }

  if (data.used) {
    return c.json({ valid: false, reason: 'already_used' }, 410);
  }

  if (new Date(data.expires_at) < new Date()) {
    return c.json({ valid: false, reason: 'expired' }, 410);
  }

  return c.json({
    valid: true,
    discord_id: data.discord_id,
    guild_id: data.guild_id,
    expires_at: data.expires_at,
  });
});

// POST /:token/complete — submit verification result
verify.post('/:token/complete', async (c) => {
  const { token } = c.req.param();
  const body = await c.req.json<{
    access_token: string;
    discord_id: string;
    challenge_passed: boolean;
    email?: string;
  }>();
  const env = c.env as SupabaseEnv;

  // Validate token
  const tokenRows = await supaQuery(
    env,
    'pending_tokens',
    `?token=eq.${token}&select=discord_id,guild_id,used,expires_at`,
  );
  const tokenRow = tokenRows[0];

  if (!tokenRow) return c.json({ error: 'Token not found' }, 404);
  if (tokenRow.used) return c.json({ error: 'Token already used' }, 410);
  if (new Date(tokenRow.expires_at) < new Date()) return c.json({ error: 'Token expired' }, 410);
  if (!body.challenge_passed) {
    return c.json({ error: 'Challenge not passed' }, 400);
  }

  // Verify access_token against Discord API — confirms identity server-side
  const discordRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });

  if (!discordRes.ok) {
    return c.json({ error: 'Invalid Discord access token' }, 401);
  }

  const discordUser = await discordRes.json() as { id: string; email?: string };

  if (discordUser.id !== tokenRow.discord_id) {
    return c.json({ error: 'Token mismatch — wrong Discord account' }, 403);
  }

  // Disposable email check
  let disposableFlag = false;
  if (discordUser.email) {
    const domain = discordUser.email.split('@')[1]?.toLowerCase();
    const disposableDomains = new Set([
      'guerrillamail.com', 'tempmail.com', 'throwaway.email',
      'temp-mail.org', 'fakeinbox.com', 'sharklasers.com',
      'guerrillamailblock.com', 'grr.la', 'dispostable.com',
      'mailinator.com', 'yopmail.com', 'yopmail.fr',
      '10minutemail.com', 'guerrillamail.info', 'getairmail.com',
    ]);
    disposableFlag = disposableDomains.has(domain);
  }

  // Upsert verified user
  const now = new Date().toISOString();
  await supaUpsert(env, 'verified_users', {
    discord_id: discordUser.id,
    verified_at: now,
    method: 'oauth_turnstile',
    status: 'active',
    disposable_email_flag: disposableFlag,
  });

  // Mark token used
  await supaUpdate(env, 'pending_tokens', `?token=eq.${token}`, { used: true });

  // Notify bot to assign role (fire-and-forget)
  const botWebhookUrl = c.env.BOT_WEBHOOK_URL;
  if (botWebhookUrl) {
    c.executionCtx.waitUntil(
      fetch(botWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'member-verified',
          discord_id: discordUser.id,
          guild_id: tokenRow.guild_id,
        }),
      }).catch(() => {}),
    );
  }

  return c.json({ ok: true });
});

// POST /phone/:discordId/otp — send OTP to phone
verify.post('/phone/:discordId/otp', async (c) => {
  const body = await c.req.json<{ phone: string }>();

  if (!body.phone || !body.phone.startsWith('+')) {
    return c.json({ error: 'Invalid phone number — use E.164 format' }, 400);
  }

  // TODO: Integrate with Twilio or SMS provider
  return c.json({ ok: true, message: 'OTP sent' });
});

// POST /phone/:discordId/confirm — confirm OTP, hash+store phone
verify.post('/phone/:discordId/confirm', async (c) => {
  const { discordId } = c.req.param();
  const body = await c.req.json<{ phone: string; otp: string }>();
  const env = c.env as SupabaseEnv;

  // TODO: Verify OTP with SMS provider

  // Hash the phone
  const phoneHash = await hashPhone(body.phone);

  // Check for duplicate
  const existing = await supaQuery(
    env,
    'verified_users',
    `?phone_hash=eq.${phoneHash}&select=discord_id`,
  );

  if (existing[0] && existing[0].discord_id !== discordId) {
    // Duplicate — reject and flag this account
    await supaUpdate(env, 'verified_users', `?discord_id=eq.${discordId}`, {
      status: 'removed_duplicate',
      flagged_reason: 'duplicate_phone',
    });

    return c.json(
      { error: 'duplicate_phone', message: 'Phone number already linked to another account' },
      409,
    );
  }

  // Link phone
  await supaUpdate(env, 'verified_users', `?discord_id=eq.${discordId}`, {
    phone_hash: phoneHash,
    phone_linked_at: new Date().toISOString(),
    // Clear flagged status if phone was the gate
    ...(existing[0]?.discord_id === discordId ? { status: 'active', flagged_reason: null } : {}),
  });

  return c.json({ ok: true });
});

export default verify;
