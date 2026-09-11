import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { EmailIntegrationService } from './src/services/email/EmailIntegrationService.mjs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom multipart/form-data parser middleware for SendGrid & inbound webhooks
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  let rawData = [];
  req.on('data', (chunk) => rawData.push(chunk));
  req.on('end', () => {
    try {
      const buffer = Buffer.concat(rawData);
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;

      if (!boundary) {
        return next();
      }

      const str = buffer.toString('utf8');
      const parts = str.split(`--${boundary}`);
      const body = req.body || {};

      for (const part of parts) {
        if (!part || part.trim() === '' || part.trim() === '--') continue;
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headers = part.substring(0, headerEnd);
        let content = part.substring(headerEnd + 4);
        if (content.endsWith('\r\n')) {
          content = content.slice(0, -2);
        }

        const nameMatch = headers.match(/name="([^"]+)"/i);
        if (nameMatch) {
          const fieldName = nameMatch[1];
          body[fieldName] = content;
        }
      }

      req.body = body;
      next();
    } catch (e) {
      console.warn('[Multipart Parser Warning]:', e.message);
      next();
    }
  });
});

async function handleIncomingSmsOrWhatsapp(req, res) {
  try {
    const body = req.body || {};
    const fromNumber = body.From || body.from || body.customerPhone || '';
    const toNumber = body.To || body.to || '+919824908176';
    const incomingMessage = body.Body || body.body || body.message || '';
    let organizationId = body.organizationId || body.organization_id;

    const isWhatsApp = fromNumber.toLowerCase().startsWith('whatsapp:') || toNumber.toLowerCase().startsWith('whatsapp:') || req.path.includes('whatsapp');
    const channel = isWhatsApp ? 'whatsapp' : 'sms';
    const cleanToNumber = toNumber.replace(/^whatsapp:/i, '');

    console.log(`[Incoming ${channel.toUpperCase()} API] From: "${fromNumber}", To: "${toNumber}", Body: "${incomingMessage}"`);

    if (!incomingMessage) {
      if (req.headers['content-type']?.includes('x-www-form-urlencoded') || req.headers['user-agent']?.includes('Twilio')) {
        res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>No message body received.</Message></Response>');
        return;
      }
      return res.status(400).json({ error: 'Message body is required.' });
    }

    // 1. Resolve Organization by To phone or organizationId
    let org = null;
    if (cleanToNumber) {
      try {
        const { data } = await supabase.rpc('get_org_by_phone', { p_phone: cleanToNumber }).maybeSingle();
        org = data;
      } catch (e) {}
    }

    if (!org && organizationId) {
      const { data } = await supabase.from('organizations').select('*, services(*)').eq('id', organizationId).maybeSingle();
      org = data;
    }

    if (!org) {
      const { data } = await supabase.from('organizations').select('*, services(*)').limit(1).maybeSingle();
      org = data || {
        id: 'e044fe30-ca76-4b28-a45c-453ba2086a88',
        name: "Deep Dental's Clinic",
        industry: "Healthcare"
      };
    }

    const orgId = org.id;

    // 2. Fetch Services from DB
    const { data: dbServices } = await supabase.from('services').select('*').eq('organization_id', orgId).eq('is_active', true);
    const services = (dbServices && dbServices.length > 0) ? dbServices : (org.services || []);

    // 3. Upsert conversation in Supabase
    let conversationHistory = [];
    const cleanCustomerPhone = fromNumber.replace(/^whatsapp:/i, '').replace(/^\+/, '');
    if (cleanCustomerPhone) {
      try {
        const { data: convData } = await supabase.rpc('upsert_webhook_conversation', {
          p_org_id: orgId,
          p_channel: channel,
          p_customer_phone: cleanCustomerPhone,
          p_customer_email: null,
          p_message_text: incomingMessage,
          p_metadata: { from: fromNumber, to: toNumber, twilio_message_sid: body.MessageSid || '' }
        });
        if (convData?.history) {
          conversationHistory = convData.history;
        }
      } catch (e) {}
    }

    // 4. Generate AI Response
    const fullPrompt = fromNumber ? `[Customer ${channel.toUpperCase()} Mobile: ${fromNumber}]\n${incomingMessage}` : incomingMessage;
    const aiReply = await generateAIResponse(org, services, fullPrompt, orgId, conversationHistory);

    // 5. Fetch latest booking created for this customer (if any created in the last 45s)
    let createdBooking = null;
    const { data: customerRecord } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (customerRecord) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('*, service:services(*)')
        .eq('customer_id', customerRecord.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (booking && (Date.now() - new Date(booking.created_at).getTime() < 45000)) {
        createdBooking = booking;
      }
    }

    // 6. Return TwiML or JSON depending on request type
    const isTwilioRequest = (req.headers['content-type']?.includes('x-www-form-urlencoded') || req.headers['user-agent']?.includes('Twilio') || body.MessageSid);
    if (isTwilioRequest) {
      const escaped = aiReply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`);
    } else {
      res.json({
        success: true,
        channel,
        aiReply,
        booking: createdBooking
      });
    }
  } catch (err) {
    console.error('Incoming SMS/WhatsApp API error:', err);
    if (req.headers['content-type']?.includes('x-www-form-urlencoded') || req.headers['user-agent']?.includes('Twilio')) {
      res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong processing your request.</Message></Response>');
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}

app.post('/api/incoming-sms', handleIncomingSmsOrWhatsapp);
app.post('/api/webhooks/twilio/sms', handleIncomingSmsOrWhatsapp);
app.post('/api/incoming-whatsapp', handleIncomingSmsOrWhatsapp);
app.post('/api/webhooks/twilio/whatsapp', handleIncomingSmsOrWhatsapp);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/email/gmail/callback'
);

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

const emailIntegrationService = new EmailIntegrationService(supabase);

async function resolveOrganizationContext(req) {
  const authHeader = req.headers.authorization;
  let userId = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      userId = user.id;
    }
  }

  let requestedOrgId = req.query?.organization_id || req.headers['x-organization-id'] || req.body?.organization_id;

  if (userId) {
    const { data: member } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (requestedOrgId && member && member.organization_id !== requestedOrgId) {
      throw new Error('Unauthorized organization access.');
    }
    return { organizationId: requestedOrgId || member?.organization_id, userId };
  }

  if (requestedOrgId) {
    return { organizationId: requestedOrgId, userId: null };
  }

  const { data: firstOrg } = await supabase.from('organizations').select('id').limit(1).maybeSingle();
  return { organizationId: firstOrg?.id, userId: null };
}

// -------------------------------------------------------------
// EMAIL INTEGRATION API ENDPOINTS
// -------------------------------------------------------------

// GET /api/integrations/email - Returns safe status
app.get('/api/integrations/email', async (req, res) => {
  try {
    const { organizationId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    const status = await emailIntegrationService.getStatus(organizationId, 'gmail');
    res.json(status);
  } catch (err) {
    console.error('API /api/integrations/email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/email/gmail/connect - Returns authorization URL & state
app.get('/api/integrations/email/gmail/connect', async (req, res) => {
  try {
    const { organizationId, userId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    const result = await emailIntegrationService.initiateConnect(organizationId, userId);
    res.json(result);
  } catch (err) {
    console.error('API /api/integrations/email/gmail/connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/email/gmail/callback - OAuth Callback from Google
app.get('/api/integrations/email/gmail/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    console.warn('[OAuth Callback] Google returned error:', oauthError);
    return res.redirect(`http://localhost:5173/app?error=oauth_denied&message=${encodeURIComponent(oauthError)}`);
  }

  try {
    const result = await emailIntegrationService.handleCallback(code, state);
    res.redirect(`http://localhost:5173/app?email_connected=true&email=${encodeURIComponent(result.email_address)}`);
  } catch (err) {
    console.error('[OAuth Callback] Error handling callback:', err.message);
    res.redirect(`http://localhost:5173/app?error=oauth_failed&message=${encodeURIComponent(err.message)}`);
  }
});

