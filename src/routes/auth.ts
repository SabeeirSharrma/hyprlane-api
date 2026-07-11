import { Hono } from 'hono';
import { exchangeCode } from '../lib/discord.js';
import { signJwt } from '../lib/crypto.js';

const auth = new Hono();

// POST /auth/discord/callback — exchange OAuth code for session JWT
auth.post('/discord/callback', async (c) => {
  const body = await c.req.json<{ code: string; redirect_uri?: string }>();

  if (!body.code) {
    return c.json({ error: 'Missing code' }, 400);
  }

  const redirectUri = body.redirect_uri || 'https://hyprlane.qd.je/dashboard/';

  const { access_token, user } = await exchangeCode(
    body.code,
    c.env.DISCORD_CLIENT_ID,
    c.env.DISCORD_CLIENT_SECRET,
    redirectUri,
  );

  const jwt = await signJwt(
    {
      discord_id: user.id,
      username: user.username,
      access_token,
    },
    c.env.JWT_SIGNING_SECRET,
    86400, // 24 hours
  );

  return c.json({
    session_token: jwt,
    access_token,
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
    },
  });
});

export default auth;
