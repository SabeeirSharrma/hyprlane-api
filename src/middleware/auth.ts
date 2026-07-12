import type { Context, Next } from 'hono';

export interface BotEnv {
  BOT_SERVICE_SECRET: string;
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
 * Middleware: requires a valid Supabase Auth session in the Authorization header.
 * Verifies the token with Supabase and extracts Discord user info.
 * Decoded session is available as c.get('session').
 */
export async function requireSession(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing session' }, 401);
  }

  const token = auth.slice(7);

  // Verify token with Supabase Auth API
  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: c.env.SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  const user = await res.json() as {
    id: string;
    raw_user_meta_data?: {
      provider?: string;
      provider_id?: string;
      full_name?: string;
      custom_claims?: { global_name?: string };
      access_token?: string;
    };
  };

  // Extract Discord info from raw_user_meta_data
  const metadata = user.raw_user_meta_data;
  if (!metadata || metadata.provider !== 'discord' || !metadata.provider_id) {
    return c.json({ error: 'Not a Discord account' }, 401);
  }

  c.set('session', {
    discord_id: metadata.provider_id,
    username: metadata.custom_claims?.global_name || metadata.full_name || 'unknown',
    access_token: metadata.access_token,
  });

  await next();
}
