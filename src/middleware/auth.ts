import type { Context, Next } from 'hono';
import { verifyJwt } from '../lib/crypto.js';

export interface BotEnv {
  BOT_SERVICE_SECRET: string;
  JWT_SIGNING_SECRET: string;
}

/**
 * Middleware: requires a valid bot-service Bearer token.
 */
export async function requireBot(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing bot auth' }, 401);
  }

  const token = auth.slice(7);
  if (token !== c.env.BOT_SERVICE_SECRET) {
    return c.json({ error: 'Invalid bot auth' }, 403);
  }

  await next();
}

/**
 * Middleware: requires a valid session JWT in the Authorization header.
 * Decoded payload is available as c.get('session').
 */
export async function requireSession(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing session' }, 401);
  }

  const token = auth.slice(7);
  const payload = await verifyJwt<{ discord_id: string; access_token: string }>(
    token,
    c.env.JWT_SIGNING_SECRET,
  );

  if (!payload) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  c.set('session', payload);
  await next();
}
