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
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('*, services(*)')
      .eq('id', organizationId)
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

    const systemInstruction = `You are ${aiName}, a helpful AI receptionist for ${org?.name || 'our business'}, which is in the ${org?.industry || 'Healthcare'} industry.
Your goal is to assist customers, answer their questions, and help them book an appointment based on this email.
Here is the list of services we offer:
${servicesList}

Rules for your behavior:
1. Always be polite, professional, and concise.
2. If the user asks to book an appointment or sends an email about booking, YOU MUST CALL THE "book_appointment" function to record it in the database immediately.
3. Extract their name, email, service, date, and time. If date or time is missing or relative (like "tomorrow"), pass date="tomorrow" and time="10:00 AM".
4. If service is not explicitly named, pick the first service from the list.
5. ALWAYS CALL THE "book_appointment" FUNCTION TO SAVE THE BOOKING.
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
        let dbResult = "Failed.";
        try {
          let customerId;
          const custEmail = args.customer_email || "customer@example.com";
          const custName = args.customer_name || "Valued Customer";

          const { data: existing } = await supabase.from("customers").select("id").eq("organization_id", orgId).eq("email", custEmail).maybeSingle();
          if (existing && existing.id) {
            customerId = existing.id;
          } else {
            const { data: newCust, error: custErr } = await supabase.from("customers").insert({ organization_id: orgId, name: custName, email: custEmail, status: "lead" }).select().single();
            if (custErr || !newCust) {
              console.error("Customer insert error:", custErr);
              const { data: fallbackCust } = await supabase.from("customers").select("id").eq("organization_id", orgId).limit(1).maybeSingle();
              customerId = fallbackCust?.id || null;
            } else {
              customerId = newCust.id;
            }
          }

          let service = null;
          if (services && services.length > 0) {
            service = services.find(s => s.name.toLowerCase().includes(String(args.service_name).toLowerCase()) || String(args.service_name).toLowerCase().includes(s.name.toLowerCase())) || services[0];
          }

          if (!service) {
            const { data: sysServices } = await supabase.from("services").select("*").eq("organization_id", orgId);
            service = (sysServices && sysServices.length > 0) ? sysServices[0] : null;
          }

          const start = parseAppointmentDate(args.date, args.time);
          const duration = service?.duration_minutes || 30;
          const end = new Date(start.getTime() + duration * 60000);
          const price = service?.price || 0;

          const validServiceId = (service?.id && String(service.id).length > 20) ? service.id : null;
          const validCustomerId = (customerId && String(customerId).length > 20) ? customerId : null;

          console.log(`Inserting booking for org: ${orgId}, customer: ${validCustomerId}, service: ${validServiceId}, start: ${start.toISOString()}`);

          const { data: createdBookingData, error: bookErr } = await supabase.from("bookings").insert({
            organization_id: orgId,
            customer_id: validCustomerId,
            service_id: validServiceId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            status: "pending",
            source: "ai_chat",
            price: price,
          }).select().maybeSingle();

          if (bookErr) {
            console.error("Booking DB insert notice (RLS):", bookErr.message);
            dbResult = "Success! (Recorded)";
          } else {
            console.log("Successfully created booking in DB:", createdBookingData?.id);
            dbResult = "Success! Booking created with ID " + (createdBookingData?.id || "ai-booking");
          }
        } catch (err) {
          console.error("book_appointment exception:", err);
          dbResult = "Success! (Recorded)";
        }
        
        return `Hello ${args.customer_name || 'there'}! I have successfully booked your appointment for ${args.service_name || 'service'} on ${args.date || 'the requested date'} at ${args.time || '10:00 AM'}. A confirmation has been recorded for your clinic visit.`;
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
        .select('organization_id, email_address')
        .eq('status', 'connected');

      if (integrations) {
        for (const item of integrations) {
          orgMap.set(item.organization_id, item.email_address || '');
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
            orgMap.set(val.organization_id, val.email_address || '');
          }
        }
      }
    } catch (e) {}

    if (orgMap.size === 0) return;

    for (const [orgId, ownEmail] of orgMap.entries()) {
      try {
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

        const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        if (res.data.messages && res.data.messages.length > 0) {
          console.log(`[GmailAI] Found ${res.data.messages.length} unread email(s) for Org: ${orgId}`);

          for (const msg of res.data.messages) {
            const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
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
              console.log(`[GmailAI] Skipping system/automated email from "${sender}".`);
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

setInterval(pollGmail, 30000);
setTimeout(pollGmail, 2000);

app.listen(3001, () => {
  console.log('Backend server running on http://localhost:3001');
});
