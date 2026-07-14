-- phone_otps — temporary OTP storage for phone verification
-- ============================================================
CREATE TABLE phone_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  attempts INT NOT NULL DEFAULT 0
);

-- Index for looking up OTP by phone + discord_id
CREATE INDEX idx_phone_otps_phone_discord ON phone_otps(phone, discord_id);
-- Index for cleanup of expired OTPs
CREATE INDEX idx_phone_otps_expires ON phone_otps(expires_at);

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access on phone_otps"
  ON phone_otps FOR ALL
  USING (auth.role() = 'service_role');
