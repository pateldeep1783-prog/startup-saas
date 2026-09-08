/*
# Email Integrations & Audit Logging Schema

1. Purpose
- Creates `email_integrations` table to track connected business email accounts per organization.
- Creates `email_integration_audit_logs` table for compliance and security audit trails.
- Enforces multi-tenant isolation through organization_id and Row-Level Security (RLS).

2. Security & Compliance
- Encrypted tokens only (access_token_encrypted, refresh_token_encrypted).
- Strict unique constraint UNIQUE(organization_id, provider).
- RLS enabled to isolate organization access.
*/

CREATE TABLE IF NOT EXISTS email_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gmail',
  provider_account_id text,
  email_address text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error', 'token_expired')),
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT email_integrations_org_provider_unique UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_email_integrations_org ON email_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_integrations_provider ON email_integrations(provider);

ALTER TABLE email_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_integrations_org_select" ON email_integrations;
CREATE POLICY "email_integrations_org_select" ON email_integrations
  FOR SELECT TO authenticated USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "email_integrations_org_insert" ON email_integrations;
CREATE POLICY "email_integrations_org_insert" ON email_integrations
  FOR INSERT TO authenticated WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "email_integrations_org_update" ON email_integrations;
CREATE POLICY "email_integrations_org_update" ON email_integrations
  FOR UPDATE TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "email_integrations_org_delete" ON email_integrations;
CREATE POLICY "email_integrations_org_delete" ON email_integrations
  FOR DELETE TO authenticated USING (is_org_member(organization_id));

DO $$ BEGIN
  CREATE TRIGGER email_integrations_updated_at
    BEFORE UPDATE ON email_integrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- EMAIL INTEGRATION AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS email_integration_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_audit_org ON email_integration_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_audit_action ON email_integration_audit_logs(action);

ALTER TABLE email_integration_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_audit_org_select" ON email_integration_audit_logs;
CREATE POLICY "email_audit_org_select" ON email_integration_audit_logs
  FOR SELECT TO authenticated USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "email_audit_org_insert" ON email_integration_audit_logs;
CREATE POLICY "email_audit_org_insert" ON email_integration_audit_logs
  FOR INSERT TO authenticated WITH CHECK (is_org_member(organization_id));
