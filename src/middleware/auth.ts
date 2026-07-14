import type { Context, Next } from 'hono';

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

interface SupabaseSessionResponse {
  access_token: string;
  user: {
    id: string;
    app_metadata?: { provider?: string };
    user_metadata?: {
      provider_id?: string;
      full_name?: string;
      custom_claims?: { global_name?: string };
    };
  };
  provider_token?: string;
}

/**
 * Middleware: requires a valid Supabase Auth session in the Authorization header.
 * Verifies the token with Supabase and extracts Discord user info + access token.
 * Decoded session is available as c.get('session').
 */
export async function requireSession(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing session' }, 401);
  }

  const token = auth.slice(7);

  // Verify token and get full session (including provider_token for Discord access)
  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/session`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: c.env.SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  const session = await res.json() as SupabaseSessionResponse;

  // Check it's a Discord account
  if (session.user.app_metadata?.provider !== 'discord') {
    return c.json({ error: 'Not a Discord account' }, 401);
  }

  const metadata = session.user.user_metadata;
  if (!metadata?.provider_id) {
    return c.json({ error: 'Missing Discord identity' }, 401);
  }

  c.set('session', {
    discord_id: metadata.provider_id,
    username: metadata.custom_claims?.global_name || metadata.full_name || 'unknown',
    access_token: session.provider_token,
  });

  await next();
}
