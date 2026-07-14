/**
 * SMS provider abstraction.
 *
 * Supported providers (set SMS_PROVIDER env var):
 *   - "msg91"    — 50 free SMS/month, no credit card (default)
 *   - "console"  — logs OTP to console, no real SMS (for local dev)
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
  env: { SMS_PROVIDER?: string; MSG91_AUTH_KEY?: string },
): Promise<SmsResult> {
  const provider = env.SMS_PROVIDER || 'console';

  if (provider === 'console') {
    console.log(`[SMS] To: ${to} | Message: ${message}`);
    return { ok: true };
  }

  if (provider === 'msg91') {
    return sendMsg91(to, env.MSG91_AUTH_KEY);
  }

  console.error(`Unknown SMS provider: ${provider}`);
  return { ok: false, error: 'Unknown SMS provider' };
}

/**
 * Send OTP via msg91 API.
 * API: https://api.msg91.com/api/sendotp.php
 */
async function sendMsg91(to: string, authKey?: string): Promise<SmsResult> {
  if (!authKey) {
    return { ok: false, error: 'MSG91 auth key not configured' };
  }

  // Strip leading + for msg91 (expects country code without +)
  const mobile = to.startsWith('+') ? to.slice(1) : to;

  const params = new URLSearchParams({
    authkey: authKey,
    mobile,
    otp_length: '6',
    otp_expiry: '10',
  });

  const res = await fetch(`https://api.msg91.com/api/sendotp.php?${params.toString()}`);
  const data = await res.json() as { message?: string; type?: string };

  if (data.type === 'success') {
    return { ok: true };
  }

  return { ok: false, error: data.message || 'msg91 send failed' };
}

/**
 * Verify OTP via msg91 API.
 * API: https://api.msg91.com/api/verifyotp.php
 */
export async function verifyMsg91Otp(
  mobile: string,
  otp: string,
  authKey?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!authKey) {
    return { ok: false, error: 'MSG91 auth key not configured' };
  }

  const phone = mobile.startsWith('+') ? mobile.slice(1) : mobile;

  const params = new URLSearchParams({
    authkey: authKey,
    mobile: phone,
    otp,
  });

  const res = await fetch(`https://api.msg91.com/api/verifyotp.php?${params.toString()}`);
  const data = await res.json() as { message?: string; type?: string };

  if (data.type === 'success') {
    return { ok: true };
  }

  return { ok: false, error: data.message || 'OTP verification failed' };
}