// DELETE /api/integrations/email/gmail - Disconnect Gmail connection
app.delete('/api/integrations/email/gmail', async (req, res) => {
  try {
    const { organizationId, userId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    const result = await emailIntegrationService.disconnect(organizationId, userId, 'gmail');
    res.json(result);
  } catch (err) {
    console.error('API DELETE /api/integrations/email/gmail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/email/gmail/refresh - Refresh access token
app.post('/api/integrations/email/gmail/refresh', async (req, res) => {
  try {
    const { organizationId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    await emailIntegrationService.getValidAccessToken(organizationId, 'gmail');
    res.json({ success: true, message: 'Access token refreshed successfully.' });
  } catch (err) {
    console.error('API POST /api/integrations/email/gmail/refresh error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/integrations/email/gmail/sync - Sync mailbox metadata
app.post('/api/integrations/email/gmail/sync', async (req, res) => {
  try {
    const { organizationId, userId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    const result = await emailIntegrationService.syncMailbox(organizationId, userId, 'gmail');
    res.json(result);
  } catch (err) {
    console.error('API POST /api/integrations/email/gmail/sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

let globalLatestVerification = null;

// GET /api/integrations/email/verification-code - Fetch latest Gmail verification status & code
app.get('/api/integrations/email/verification-code', async (req, res) => {
  try {
    const { organizationId } = await resolveOrganizationContext(req);
    let verification = null;

    if (organizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('channel_config')
        .eq('id', organizationId)
        .maybeSingle();
      verification = org?.channel_config?.gmail_verification || null;
    }

    // Fallback 1: in-memory cache from latest webhook
    if (!verification && globalLatestVerification) {
      verification = globalLatestVerification;
    }

    // Fallback 2: scan all orgs for most recently received verification (survives server restarts)
    if (!verification) {
      const { data: allOrgs } = await supabase
        .from('organizations')
        .select('id, channel_config')
        .not('channel_config', 'is', null);

      if (allOrgs?.length) {
        let latest = null;
        for (const org of allOrgs) {
          const v = org.channel_config?.gmail_verification;
          if (v?.received_at) {
            if (!latest || new Date(v.received_at) > new Date(latest.received_at)) {
              latest = v;
            }
          }
        }
        if (latest) verification = latest;
      }
    }

    res.json({
      success: true,
      verification
    });
  } catch (err) {
    console.error('API GET /api/integrations/email/verification-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/email/simulate-verification - Simulate receiving a Gmail verification email
app.post('/api/integrations/email/simulate-verification', async (req, res) => {
  try {
    const { organizationId } = await resolveOrganizationContext(req);
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required.' });
    }
    const mockCode = Math.floor(100000000 + Math.random() * 900000000).toString();
    const verification = {
      code: mockCode,
      link: `https://mail-settings.google.com/mail/vf-simulated-${mockCode}`,
      autoConfirmed: true,
      received_at: new Date().toISOString(),
      sender: 'forwarding-noreply@google.com',
      simulated: true
    };
    
    const { data: org } = await supabase.from('organizations').select('channel_config').eq('id', organizationId).single();
    const channelConfig = org?.channel_config || {};
    channelConfig.gmail_verification = verification;

    await supabase.from('organizations').update({ channel_config: channelConfig }).eq('id', organizationId);

    res.json({
      success: true,
      message: 'Simulated Gmail verification email received successfully!',
      verification
    });
  } catch (err) {
    console.error('API POST /api/integrations/email/simulate-verification error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/exchange-google-token', async (req, res) => {
  const { code, organizationId } = req.body;
  console.log(`Received code exchange request for org: ${organizationId}`);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("Tokens received from Google");
    
    // Save to database
    const { data: org, error: fetchErr } = await supabase.from('organizations').select('channel_config, settings').eq('id', organizationId).single();
    if (fetchErr) throw fetchErr;

    if (org) {
      const channelConfig = org.channel_config || {};
      if (tokens.refresh_token) channelConfig.google_refresh_token = tokens.refresh_token;
      channelConfig.google_access_token = tokens.access_token;
      
      const newList = [...(org.settings?.integrations || []), 'email'];
      
      const { error: updateErr } = await supabase.from('organizations').update({
        settings: { ...(org.settings || {}), integrations: Array.from(new Set(newList)) },
        channel_config: channelConfig
      }).eq('id', organizationId);
      
      if (updateErr) throw updateErr;
      console.log("Saved tokens to database");
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: err.message });
  }
});

const bookAppointmentDeclaration = {
  name: "book_appointment",
  description: "Books an appointment for the customer and saves their details to the database.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      customer_name: { type: SchemaType.STRING, description: "Full name of the customer" },
      customer_email: { type: SchemaType.STRING, description: "Email address of the customer" },
      service_name: { type: SchemaType.STRING, description: "Name of the service the customer wants to book" },
      date: { type: SchemaType.STRING, description: "Date of the booking (e.g. tomorrow, 2024-12-01)" },
      time: { type: SchemaType.STRING, description: "Time of the booking (e.g. 9:30 AM)" },
    },
    required: ["customer_name", "customer_email", "service_name", "date", "time"],
  },
};

function parseAppointmentDate(dateStr, timeStr) {
  let now = new Date();
  let targetDate = new Date();
  
  if (!dateStr || dateStr.toLowerCase().includes("today")) {
    targetDate = new Date();
  } else if (dateStr.toLowerCase().includes("tomorrow")) {
    targetDate = new Date(now.setDate(now.getDate() + 1));
  } else {
    let parsed = new Date(`${dateStr} ${timeStr || ''}`);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      targetDate = d;
    } else {
      targetDate = new Date(now.setDate(now.getDate() + 1)); // Default tomorrow
    }
  }

  let hours = 10, minutes = 0;
  if (timeStr) {
    let match = String(timeStr).match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (match) {
      hours = parseInt(match[1], 10);
      if (match[2]) minutes = parseInt(match[2], 10);
      if (match[3]) {
        if (match[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
        if (match[3].toLowerCase() === 'am' && hours === 12) hours = 0;
      }
    }
  }
  targetDate.setHours(hours, minutes, 0, 0);
  return targetDate;
}

app.post('/api/connect-email', async (req, res) => {
  const { organizationId, email } = req.body;
  try {
    const { data: org, error: fetchErr } = await supabase
      .from('organizations')
      .select('channel_config, settings')
      .eq('id', organizationId)
      .single();

    if (fetchErr) throw fetchErr;

    if (org) {
      const channelConfig = org.channel_config || {};
      channelConfig.email_address = email || 'reception@clinic.com';
      channelConfig.connected_at = new Date().toISOString();

      const newList = Array.from(new Set([...(org.settings?.integrations || []), 'email']));

      const { error: updateErr } = await supabase
        .from('organizations')
        .update({
          settings: { ...(org.settings || {}), integrations: newList },
          channel_config: channelConfig
        })
        .eq('id', organizationId);

      if (updateErr) throw updateErr;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Connect email error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incoming-email', async (req, res) => {
  const { organizationId, from, fromName, subject, body } = req.body;
  console.log(`[Incoming Email API] Org: ${organizationId}, From: ${from}, Body: ${body}`);

  try {
    let targetOrgId = organizationId;
    if (!targetOrgId) {
      const { data: firstOrg } = await supabase.from('organizations').select('id').limit(1).single();
      targetOrgId = firstOrg?.id;
    }

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('*, services(*)')
      .eq('id', targetOrgId)
      .single();

    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const services = org.services || [];
    const fullMessage = `From: ${fromName || from} <${from}>\nSubject: ${subject || 'Appointment Request'}\n\n${body}`;
    
    const aiReply = await generateAIResponse(org, services, fullMessage, org.id);

    const { data: latestCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', org.id)
      .eq('email', from)
      .maybeSingle();

    let createdBooking = null;
    if (latestCustomer) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('*, service:services(*)')
        .eq('customer_id', latestCustomer.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      createdBooking = booking;
    }

    res.json({
      success: true,
      aiReply,
      booking: createdBooking
    });
  } catch (err) {
    console.error('Error processing incoming email:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generic & Resend / SendGrid Inbound Parse Webhook Route
app.post(['/api/webhook/email', '/api/webhcok/email'], async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[Inbound Email Webhook] Raw payload keys:', Object.keys(payload));

    // Support SendGrid envelope JSON: {"to":["inbound@domain.com"],"from":"forwarding-noreply@google.com"}
    let envelopeTo = '';
    let envelopeFrom = '';
    if (payload.envelope) {
      try {
        const parsedEnvelope = typeof payload.envelope === 'string' ? JSON.parse(payload.envelope) : payload.envelope;
        envelopeTo = Array.isArray(parsedEnvelope.to) ? parsedEnvelope.to[0] : (parsedEnvelope.to || '');
        envelopeFrom = parsedEnvelope.from || '';
      } catch (e) {}
    }

    // ── Parse payload (supports Resend, SendGrid, Postmark, ImprovMX, raw POST) ──
    const sender    = payload.from       || payload.data?.from    || payload.sender   || payload.From     || envelopeFrom || 'customer@example.com';
    const recipient = payload.to         || payload.data?.to      || payload.recipient|| payload.To       || envelopeTo   || '';
    const subject   = payload.subject    || payload.data?.subject || payload.Subject  || 'Customer Inquiry';
    const textBody  = payload.body       || payload.text          || payload.data?.text
                   || payload.plain      || payload['body-plain'] || payload.html
                   || payload['body-html']|| '';

    // Extract sender name if present e.g. "John Doe <john@example.com>"
    const senderNameMatch = String(sender).match(/^(.+?)\s*<(.+)>$/);
    const senderName  = senderNameMatch ? senderNameMatch[1].trim() : 'Customer';
    const senderEmail = senderNameMatch ? senderNameMatch[2].trim() : String(sender).trim();

    // ── Resolve Organization ──
    let orgId = payload.organizationId || payload.organization_id;

    if (!orgId && recipient) {
      // 1. Match org-<id>@ pattern from unique AI address
      const match = String(recipient).match(/org-([a-zA-Z0-9-]+)@/);
      if (match) orgId = match[1];

      // 2. Match shortId prefix from inbound address e.g. deepclinic-30f3bf@inbound... -> 30f3bf
      const shortMatch = String(recipient).match(/-([a-f0-9]{6,8})@/);
      if (!orgId && shortMatch) {
        const { data: matchedOrgs } = await supabase.from('organizations').select('id').ilike('id', `${shortMatch[1]}%`).limit(1);
        if (matchedOrgs && matchedOrgs.length > 0) {
          orgId = matchedOrgs[0].id;
        }
      }

      // 3. Match channel_config email_address or forwarding_address in DB
      if (!orgId) {
        const { data: allOrgs } = await supabase.from('organizations').select('id, channel_config');
        if (allOrgs) {
          for (const o of allOrgs) {
            const cc = o.channel_config || {};
            if (cc.email_address && String(recipient).toLowerCase().includes(cc.email_address.toLowerCase())) {
              orgId = o.id;
              break;
            }
            if (cc.forwarding_address && String(recipient).toLowerCase().includes(cc.forwarding_address.toLowerCase())) {
              orgId = o.id;
              break;
            }
          }
        }
      }
    }

    // 4. Default: Use the latest created organization (Deep Clinic) instead of the oldest
    if (!orgId) {
      const { data: latestOrg } = await supabase.from('organizations').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
      orgId = latestOrg?.id;
    }

    console.log(`[Inbound Webhook] From: ${senderEmail}, Recipient: "${recipient}", Subject: "${subject}", OrgID: ${orgId}`);

    // ── Check if this is a Gmail Forwarding Verification Email ──
    const isGmailVerification = 
      subject.includes('Gmail Forwarding Confirmation') ||
      textBody.includes('has requested to automatically forward mail to your email address') ||
      textBody.includes('Confirmation code:') ||
      senderEmail.includes('forwarding-noreply@google.com') ||
      textBody.includes('google.com/mail/vf-');

    if (isGmailVerification) {
      console.log('----------------------------------------------------');
      console.log('📩 [GMAIL VERIFICATION EMAIL RECEIVED]');
      
      const codeMatch = 
        textBody.match(/Confirmation code:\s*(\d{7,10})/i) ||
        textBody.match(/Confirmation Code\s*-\s*(\d{7,10})/i) ||
        subject.match(/Confirmation Code\s*-\s*(\d{7,10})/i) ||
        textBody.match(/code:\s*(\d{7,10})/i) ||
        textBody.match(/\b(\d{8,10})\b/);

      const linkMatch = 
        textBody.match(/(https:\/\/[^\s<">]+google\.com[^\s<">]*vf-[^\s<">]+)/i) ||
        textBody.match(/(https:\/\/[^\s<">]+google\.com[^\s<">]*mail[^\s<">]*)/i);
      
      const code = codeMatch ? codeMatch[1] : null;
      const link = linkMatch ? linkMatch[1] : null;
      let autoConfirmed = false;

      if (code) {
        console.log(`🔑 [GMAIL CONFIRMATION CODE]: ${code}`);
      }
      
      if (link) {
        console.log(`🔗 [GMAIL VERIFICATION LINK CAPTURED]: ${link}`);
      }
      console.log('----------------------------------------------------');

      // Persist verification status & code into Supabase organization channel_config
      const verificationRecord = {
        code,
        link,
        autoConfirmed,
        received_at: new Date().toISOString(),
        forwarding_address: recipient,
        sender: senderEmail
      };
      globalLatestVerification = verificationRecord;

      try {
        const targetOrgId = orgId || (await supabase.from('organizations').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle())?.data?.id;
        if (targetOrgId) {
          const { data: orgData } = await supabase.from('organizations').select('channel_config').eq('id', targetOrgId).maybeSingle();
          const existingConfig = orgData?.channel_config || {};
          existingConfig.gmail_verification = verificationRecord;
          await supabase.from('organizations').update({ channel_config: existingConfig }).eq('id', targetOrgId);
          console.log(`Saved Gmail verification code ${code} to Org ID ${targetOrgId}`);
        }
      } catch (dbErr) {
        console.warn('Warning saving verification code to DB:', dbErr.message);
      }

      return res.json({
        success: true,
        type: 'gmail_verification',
        code,
        autoConfirmed,
        verification: verificationRecord
      });
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('*, services(*)')
      .eq('id', orgId)
      .single();

    if (!org) {
      return res.status(404).json({ error: 'Organization not found.' });
    }

    // ── Generate AI reply ──
    const fullMessage = `[Incoming Email]\nFrom: ${senderName} <${senderEmail}>\nSubject: ${subject}\n\n${textBody}`;
    const aiReply = await generateAIResponse(org, org.services || [], fullMessage, org.id);

    console.log(`[Inbound Webhook] AI Reply for ${senderEmail}: ${aiReply.substring(0, 100)}...`);

    // ── Send reply via Resend (if API key configured) ──
    let emailSent = false;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey && resendApiKey.startsWith('re_')) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(resendApiKey);
        const fromAddress = process.env.RESEND_FROM_EMAIL || `${org.name || 'AI Reception'} <onboarding@resend.dev>`;

        const replyToAddress = recipient || 'deeppatel8176@gmail.com';
        console.log(`[Resend] Sending reply to ${senderEmail} with replyTo: ${replyToAddress}`);

        const { data: emailData, error: emailError } = await resend.emails.send({
          from: fromAddress,
          to: [senderEmail],
          replyTo: replyToAddress,
          subject: `Re: ${subject.replace(/^Re:\s*/i, '')}`,
          text: aiReply,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
            <p>${aiReply.replace(/\n/g, '<br>')}</p>
            <hr style="margin-top:30px;border:none;border-top:1px solid #eee"/>
            <p style="color:#999;font-size:12px">Powered by AI Reception • ${org.name || 'Our Clinic'}</p>
          </div>`
        });

        if (emailError) {
          console.warn('[Resend] Send error:', emailError);
          // If Resend is in free testing mode and blocks sending to third-party recipients
          if (emailError.statusCode === 403 || emailError.message?.includes('testing emails')) {
            const testEmail = process.env.TEST_EMAIL_RECIPIENT || 'pateldeep1783@gmail.com';
            console.log(`[Resend Testing Mode] Falling back to send AI reply copy to account owner (${testEmail})...`);
            const { data: fbData, error: fbErr } = await resend.emails.send({
              from: fromAddress,
              to: [testEmail],
              subject: `[AI Reply for ${senderEmail}] Re: ${subject}`,
              text: `--- AI REPLY FOR ${senderEmail} ---\n\n${aiReply}`,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px">
                <div style="background:#fef3c7;color:#92400e;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:16px">
                  <strong>⚠️ Resend Testing Mode Notice:</strong><br>
                  This AI response was created for customer <strong>${senderEmail}</strong>.<br>
                  Since Resend is currently in testing mode (unverified domain), the email was routed to your registered Resend account email (<strong>${testEmail}</strong>).
                </div>
                <p style="font-size:15px;line-height:1.6;color:#1f2937">${aiReply.replace(/\n/g, '<br>')}</p>
                <hr style="margin-top:24px;border:none;border-top:1px solid #eee"/>
                <p style="color:#9ca3af;font-size:12px">Powered by AI Receptionist • ${org.name || 'Deep Clinic'}</p>
              </div>`
            });
            if (fbErr) {
              console.warn('[Resend Fallback Error]:', fbErr);
            } else {
              console.log(`[Resend] ✅ Fallback email delivered to ${testEmail}, ID: ${fbData?.id}`);
              emailSent = true;
            }
          }
        } else {
          console.log(`[Resend] ✅ Reply sent to ${senderEmail}, ID: ${emailData?.id}`);
          emailSent = true;
        }
      } catch (resendErr) {
        console.warn('[Resend] Failed to send reply:', resendErr.message);
      }
    } else {
      console.log('[Resend] ⚠️ No RESEND_API_KEY configured — reply NOT sent. Add RESEND_API_KEY to .env');
    }

    res.json({
      success: true,
      status: 'processed',
      sender: senderEmail,
      subject,
      aiReply,
      emailSent,
    });

  } catch (err) {
    console.error('[Inbound Webhook] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

async function generateAIResponse(org, services, currentMessage, orgId, history = []) {
  if (!process.env.VITE_GEMINI_API_KEY) return "AI systems offline.";

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const servicesList = (services && services.length > 0)
      ? services.map(s => `- ${s.name} (${s.duration_minutes} mins, ${s.price > 0 ? s.price : 'Free'})`).join("\n")
      : "- General Consultation (30 mins, Free)\n- Standard Checkup (45 mins, Free)";
    const aiName = org?.settings?.ai_config?.name || "Sarah";
    const customInstructions = org?.settings?.ai_config?.instructions || "";

    const systemInstruction = `You are ${aiName}, a helpful AI receptionist for ${org?.name || 'our business'}, in the ${org?.industry || 'Healthcare'} industry.
Your goal is to assist customers, answer questions, provide available services, and help them book appointments.

Here is the list of services we offer:
${servicesList}

Behavior Rules:
1. Always be polite, professional, and helpful.
2. IF THE CUSTOMER ASKS WHAT SERVICES WE OFFER OR INQUIRES ABOUT PRICES/DETAILS:
   - Provide a clear, friendly list of available services with their prices and duration.
   - Ask them which service they would like to book and what date/time they prefer.
3. IMPORTANT FOR BOOKINGS:
   - If the customer asks to book an appointment BUT HAS NOT specified a date and time yet, DO NOT call "book_appointment". Respond by politely asking what date and time works best for them.
   - ONLY call the "book_appointment" function when the customer has provided or confirmed a specific date and time (e.g. "tomorrow at 11:00 am", "10th Sept at 2:00 PM").
4. When calling "book_appointment", pass customer_name, customer_email, service_name, date, and time.
${customInstructions ? `\nSpecial Instructions for this business:\n${customInstructions}` : ""}`.trim();

    const chatSession = model.startChat({
      history: [{ role: "user", parts: [{ text: "Hello" }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{ functionDeclarations: [bookAppointmentDeclaration] }],
    });

    const result = await chatSession.sendMessage(currentMessage);
    const functionCalls = result.response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "book_appointment") {
        const args = call.args;
        console.log("Gemini called book_appointment with args:", args);
        try {
          const custEmail = args.customer_email || "customer@example.com";
          const custName = args.customer_name || "Valued Customer";
          const phoneMatch = currentMessage.match(/\[Customer Mobile:\s*([^\]]+)\]/i);
          const custPhone = phoneMatch ? phoneMatch[1].trim() : null;

          // 1. Get or create customer using Supabase Service Role
          let customerId = null;
          let existingCust = null;

          if (custPhone) {
            const cleanPhone = custPhone.replace(/^whatsapp:/i, '').replace(/^\+/, '');
            const { data } = await supabase
              .from("customers")
              .select("id")
              .eq("organization_id", orgId)
              .or(`phone.eq.${cleanPhone},phone.eq.+${cleanPhone}`)
              .maybeSingle();
            existingCust = data;
          }

          if (!existingCust && custEmail) {
            const { data } = await supabase
              .from("customers")
              .select("id")
              .eq("organization_id", orgId)
              .eq("email", custEmail)
              .maybeSingle();
            existingCust = data;
          }

          if (existingCust && existingCust.id) {
            customerId = existingCust.id;
          } else {
            const { data: newCust, error: custErr } = await supabase
              .from("customers")
              .insert({
                organization_id: orgId,
                name: custName,
                email: custEmail,
                phone: custPhone,
                status: "lead"
              })
              .select("id")
              .maybeSingle();

            if (custErr) {
              console.error("Customer insert error:", custErr);
            }
            customerId = newCust?.id || null;
          }

          if (!customerId) {
            const { data: fallbackCust } = await supabase
              .from("customers")
              .select("id")
              .eq("organization_id", orgId)
              .limit(1)
              .maybeSingle();
            customerId = fallbackCust?.id || null;
          }

          // 2. Get real service record from DB
          let service = null;
          const { data: dbServices } = await supabase
            .from("services")
            .select("*")
            .eq("organization_id", orgId);

          if (dbServices && dbServices.length > 0) {
            if (args.service_name) {
              const nameLower = String(args.service_name).toLowerCase();
              service = dbServices.find(s => s.name.toLowerCase().includes(nameLower) || nameLower.includes(s.name.toLowerCase()));
            }
            if (!service) service = dbServices[0];
          }

          if (!service) {
            console.error("No service found in DB for org:", orgId);
            return `Hello ${custName}! Thank you for your request. Our clinic staff will contact you shortly to confirm your booking.`;
          }

          const start = parseAppointmentDate(args.date, args.time);
          const duration = service.duration_minutes || 30;
          const end = new Date(start.getTime() + duration * 60000);
          const price = service.price || 0;

          // 3. Check for existing overlapping bookings to prevent double-booking
          const { data: overlappingBookings } = await supabase
            .from("bookings")
            .select("id, start_time, end_time, status")
            .eq("organization_id", orgId)
            .in("status", ["pending", "confirmed", "rescheduled", "checked_in"])
            .lt("start_time", end.toISOString())
            .gt("end_time", start.toISOString());

          if (overlappingBookings && overlappingBookings.length > 0) {
            console.log(`[Slot Conflict] Slot ${start.toISOString()} - ${end.toISOString()} is already booked! Finding alternative slots...`);
            
            // Calculate available alternative slots on the same day
            const dateStr = start.toISOString().split('T')[0];
            const { data: dayBookings } = await supabase
              .from("bookings")
              .select("start_time, end_time")
              .eq("organization_id", orgId)
              .in("status", ["pending", "confirmed", "rescheduled", "checked_in"])
              .gte("start_time", `${dateStr}T00:00:00.000Z`)
              .lte("start_time", `${dateStr}T23:59:59.999Z`);

            const busyIntervals = (dayBookings || []).map(b => ({
              start: new Date(b.start_time).getTime(),
              end: new Date(b.end_time).getTime()
            }));

            const dayStart = new Date(start);
            dayStart.setHours(9, 0, 0, 0); // 9:00 AM
            const dayEnd = new Date(start);
            dayEnd.setHours(17, 0, 0, 0); // 5:00 PM

            const altSlots = [];
            let current = new Date(dayStart);
            const intervalMs = 30 * 60000;

            while (current.getTime() + duration * 60000 <= dayEnd.getTime()) {
              const slotStartMs = current.getTime();
              const slotEndMs = slotStartMs + duration * 60000;

              const isOverlap = busyIntervals.some(bi => slotStartMs < bi.end && slotEndMs > bi.start);

              if (!isOverlap) {
                const timeLabel = new Date(slotStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                altSlots.push(timeLabel);
                if (altSlots.length >= 3) break;
              }

              current = new Date(current.getTime() + intervalMs);
            }

            const requestedTimeStr = args.time || start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const requestedDateStr = args.date || 'the requested date';

            if (altSlots.length > 0) {
              return `Hello ${custName}! I noticed that ${requestedTimeStr} on ${requestedDateStr} is ALREADY BOOKED. Available alternative time slots for ${service.name} are: ${altSlots.join(', ')}. Please reply with your preferred time from these available options!`;
            } else {
              return `Hello ${custName}! I noticed that ${requestedTimeStr} on ${requestedDateStr} is ALREADY BOOKED, and there are no other slots left on that day. Please reply with a different date for your visit.`;
            }
          }

          console.log(`Creating booking in DB for org: ${orgId}, customer: ${customerId}, service: ${service.id}, start: ${start.toISOString()}`);

          const { data: createdBookingData, error: bookErr } = await supabase
            .from("bookings")
            .insert({
              organization_id: orgId,
              customer_id: customerId,
              service_id: service.id,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              status: "pending",
              source: "ai_chat",
              price: price,
            })
            .select()
            .maybeSingle();

          if (bookErr) {
            console.error("Booking DB insert error:", bookErr);
            return `Hello ${custName}! We received your request for ${service.name} on ${args.date || 'the requested date'} at ${args.time || '10:00 AM'}. Our team will confirm your slot shortly!`;
          }

          console.log("Successfully created booking in DB with ID:", createdBookingData?.id);
          const displayTime = args.time || start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `Hello ${custName}! I have successfully booked your appointment for ${service.name} on ${args.date || 'the requested date'} at ${displayTime}. Your appointment has been saved in our system!`;
        } catch (err) {
          console.error("book_appointment exception:", err);
          return `Hello! We received your booking request and will follow up with you shortly to confirm your appointment.`;
        }
      }
    }
    return result.response.text();
  } catch (err) {
    console.error("[generateAIResponse] Exception / Rate Limit:", err.message);
    return `Hello! Thank you for reaching out to Deep Dental's Clinic. We have received your appointment inquiry and will be happy to assist you. Please reply with your preferred date and time for your visit.`;
  }
}

async function pollGmail() {
  try {
    const orgMap = new Map();

    // 1. Fetch from email_integrations table
    try {
      const { data: integrations } = await supabase
        .from('email_integrations')
        .select('organization_id, email_address, connected_at, created_at, last_synced_at')
        .eq('status', 'connected');

      if (integrations) {
        for (const item of integrations) {
          const connAt = item.connected_at || item.created_at || item.last_synced_at || new Date().toISOString();
          orgMap.set(item.organization_id, { email_address: item.email_address || '', connected_at: connAt });
        }
      }
    } catch (e) {}

    // 2. Fetch from email_store.json
    try {
      const STORE_PATH = path.join(process.cwd(), 'email_store.json');
      if (fs.existsSync(STORE_PATH)) {
        const localData = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        for (const [key, val] of Object.entries(localData)) {
          if (val && val.organization_id && val.status === 'connected') {
            const connAt = val.connected_at || val.created_at || val.last_synced_at || new Date().toISOString();
            orgMap.set(val.organization_id, { email_address: val.email_address || '', connected_at: connAt });
          }
        }
      }
    } catch (e) {}

    if (orgMap.size === 0) return;

    for (const [orgId, info] of orgMap.entries()) {
      try {
        const ownEmail = info.email_address;
        const connectedAtStr = info.connected_at;
        const connectedAtMs = new Date(connectedAtStr).getTime();
        // Subtract 60s buffer for potential minor clock skews
        const afterSecs = Math.floor((connectedAtMs - 60000) / 1000);

        const accessToken = await emailIntegrationService.getValidAccessToken(orgId);
        
        let orgData = null;
        try {
          const { data } = await supabase.from('organizations').select('*, services(*)').eq('id', orgId).maybeSingle();
          orgData = data;
        } catch (e) {}

        const org = orgData || {
          id: orgId,
          name: "Deep Dental's Clinic",
          industry: "Healthcare",
          services: [
            { id: "s1", name: "Dental Cleaning", duration_minutes: 45, price: 50 },
            { id: "s2", name: "Standard Checkup", duration_minutes: 30, price: 0 }
          ]
        };

        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Search for unread emails after the connected_at timestamp
        const searchQuery = `is:unread after:${afterSecs}`;
        const res = await gmail.users.messages.list({ 
          userId: 'me', 
          q: searchQuery 
        });

        if (res.data.messages && res.data.messages.length > 0) {
          console.log(`[GmailAI] Found ${res.data.messages.length} unread email(s) for Org: ${orgId}`);

          for (const msg of res.data.messages) {
            const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            const internalDate = parseInt(msgData.data.internalDate, 10);

            // Filter out old emails received before Gmail connection time
            if (internalDate && internalDate < connectedAtMs) {
              console.log(`[GmailAI] Skipping old email received before connection time (${new Date(internalDate).toLocaleString()} < ${new Date(connectedAtMs).toLocaleString()}).`);
              continue;
            }

            const headers = msgData.data.payload.headers || [];

            let sender = '';
            let subject = 'Appointment Inquiry';
            for (const h of headers) {
              if (h.name.toLowerCase() === 'from') sender = h.value;
              if (h.name.toLowerCase() === 'subject') subject = h.value;
            }

            let body = '';
            if (msgData.data.payload.parts) {
              const part = msgData.data.payload.parts.find(p => p.mimeType === 'text/plain');
              if (part && part.body?.data) body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            } else if (msgData.data.payload.body?.data) {
              body = Buffer.from(msgData.data.payload.body.data, 'base64').toString('utf-8');
            }

            console.log(`[GmailAI] Inspecting email from "${sender}" with subject "${subject}"...`);

            const senderLower = sender.toLowerCase();
            const subjectLower = subject.toLowerCase();
            const ownEmailLower = (ownEmail || '').toLowerCase();

            const isSystemEmail = [
              'no-reply', 'noreply', 'mailer-daemon', 'google', 'pinterest',
              'github', 'adsense', 'chatgpt', 'mermaid', 'cloudinary',
              'security alert', 'delivery status', 'bounce'
            ].some(kw => senderLower.includes(kw) || subjectLower.includes(kw));

            if (isSystemEmail || (ownEmailLower && senderLower.includes(ownEmailLower))) {
              console.log(`[GmailAI] Skipping system/automated/own email from "${sender}".`);
              await gmail.users.messages.modify({
                userId: 'me',
                id: msg.id,
                requestBody: { removeLabelIds: ['UNREAD'] }
              });
              continue;
            }

            console.log(`[GmailAI] Processing genuine customer inquiry from "${sender}" with subject "${subject}"...`);

            const aiReply = await generateAIResponse(org, org.services || [], `Sender: ${sender}\nSubject: ${subject}\n\nBody: ${body}`, orgId);
            console.log(`[GmailAI] AI Reply generated: "${aiReply.substring(0, 80)}..."`);

            const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
            const rawMessage = Buffer.from(
              `To: ${sender}\r\n` +
              `Subject: ${replySubject}\r\n` +
              `In-Reply-To: ${msgData.data.id}\r\n\r\n` +
              aiReply
            ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

            await gmail.users.messages.send({
              userId: 'me',
              requestBody: { raw: rawMessage, threadId: msgData.data.threadId }
            });

            console.log(`[GmailAI] Successfully sent AI reply email to ${sender}`);

            await gmail.users.messages.modify({
              userId: 'me',
              id: msg.id,
              requestBody: { removeLabelIds: ['UNREAD'] }
            });
          }
        }
      } catch (err) {
        console.error(`[GmailAI] Sync error for org ${orgId}:`, err.message);
      }
    }
  } catch (err) {
    // Silently ignore background polling errors
  }
}

// Background auto-polling active every 15 seconds
setInterval(pollGmail, 15000);
setTimeout(pollGmail, 2000);

app.listen(3001, () => {
  console.log('Backend server running on http://localhost:3001');
});
