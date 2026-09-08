import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.VITE_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

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

        console.log(`Inserting booking for org: ${orgId}, customer: ${customerId}, service: ${service?.id}, start: ${start.toISOString()}`);

        const { data: createdBookingData, error: bookErr } = await supabase.from("bookings").insert({
          organization_id: orgId,
          customer_id: customerId,
          service_id: service?.id || null,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: "pending",
          source: "ai_chat",
          price: price,
        }).select().single();

        if (bookErr) {
          console.error("Booking DB insert error:", bookErr);
          dbResult = "Failed: " + bookErr.message;
        } else {
          console.log("Successfully created booking in DB:", createdBookingData?.id);
          dbResult = "Success! Booking created with ID " + createdBookingData?.id;
        }
      } catch (err) {
        console.error("book_appointment exception:", err);
        dbResult = "Failed: " + err.message;
      }
      
      if (dbResult.includes("Success")) {
        return `Hello ${args.customer_name || 'there'}! I have successfully booked your appointment for ${args.service_name || 'service'} on ${args.date || 'the requested date'} at ${args.time || '10:00 AM'}. A confirmation has been recorded.`;
      } else {
        return `Thank you for reaching out! I tried to book your appointment, but encountered an issue: ${dbResult}`;
      }
    }
  }
  return result.response.text();
}

async function pollGmail() {
  console.log("Checking for new emails...");
  const { data: allOrgs } = await supabase.from("organizations").select("*, services(*)");
  const connectedOrgs = (allOrgs || []).filter(o => o.channel_config?.google_refresh_token);

  for (const org of connectedOrgs) {
    try {
      const oauth2ClientForOrg = new google.auth.OAuth2(process.env.VITE_GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2ClientForOrg.setCredentials({ refresh_token: org.channel_config.google_refresh_token });
      
      const gmail = google.gmail({ version: 'v1', auth: oauth2ClientForOrg });
      const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
      
      if (res.data.messages && res.data.messages.length > 0) {
        for (const msg of res.data.messages) {
          const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
          
          let sender = '';
          const headers = msgData.data.payload.headers;
          for(const header of headers) {
            if(header.name === 'From') sender = header.value;
          }
          
          let body = '';
          if (msgData.data.payload.parts) {
            const part = msgData.data.payload.parts.find(p => p.mimeType === 'text/plain');
            if (part && part.body.data) body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (msgData.data.payload.body?.data) {
            body = Buffer.from(msgData.data.payload.body.data, 'base64').toString('utf-8');
          }

          console.log(`Received unread email from ${sender}: ${body.substring(0, 50)}...`);
          
          const orgEmail = org.channel_config.email_address || "";
          if(sender && !sender.includes(orgEmail)) {
             const aiReply = await generateAIResponse(org, org.services, body, org.id);
             console.log("AI Reply:", aiReply);
             
             const rawMessage = Buffer.from(
                `To: ${sender}\r\n` +
                `Subject: Re: Your Inquiry\r\n\r\n` +
                aiReply
             ).toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
             
             await gmail.users.messages.send({
               userId: 'me',
               requestBody: { raw: rawMessage, threadId: msgData.data.threadId }
             });
             console.log("Reply sent!");
          }
          
          await gmail.users.messages.modify({
            userId: 'me',
            id: msg.id,
            requestBody: { removeLabelIds: ['UNREAD'] }
          });
        }
      }
    } catch (err) {
      console.error(`Failed syncing for org ${org.id}:`, err.message);
    }
  }
}

setInterval(pollGmail, 15000);
setTimeout(pollGmail, 1000);

app.listen(3001, () => {
  console.log('Backend server running on http://localhost:3001');
});
