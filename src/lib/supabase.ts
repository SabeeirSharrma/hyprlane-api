/**
 * Lightweight Supabase REST client — no SDK, just fetch.
 * Uses PostgREST syntax for queries.
 */

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function headers(env: SupabaseEnv) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/**
 * Query a Supabase table via PostgREST.
 * @param table - table name
 * @param query - PostgREST query string (e.g. "?select=*&status=eq.active")
 */
export async function supaQuery<T = any>(
  env: SupabaseEnv,
  table: string,
  query: string = '',
): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: headers(env),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase query ${table} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T[]>;
}

/**
 * Insert rows into a Supabase table.
 */
export async function supaInsert<T = any>(
  env: SupabaseEnv,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert ${table} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T[]>;
}

/**
 * Update rows in a Supabase table.
 * @param filter - PostgREST filter (e.g. "?discord_id=eq.123")
 */
export async function supaUpdate<T = any>(
  env: SupabaseEnv,
  table: string,
  filter: string,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${filter}`, {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase update ${table} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T[]>;
}

/**
 * Upsert rows into a Supabase table.
 */
export async function supaUpsert<T = any>(
  env: SupabaseEnv,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...headers(env),
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert ${table} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T[]>;
}

/**
 * Delete rows from a Supabase table.
 * @param filter - PostgREST filter (e.g. "?token=eq.abc123")
 */
export async function supaDelete(
  env: SupabaseEnv,
  table: string,
  filter: string,
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${filter}`, {
    method: 'DELETE',
    headers: headers(env),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase delete ${table} failed: ${res.status} ${text}`);
  }
}

/**
 * Count rows (returns total from headers).
 */
export async function supaCount(
  env: SupabaseEnv,
  table: string,
  filter: string = '',
): Promise<number> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${filter}&select=count`, {
    headers: {
      ...headers(env),
      Prefer: 'count=exact',
    },
  });

  if (!res.ok) return 0;

  const count = res.headers.get('content-range');
  if (count) {
    const match = count.match(/\/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }

  return 0;
}
