/*
# Multi-Channel AI Webhook Support

1. Purpose
- Adds channel_config jsonb column to organizations for storing Twilio phone numbers,
  SendGrid/Mailgun email config, and other per-channel routing settings.
- Adds SECURITY DEFINER function `upsert_webhook_conversation` that webhooks can call
  with the service-role key to find-or-create a conversation + customer by phone/email,
  insert the incoming message, and return the conversation row with message history.
- Adds anon-callable SECURITY DEFINER function `get_org_by_phone` so edge functions
  can resolve which organization owns an incoming Twilio number without RLS blocking.

2. Modified Tables
- `organizations` — new column `channel_config` (jsonb, default '{}')

3. New Functions
- `upsert_webhook_conversation(p_org_id, p_channel, p_customer_phone, p_customer_email, p_message_text, p_metadata)`
    → finds or creates customer + conversation, inserts the incoming message,
      returns JSON with conversation_id and prior chat history (sender_type + content).
- `get_org_by_phone(p_phone)`
    → looks up org by matching phone number in channel_config jsonb fields
      (twilio_sms_number, twilio_whatsapp_number, twilio_voice_number).
      Returns org row or NULL.

4. Security
- Both functions are SECURITY DEFINER (run with elevated privileges) so edge functions
  using the service-role key can write conversation data across org boundaries.
- These functions are callable by the `anon` and `authenticated` roles since webhooks
  arrive without a user session — the edge function itself provides auth via the
  service role key and Twilio signature validation.
*/

-- Add channel_config column to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS channel_config jsonb DEFAULT '{}'::jsonb;

-- ============================================================
-- get_org_by_phone: Resolve organization from a Twilio phone number
-- ============================================================
CREATE OR REPLACE FUNCTION get_org_by_phone(p_phone text)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result organizations%ROWTYPE;
  normalized text;
BEGIN
  -- Normalize: strip whitespace, dashes, parentheses, leading +
  normalized := regexp_replace(
    regexp_replace(COALESCE(p_phone, ''), '[\s\-\(\)]', '', 'g'),
    '^\+', '', ''
  );

  SELECT * INTO result
  FROM organizations
  WHERE
    channel_config->>'twilio_sms_number' IS NOT NULL
      AND regexp_replace(regexp_replace(channel_config->>'twilio_sms_number', '[\s\-\(\)]', '', 'g'), '^\+', '', '') = normalized
    OR
    channel_config->>'twilio_whatsapp_number' IS NOT NULL
      AND regexp_replace(regexp_replace(channel_config->>'twilio_whatsapp_number', '[\s\-\(\)]', '', 'g'), '^\+', '', '') = normalized
    OR
    channel_config->>'twilio_voice_number' IS NOT NULL
      AND regexp_replace(regexp_replace(channel_config->>'twilio_voice_number', '[\s\-\(\)]', '', 'g'), '^\+', '', '') = normalized
  LIMIT 1;

  RETURN result;
END;
$$;

-- Allow anon (webhook callers) to invoke these lookup functions
GRANT EXECUTE ON FUNCTION get_org_by_phone(text) TO anon, authenticated;

-- ============================================================
-- upsert_webhook_conversation: Find-or-create customer + conversation, log message
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_webhook_conversation(
  p_org_id uuid,
  p_channel text,
  p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_message_text text DEFAULT '',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_conversation_id uuid;
  v_history jsonb;
BEGIN
  -- 1. Find or create customer
  IF p_customer_email IS NOT NULL AND p_customer_email != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE organization_id = p_org_id AND email = p_customer_email
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE organization_id = p_org_id AND phone = p_customer_phone
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (organization_id, name, email, phone, status)
    VALUES (p_org_id, COALESCE(p_customer_phone, p_customer_email, 'Unknown'), p_customer_email, p_customer_phone, 'lead')
    RETURNING id INTO v_customer_id;
  END IF;

  -- 2. Find or create conversation (match by org + customer + channel, open status)
  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE organization_id = p_org_id
    AND customer_id = v_customer_id
    AND channel = p_channel
    AND status IN ('open', 'ai_active')
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (organization_id, customer_id, channel, status, owned_by, last_message, last_message_at)
    VALUES (p_org_id, v_customer_id, p_channel, 'ai_active', 'ai', p_message_text, now())
    RETURNING id INTO v_conversation_id;
  ELSE
    UPDATE conversations
    SET last_message = p_message_text, last_message_at = now(), updated_at = now()
    WHERE id = v_conversation_id;
  END IF;

  -- 3. Insert incoming customer message
  INSERT INTO conversation_messages (conversation_id, sender_type, content, metadata)
  VALUES (v_conversation_id, 'customer', p_message_text, p_metadata);

  -- 4. Fetch prior history (exclude the message we just inserted)
  SELECT jsonb_agg(
    jsonb_build_object(
      'sender', CASE WHEN cm.sender_type = 'ai' THEN 'ai' ELSE 'customer' END,
      'text', cm.content
    ) ORDER BY cm.created_at ASC
  ) INTO v_history
  FROM conversation_messages cm
  WHERE cm.conversation_id = v_conversation_id
    AND cm.id != (SELECT id FROM conversation_messages WHERE conversation_id = v_conversation_id ORDER BY created_at DESC LIMIT 1);

  IF v_history IS NULL THEN
    v_history := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'customer_id', v_customer_id,
    'history', v_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_webhook_conversation(uuid, text, text, text, text, jsonb) TO anon, authenticated;
