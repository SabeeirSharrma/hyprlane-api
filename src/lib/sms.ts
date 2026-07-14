/**
 * SMS provider abstraction.
 *
 * Supported providers (set SMS_PROVIDER env var):
 *   - "textbelt"  — 1 free SMS/day, good for dev (default)
 *   - "console"   — logs OTP to console, no real SMS (for local dev)
 *
 * For production, swap in Twilio/Vonage/msg91 here.
 */

export interface SmsResult {
  ok: boolean;
  error?: string;
}

/**
 * Send an OTP via SMS.
 */
export async function sendSms(
  to: string,
  message: string,
  env: { SMS_PROVIDER?: string; TEXTBelt_API_KEY?: string },
): Promise<SmsResult> {
  const provider = env.SMS_PROVIDER || 'console';

  if (provider === 'console') {
    console.log(`[SMS] To: ${to} | Message: ${message}`);
    return { ok: true };
  }

  if (provider === 'textbelt') {
    return sendTextBelt(to, message, env.TEXTBelt_API_KEY);
  }

  console.error(`Unknown SMS provider: ${provider}`);
  return { ok: false, error: 'Unknown SMS provider' };
}

async function sendTextBelt(
  to: string,
  message: string,
  apiKey?: string,
): Promise<SmsResult> {
  const body = new URLSearchParams();
  body.set('phone', to);
  body.set('message', message);
  body.set('key', apiKey || 'textbelt');

  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    body,
  });

  const data = await res.json() as { success: boolean; quotaRemaining?: number; error?: string };

  if (data.success) {
    return { ok: true };
  }
  return { ok: false, error: data.error || 'SMS send failed' };
}
