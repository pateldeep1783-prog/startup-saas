/*
# ReceptionAI Extended Schema — Conversations, Payments, Automations, Reviews, Notifications

1. Purpose
- Adds the operational tables that power the AI receptionist, messaging, payments,
  automations, reviews, notifications, and audit logging.

2. New Tables
- `conversations` — unified inbox threads (channel, customer, status, assigned staff, ai/human owner).
- `conversation_messages` — individual messages within a conversation.
- `ai_sessions` — AI receptionist session metadata (intent, tool calls, escalation state).
- `ai_tool_calls` — log of AI tool invocations for audit and analytics.
- `automations` — trigger/condition/action automation definitions per org.
- `automation_runs` — execution log for automations.
- `payments` — payment records linked to bookings (Stripe architecture).
- `payment_transactions` — individual transaction events (charge, refund, etc.).
- `reviews` — customer review requests and responses.
- `notifications` — in-app notification records.
- `documents` — knowledge base document uploads (processing state).
- `webhooks` — outbound webhook configurations per org.
- `webhook_deliveries` — webhook delivery attempt logs.
- `audit_logs` — platform audit trail.
- `subscription_plans` — SaaS plan definitions (configurable from admin).
- `subscriptions` — org subscription state.
- `usage_records` — monthly usage tracking per org.
- `support_tickets` — support ticket system.

3. Security
- RLS enabled on all tables.
- Org-owned tables scoped via is_org_member().
- subscription_plans is readable by all authenticated users (plan catalog).
- audit_logs is org-scoped for business users; super admin access via service role.

4. Notes
- All org-owned tables carry organization_id.
- Indexes on foreign keys and commonly queried columns.
- Soft-delete where appropriate.
*/

-- ============================================================
-- CONVERSATIONS (unified inbox)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'website' CHECK (channel IN ('website','sms','whatsapp','email','voice')),
  status text DEFAULT 'open' CHECK (status IN ('open','ai_active','human_required','closed')),
  assigned_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  owned_by text DEFAULT 'ai' CHECK (owned_by IN ('ai','human')),
  last_message text,
  last_message_at timestamptz,
  ai_session_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_conv_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conv_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);

DO $$ BEGIN
  CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "conv_select_org" ON conversations;
CREATE POLICY "conv_select_org" ON conversations FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "conv_insert_org" ON conversations;
CREATE POLICY "conv_insert_org" ON conversations FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "conv_update_org" ON conversations;
CREATE POLICY "conv_update_org" ON conversations FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "conv_delete_org" ON conversations;
CREATE POLICY "conv_delete_org" ON conversations FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- CONVERSATION MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL DEFAULT 'customer' CHECK (sender_type IN ('customer','ai','staff','system')),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cm_conv ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cm_created ON conversation_messages(created_at);

DROP POLICY IF EXISTS "cm_select_org" ON conversation_messages;
CREATE POLICY "cm_select_org" ON conversation_messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND is_org_member(c.organization_id))
  );
DROP POLICY IF EXISTS "cm_insert_org" ON conversation_messages;
CREATE POLICY "cm_insert_org" ON conversation_messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND is_org_member(c.organization_id))
  );
DROP POLICY IF EXISTS "cm_delete_org" ON conversation_messages;
CREATE POLICY "cm_delete_org" ON conversation_messages FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND is_org_member(c.organization_id))
  );

