import { Hono } from 'hono';
import { supaQuery, supaInsert, supaUpsert, supaUpdate } from '../lib/supabase.js';
import { hashPhone } from '../lib/crypto.js';
import { sendSms } from '../lib/sms.js';
import type { Env } from '../types.js';

const verify = new Hono<{ Bindings: Env }>();

// Verify Turnstile token server-side
async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // Skip if not configured

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: ip,
    }).toString(),
  });

  const data = await res.json() as { success: boolean };
  return data.success;
}

// GET /:token — validate token exists, unused, unexpired
verify.get('/:token', async (c) => {
  const { token } = c.req.param();

  const rows = await supaQuery(
    c.env,
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
    turnstile_token: string;
    email?: string;
  }>();

  // Validate token
  const tokenRows = await supaQuery(
    c.env,
    'pending_tokens',
    `?token=eq.${token}&select=discord_id,guild_id,used,expires_at`,
  );
  const tokenRow = tokenRows[0];

  if (!tokenRow) return c.json({ error: 'Token not found' }, 404);
  if (tokenRow.used) return c.json({ error: 'Token already used' }, 410);
  if (new Date(tokenRow.expires_at) < new Date()) return c.json({ error: 'Token expired' }, 410);

  // Verify Turnstile server-side
  const clientIP = c.req.header('cf-connecting-ip') || '';
  const turnstileValid = await verifyTurnstile(c.env, body.turnstile_token, clientIP);
  if (!turnstileValid) {
    return c.json({ error: 'Turnstile challenge failed' }, 403);
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
  const guildId = tokenRow.guild_id;

  // Fetch existing user to get current guild_overrides
  const existingRows = await supaQuery(
    c.env,
    'verified_users',
    `?discord_id=eq.${discordUser.id}&select=guild_overrides,verified_guild_count`,
  );
  const existing = existingRows[0];

  const overrides = existing?.guild_overrides || {};
  const wasVerifiedInGuild = overrides[guildId]?.local_status === 'verified';

  // Set guild override to verified
  overrides[guildId] = {
    local_status: 'verified',
    verified_at: now,
    role_assigned: false, // Bot will poll and assign
  };

  // Increment guild count if newly verified in this guild
  const currentCount = existing?.verified_guild_count || 0;
  const newCount = wasVerifiedInGuild ? currentCount : currentCount + 1;

  await supaUpsert(c.env, 'verified_users', {
    discord_id: discordUser.id,
    verified_at: now,
    method: 'oauth_turnstile',
    status: 'active',
    disposable_email_flag: disposableFlag,
    guild_overrides: overrides,
    verified_guild_count: newCount,
  });

  // Mark token used
  await supaUpdate(c.env, 'pending_tokens', `?token=eq.${token}`, { used: true });

  return c.json({ ok: true });
});

// POST /phone/:discordId/otp — send OTP to phone
verify.post('/phone/:discordId/otp', async (c) => {
  const { discordId } = c.req.param();
  const body = await c.req.json<{ phone: string }>();

  if (!body.phone || !body.phone.startsWith('+')) {
    return c.json({ error: 'Invalid phone number — use E.164 format' }, 400);
  }

  // Rate limit: max 3 OTPs per phone per 10 minutes
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentOtps = await supaQuery(
    c.env,
    'phone_otps',
    `?phone=eq.${encodeURIComponent(body.phone)}&created_at=gt.${tenMinAgo}&select=id`,
  );
  if (recentOtps.length >= 3) {
    return c.json({ error: 'Too many requests — wait a few minutes' }, 429);
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));

  // Store OTP (expires in 10 minutes)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supaInsert(c.env, 'phone_otps', {
    phone: body.phone,
    otp,
    discord_id: discordId,
    expires_at: expiresAt,
  });

  // Send SMS
  const result = await sendSms(body.phone, `Your Hyprlane verification code is: ${otp}`, c.env);
  if (!result.ok) {
    return c.json({ error: result.error || 'Failed to send SMS' }, 502);
  }

  return c.json({ ok: true, message: 'OTP sent' });
});

// POST /phone/:discordId/confirm — confirm OTP, hash+store phone
verify.post('/phone/:discordId/confirm', async (c) => {
  const { discordId } = c.req.param();
  const body = await c.req.json<{ phone: string; otp: string }>();

  if (!body.phone || !body.otp) {
    return c.json({ error: 'Missing phone or OTP' }, 400);
  }

  // Find the most recent unused OTP for this phone+discord
  const otpRows = await supaQuery(
    c.env,
    'phone_otps',
    `?phone=eq.${encodeURIComponent(body.phone)}&discord_id=eq.${discordId}&used=eq.false&order=created_at.desc&limit=1`,
  );

  const otpRow = otpRows[0];
  if (!otpRow) {
    return c.json({ error: 'No OTP found — request a new code' }, 404);
  }

  // Check expiry
  if (new Date(otpRow.expires_at) < new Date()) {
    return c.json({ error: 'OTP expired — request a new code' }, 410);
  }

  // Check attempts (max 5)
  if (otpRow.attempts >= 5) {
    return c.json({ error: 'Too many attempts — request a new code' }, 429);
  }

  // Verify OTP
  if (otpRow.otp !== body.otp) {
    // Increment attempts
    await supaUpdate(c.env, 'phone_otps', `?id=eq.${otpRow.id}`, {
      attempts: otpRow.attempts + 1,
    });
    return c.json({ error: 'Invalid code' }, 401);
  }

  // Mark OTP used
  await supaUpdate(c.env, 'phone_otps', `?id=eq.${otpRow.id}`, { used: true });

  // Hash the phone
  const phoneHash = await hashPhone(body.phone);

  // Check for duplicate
  const existing = await supaQuery(
    c.env,
    'verified_users',
    `?phone_hash=eq.${phoneHash}&select=discord_id`,
  );

  if (existing[0] && existing[0].discord_id !== discordId) {
    // Duplicate — reject and flag this account
    await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${discordId}`, {
      status: 'removed_duplicate',
      flagged_reason: 'duplicate_phone',
    });

    return c.json(
      { error: 'duplicate_phone', message: 'Phone number already linked to another account' },
      409,
    );
  }

  // Link phone
  await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${discordId}`, {
    phone_hash: phoneHash,
    phone_linked_at: new Date().toISOString(),
    // Clear flagged status if phone was the gate
    ...(existing[0]?.discord_id === discordId ? { status: 'active', flagged_reason: null } : {}),
  });

  return c.json({ ok: true });
});

// DELETE /phone/:discordId — unlink phone
verify.delete('/phone/:discordId', async (c) => {
  const { discordId } = c.req.param();

  await supaUpdate(c.env, 'verified_users', `?discord_id=eq.${discordId}`, {
    phone_hash: null,
    phone_linked_at: null,
  });

  return c.json({ ok: true });
});

export default verify;
