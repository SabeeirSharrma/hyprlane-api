import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requireBot } from './middleware/auth.js';
import { supaQuery } from './lib/supabase.js';
import type { Env } from './types.js';
import botRoutes from './routes/bot.js';
import verifyRoutes from './routes/verify.js';
import dashboardRoutes from './routes/dashboard.js';

const app = new Hono<{ Bindings: Env }>();

// --- Middleware ---
app.use('*', logger());

const allowedOrigins = [
  'https://hyprlane.qd.je',
];

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (allowedOrigins.some(o => origin.startsWith(o))) return origin;
    if (origin.startsWith('http://localhost')) return origin;
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Discord-Token'],
  credentials: true,
}));

// --- Rate limiting ---
// Simple in-memory sliding window rate limiter
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(windowMs: number, max: number) {
  return async (c: any, next: () => Promise<void>) => {
    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    const path = c.req.path;
    const key = `${ip}:${path}`;
    const now = Date.now();

    const entry = rateLimits.get(key);
    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
      entry.count++;
    } else {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    }

    // Cleanup old entries periodically
    if (rateLimits.size > 10000) {
      for (const [k, v] of rateLimits) {
        if (v.resetAt < now) rateLimits.delete(k);
      }
    }

    await next();
  };
}

// Health check — no rate limit
app.get('/', (c) => c.json({ status: 'ok', service: 'hyprlane-api', version: '0.1.0' }));

// Verify endpoints — strict rate limit (5 requests per minute per IP)
app.use('/verify/*', rateLimit(60_000, 5));

// Bot endpoints — generous rate limit (60 requests per minute per IP)
app.use('/guilds/*', rateLimit(60_000, 60));

// Dashboard endpoints — moderate rate limit (30 requests per minute per IP)
app.use('/dashboard/*', rateLimit(60_000, 30));

// --- Route mounting ---
// Bot routes: /guilds/:guildId/...
app.route('/guilds', botRoutes);
// Hlid route: /users/:discordId/hlid-card (bot-authed)
app.get('/users/:discordId/hlid-card', requireBot, async (c) => {
  const { discordId } = c.req.param();
  const rows = await supaQuery(c.env, 'verified_users', `?discord_id=eq.${discordId}&select=verified_at,method,status,verified_guild_count,disposable_email_flag`);
  const user = rows[0];
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({
    discord_id: discordId,
    verified: user.status === 'active',
    verified_at: user.verified_at,
    method: user.method,
    verified_guild_count: user.verified_guild_count,
    disposable_email_flag: user.disposable_email_flag,
  });
});
// Verify routes: /verify/:token, /verify/:token/complete
app.route('/verify', verifyRoutes);
// Dashboard routes: /dashboard/guilds/:guildId/...
app.route('/dashboard', dashboardRoutes);

// --- 404 ---
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// --- Error handler ---
app.onError((err, c) => {
  console.error('[ERROR]', err.message, err.stack);
  return c.json({ error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,
};
