import satori from 'satori';
import { Resvg } from '@resvg/resvg-wasm';

export interface HlidData {
  discord_id: string;
  username: string;
  avatar_url: string;
  verified_at: string | null;
  verified_guild_count: number;
  account_created_at: string | null;
}

export async function renderHlidCard(data: HlidData): Promise<Buffer> {
  // Fetch avatar as base64
  let avatarBase64 = '';
  if (data.avatar_url) {
    try {
      const res = await fetch(data.avatar_url);
      const buf = Buffer.from(await res.arrayBuffer());
      avatarBase64 = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {}
  }

  const verifiedDate = data.verified_at
    ? new Date(data.verified_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Not verified';

  const accountAge = data.account_created_at ? getAccountAge(data.account_created_at) : 'Unknown';

  const svg = await satori(
    {
      type: 'div',
      props: {
        children: [
          // Header
          {
            type: 'div',
            props: {
              children: [
                {
                  type: 'div',
                  props: {
                    children: 'HYPRLANE ID',
                    style: { color: '#1a1714', fontSize: '22px', fontWeight: 'bold', fontFamily: 'sans-serif' },
                  },
                },
              ],
              style: {
                background: '#f59e0b',
                padding: '16px 24px',
                borderRadius: '16px 16px 0 0',
              },
            },
          },
          // Content
          {
            type: 'div',
            props: {
              children: [
                // Avatar + Username row
                {
                  type: 'div',
                  props: {
                    children: [
                      // Avatar
                      {
                        type: 'img',
                        props: {
                          src: avatarBase64 || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect fill="#f59e0b" width="80" height="80"/><text x="40" y="52" text-anchor="middle" fill="#1a1714" font-size="32" font-weight="bold" font-family="sans-serif">' + data.username.charAt(0).toUpperCase() + '</text></svg>')}`,
                          style: { width: '80px', height: '80px', borderRadius: '50%' },
                        },
                      },
                      // Username + ID
                      {
                        type: 'div',
                        props: {
                          children: [
                            {
                              type: 'div',
                              props: {
                                children: data.username,
                                style: { color: '#f5f5f4', fontSize: '20px', fontWeight: 'bold', fontFamily: 'sans-serif' },
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                children: data.discord_id,
                                style: { color: '#78716c', fontSize: '13px', fontFamily: 'monospace', marginTop: '4px' },
                              },
                            },
                          ],
                          style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: '16px' },
                        },
                      },
                    ],
                    style: { display: 'flex', alignItems: 'center', padding: '24px' },
                  },
                },
                // Divider
                {
                  type: 'div',
                  props: {
                    style: { height: '1px', background: '#2d2a26', margin: '0 24px' },
                  },
                },
                // Stats row
                {
                  type: 'div',
                  props: {
                    children: [
                      // Verified
                      {
                        type: 'div',
                        props: {
                          children: [
                            { type: 'div', props: { children: 'VERIFIED', style: { color: '#78716c', fontSize: '12px', fontFamily: 'sans-serif' } } },
                            { type: 'div', props: { children: verifiedDate, style: { color: data.verified_at ? '#22c55e' : '#ef4444', fontSize: '16px', fontWeight: 'bold', fontFamily: 'sans-serif', marginTop: '4px' } } },
                          ],
                        },
                      },
                      // Servers
                      {
                        type: 'div',
                        props: {
                          children: [
                            { type: 'div', props: { children: 'SERVERS', style: { color: '#78716c', fontSize: '12px', fontFamily: 'sans-serif' } } },
                            { type: 'div', props: { children: String(data.verified_guild_count ?? 0), style: { color: '#f59e0b', fontSize: '16px', fontWeight: 'bold', fontFamily: 'sans-serif', marginTop: '4px' } } },
                          ],
                        },
                      },
                      // Account Age
                      {
                        type: 'div',
                        props: {
                          children: [
                            { type: 'div', props: { children: 'ACCOUNT AGE', style: { color: '#78716c', fontSize: '12px', fontFamily: 'sans-serif' } } },
                            { type: 'div', props: { children: accountAge, style: { color: '#f5f5f4', fontSize: '16px', fontWeight: 'bold', fontFamily: 'sans-serif', marginTop: '4px' } } },
                          ],
                        },
                      },
                    ],
                    style: { display: 'flex', gap: '40px', padding: '24px' },
                  },
                },
                // Footer
                {
                  type: 'div',
                  props: {
                    children: 'hyprlane.qd.je',
                    style: { color: '#78716c', fontSize: '11px', fontFamily: 'sans-serif', padding: '12px 24px' },
                  },
                },
              ],
              style: { background: '#1a1714', borderRadius: '0 0 16px 16px' },
            },
          },
        ],
        style: {
          width: '600px',
          background: '#1a1714',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      },
    },
    {
      width: 600,
      height: 340,
      fonts: [],
    },
  );

  // Convert SVG to PNG
  const resvg = new Resvg(svg);
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

function getAccountAge(iso: string): string {
  const created = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const years = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor((diffMs % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));

  if (years > 0) return `${years}y ${months}mo`;
  if (months > 0) return `${months}mo`;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return `${days}d`;
}
