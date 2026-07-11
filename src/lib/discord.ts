const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string;
  email?: string;
  bot?: boolean;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  roles: string[];
  premium_since?: string | null;
}

/**
 * Exchange an OAuth2 code for an access token + user info.
 */
export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ access_token: string; user: DiscordUser }> {
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Discord token exchange failed: ${tokenRes.status} ${text}`);
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) throw new Error('Failed to fetch Discord user');

  const user = await userRes.json() as DiscordUser;
  return { access_token, user };
}

/**
 * Fetch a guild member from Discord (requires bot token).
 */
export async function getGuildMember(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<DiscordGuildMember | null> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord getMember failed: ${res.status}`);

  return res.json() as Promise<DiscordGuildMember>;
}

/**
 * Fetch the user's guilds (requires user access token).
 */
export async function getUserGuilds(
  accessToken: string,
): Promise<{ id: string; name: string; icon: string; permissions: string }[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`Discord getUserGuilds failed: ${res.status}`);

  return res.json() as Promise<{ id: string; name: string; icon: string; permissions: string }[]>;
}

/**
 * Add a role to a guild member (requires bot token).
 */
export async function addRole(
  botToken: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${botToken}` },
    },
  );

  if (!res.ok) throw new Error(`Discord addRole failed: ${res.status}`);
}

/**
 * Remove a role from a guild member (requires bot token).
 */
export async function removeRole(
  botToken: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bot ${botToken}` },
    },
  );

  if (!res.ok) throw new Error(`Discord removeRole failed: ${res.status}`);
}
