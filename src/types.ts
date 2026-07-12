export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  BOT_SERVICE_SECRET: string;
  BOT_WEBHOOK_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface SessionData {
  discord_id: string;
  username: string;
  access_token?: string;
}
