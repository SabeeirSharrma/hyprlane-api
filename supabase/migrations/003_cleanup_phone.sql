-- Cleanup: remove phone-related objects (phone linking paused)
-- ============================================================

-- Drop phone_otps table
DROP TABLE IF EXISTS phone_otps;

-- Remove phone columns from verified_users
ALTER TABLE verified_users DROP COLUMN IF EXISTS phone_hash;
ALTER TABLE verified_users DROP COLUMN IF EXISTS phone_linked_at;

-- Remove phone-related status values (keep the CHECK constraint but remove the phone ones)
-- Note: 'flagged_needs_phone' and 'removed_duplicate' are still valid statuses
-- for other abuse detection, so we keep them.

-- Drop the unused phone_otps migration file note
-- (This migration replaces 002_phone_otps.sql)
