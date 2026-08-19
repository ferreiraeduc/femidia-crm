-- =============================================================================
-- Migration 0161 — tenant approval flow
-- =============================================================================
-- Adds 'pending' and 'rejected' to organizations.status constraint.
-- New self-service tenants are created as 'pending' (see lib/auth/provision.ts).
-- Platform admins approve via POST /api/v1/admin/tenants/[id]/approve.

-- 1. Expand status constraint to include new values
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'redacted', 'archived', 'pending', 'rejected'));

-- 2. Columns for tracking approval/rejection
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 3. Index for fast lookup of pending tenants in admin dashboard
CREATE INDEX IF NOT EXISTS idx_orgs_pending
  ON public.organizations (created_at DESC)
  WHERE status = 'pending';
