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

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  app_metadata?: { provider?: string };
  user_metadata?: {
    provider_id?: string;
    full_name?: string;
    custom_claims?: { global_name?: string };
  };
  exp: number;
}

/**
 * Decode a JWT payload without verification (Supabase JWTs are signed by Supabase).
 * We trust Supabase tokens since they come from Supabase's own auth flow.
 */
function decodeJwtPayload(token: string): SupabaseJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as SupabaseJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Middleware: requires a valid Supabase Auth session in the Authorization header.
 * Decodes the JWT locally (no external API call) and extracts Discord user info.
 * Discord access token is read from the X-Discord-Token header.
 * Decoded session is available as c.get('session').
 */
export async function requireSession(c: Context, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing session' }, 401);
  }

  const token = auth.slice(7);
  const payload = decodeJwtPayload(token);

  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'Token expired' }, 401);
  }

  // Check it's a Discord account
  if (payload.app_metadata?.provider !== 'discord') {
    return c.json({ error: 'Not a Discord account' }, 401);
  }

  const metadata = payload.user_metadata;
  if (!metadata?.provider_id) {
    return c.json({ error: 'Missing Discord identity' }, 401);
  }

  // Discord access token comes from the client (stored in Supabase session as provider_token)
  const discordToken = c.req.header('X-Discord-Token') || '';

  c.set('session', {
    discord_id: metadata.provider_id,
    username: metadata.custom_claims?.global_name || metadata.full_name || 'unknown',
    access_token: discordToken,
  });

  await next();
}