-- ============================================================
-- AI SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  intent text,
  confidence numeric(5,2),
  status text DEFAULT 'active' CHECK (status IN ('active','completed','escalated','failed')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  escalated boolean DEFAULT false,
  escalation_reason text,
  token_count int DEFAULT 0,
  message_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ai_org ON ai_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv ON ai_sessions(conversation_id);

DO $$ BEGIN
  CREATE TRIGGER ai_sessions_updated_at BEFORE UPDATE ON ai_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "ai_select_org" ON ai_sessions;
CREATE POLICY "ai_select_org" ON ai_sessions FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "ai_insert_org" ON ai_sessions;
CREATE POLICY "ai_insert_org" ON ai_sessions FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "ai_update_org" ON ai_sessions;
CREATE POLICY "ai_update_org" ON ai_sessions FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "ai_delete_org" ON ai_sessions;
CREATE POLICY "ai_delete_org" ON ai_sessions FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- AI TOOL CALLS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_session_id uuid REFERENCES ai_sessions(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  arguments jsonb DEFAULT '{}'::jsonb,
  result jsonb DEFAULT '{}'::jsonb,
  success boolean DEFAULT true,
  error text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_atc_org ON ai_tool_calls(organization_id);
CREATE INDEX IF NOT EXISTS idx_atc_session ON ai_tool_calls(ai_session_id);

DROP POLICY IF EXISTS "atc_select_org" ON ai_tool_calls;
CREATE POLICY "atc_select_org" ON ai_tool_calls FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "atc_insert_org" ON ai_tool_calls;
CREATE POLICY "atc_insert_org" ON ai_tool_calls FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL,
  trigger_config jsonb DEFAULT '{}'::jsonb,
  conditions jsonb DEFAULT '[]'::jsonb,
  actions jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_auto_org ON automations(organization_id);

DO $$ BEGIN
  CREATE TRIGGER automations_updated_at BEFORE UPDATE ON automations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "auto_select_org" ON automations;
CREATE POLICY "auto_select_org" ON automations FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "auto_insert_org" ON automations;
CREATE POLICY "auto_insert_org" ON automations FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "auto_update_org" ON automations;
CREATE POLICY "auto_update_org" ON automations FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "auto_delete_org" ON automations;
CREATE POLICY "auto_delete_org" ON automations FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_entity_id uuid,
  status text DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  result jsonb DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ar_org ON automation_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ar_auto ON automation_runs(automation_id);

DROP POLICY IF EXISTS "ar_select_org" ON automation_runs;
CREATE POLICY "ar_select_org" ON automation_runs FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "ar_insert_org" ON automation_runs;
CREATE POLICY "ar_insert_org" ON automation_runs FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'GBP',
  type text DEFAULT 'full' CHECK (type IN ('full','deposit','balance')),
  status text DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','partially_refunded')),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pay_org ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_pay_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status);

DO $$ BEGIN
  CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "pay_select_org" ON payments;
CREATE POLICY "pay_select_org" ON payments FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "pay_insert_org" ON payments;
CREATE POLICY "pay_insert_org" ON payments FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "pay_update_org" ON payments;
CREATE POLICY "pay_update_org" ON payments FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "pay_delete_org" ON payments;
CREATE POLICY "pay_delete_org" ON payments FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('charge','refund','partial_refund','dispute','fee')),
  amount numeric(10,2) NOT NULL DEFAULT 0,
  status text DEFAULT 'completed',
  stripe_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pt_org ON payment_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_pt_payment ON payment_transactions(payment_id);

DROP POLICY IF EXISTS "pt_select_org" ON payment_transactions;
CREATE POLICY "pt_select_org" ON payment_transactions FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "pt_insert_org" ON payment_transactions;
CREATE POLICY "pt_insert_org" ON payment_transactions FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  rating int CHECK (rating BETWEEN 1 AND 5),
  comment text,
  is_public boolean DEFAULT false,
  staff_response text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','positive','negative','responded')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rev_org ON reviews(organization_id);
CREATE INDEX IF NOT EXISTS idx_rev_rating ON reviews(rating);

DO $$ BEGIN
  CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "rev_select_org" ON reviews;
CREATE POLICY "rev_select_org" ON reviews FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "rev_insert_org" ON reviews;
CREATE POLICY "rev_insert_org" ON reviews FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "rev_update_org" ON reviews;
CREATE POLICY "rev_update_org" ON reviews FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "rev_delete_org" ON reviews;
CREATE POLICY "rev_delete_org" ON reviews FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  entity_type text,
  entity_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_notif_org ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

DROP POLICY IF EXISTS "notif_select_org" ON notifications;
CREATE POLICY "notif_select_org" ON notifications FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "notif_insert_org" ON notifications;
CREATE POLICY "notif_insert_org" ON notifications FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "notif_update_org" ON notifications;
CREATE POLICY "notif_update_org" ON notifications FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "notif_delete_org" ON notifications;
CREATE POLICY "notif_delete_org" ON notifications FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- DOCUMENTS (Knowledge Base)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  type text DEFAULT 'faq' CHECK (type IN ('faq','policy','service','business_info','document')),
  content text,
  category text,
  status text DEFAULT 'ready' CHECK (status IN ('processing','ready','failed')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_doc_org ON documents(organization_id);

DO $$ BEGIN
  CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "doc_select_org" ON documents;
CREATE POLICY "doc_select_org" ON documents FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "doc_insert_org" ON documents;
CREATE POLICY "doc_insert_org" ON documents FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "doc_update_org" ON documents;
CREATE POLICY "doc_update_org" ON documents FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "doc_delete_org" ON documents;
CREATE POLICY "doc_delete_org" ON documents FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- WEBHOOKS
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret text,
  events text[] DEFAULT '{}'::text[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wh_org ON webhooks(organization_id);

DO $$ BEGIN
  CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "wh_select_org" ON webhooks;
CREATE POLICY "wh_select_org" ON webhooks FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "wh_insert_org" ON webhooks;
CREATE POLICY "wh_insert_org" ON webhooks FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "wh_update_org" ON webhooks;
CREATE POLICY "wh_update_org" ON webhooks FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "wh_delete_org" ON webhooks;
CREATE POLICY "wh_delete_org" ON webhooks FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  status_code int,
  response_body text,
  attempt int DEFAULT 1,
  status text DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','retrying')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wd_org ON webhook_deliveries(organization_id);
CREATE INDEX IF NOT EXISTS idx_wd_webhook ON webhook_deliveries(webhook_id);

DROP POLICY IF EXISTS "wd_select_org" ON webhook_deliveries;
CREATE POLICY "wd_select_org" ON webhook_deliveries FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "wd_insert_org" ON webhook_deliveries;
CREATE POLICY "wd_insert_org" ON webhook_deliveries FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

DROP POLICY IF EXISTS "audit_select_org" ON audit_logs;
CREATE POLICY "audit_select_org" ON audit_logs FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "audit_insert_org" ON audit_logs;
CREATE POLICY "audit_insert_org" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- SUBSCRIPTION PLANS (SaaS catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  price_yearly numeric(10,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  features jsonb DEFAULT '[]'::jsonb,
  limits jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TRIGGER subplans_updated_at BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "subplans_select_all" ON subscription_plans;
CREATE POLICY "subplans_select_all" ON subscription_plans FOR SELECT
  TO anon, authenticated USING (is_active = true);

-- ============================================================
-- SUBSCRIPTIONS (org subscription state)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  status text DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','unpaid')),
  billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sub_org ON subscriptions(organization_id);

DO $$ BEGIN
  CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "sub_select_org" ON subscriptions;
CREATE POLICY "sub_select_org" ON subscriptions FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "sub_update_org" ON subscriptions;
CREATE POLICY "sub_update_org" ON subscriptions FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- USAGE RECORDS (monthly usage tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  ai_messages int DEFAULT 0,
  ai_tokens int DEFAULT 0,
  voice_minutes int DEFAULT 0,
  sms_sent int DEFAULT 0,
  emails_sent int DEFAULT 0,
  whatsapp_messages int DEFAULT 0,
  bookings_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, period_start)
);
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_usage_org ON usage_records(organization_id);

DO $$ BEGIN
  CREATE TRIGGER usage_updated_at BEFORE UPDATE ON usage_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "usage_select_org" ON usage_records;
CREATE POLICY "usage_select_org" ON usage_records FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "usage_insert_org" ON usage_records;
CREATE POLICY "usage_insert_org" ON usage_records FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "usage_update_org" ON usage_records;
CREATE POLICY "usage_update_org" ON usage_records FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));

-- ============================================================
-- SUPPORT TICKETS
-- ============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text,
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ticket_org ON support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON support_tickets(status);

DO $$ BEGIN
  CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "ticket_select_org" ON support_tickets;
CREATE POLICY "ticket_select_org" ON support_tickets FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "ticket_insert_org" ON support_tickets;
CREATE POLICY "ticket_insert_org" ON support_tickets FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "ticket_update_org" ON support_tickets;
CREATE POLICY "ticket_update_org" ON support_tickets FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
