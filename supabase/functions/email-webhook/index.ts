import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai@0.24.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("VITE_GEMINI_API_KEY") || "";

// ── Shared AI logic (same as twilio-webhook) ─────────────────

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

async function generateAIResponse(
  history: { sender: string; text: string }[],
  org: any,
  services: any[],
  currentMessage: string,
  orgId: string,
): Promise<string> {
  if (!geminiKey) return "I'm sorry, my AI systems are currently offline. Please try again later.";

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const servicesList = services
    .map((s: any) => `- ${s.name} (${s.duration_minutes} mins, ${s.price > 0 ? s.price : 'Free'})`)
    .join("\n");

  const aiName = org.settings?.ai_config?.name || "Sarah";
  const customInstructions = org.settings?.ai_config?.instructions || "";

  const systemInstruction = `You are ${aiName}, a helpful AI receptionist for ${org.name}, which is in the ${org.industry} industry.
Your goal is to assist customers, answer their questions, and help them book an appointment.

Here is the list of services we offer:
${servicesList}

Rules for your behavior:
1. Always be polite, professional, and concise.
2. If the user asks to book an appointment, ask them which service they want, what date/time they prefer, and collect their name and email.
3. ONCE YOU HAVE THEIR NAME, EMAIL, SERVICE, DATE, AND TIME, YOU MUST CALL THE "book_appointment" function to save it. Do not just say "I have booked it", actually call the function!
4. If they ask for human assistance, politely inform them that you will transfer them.
5. Do NOT make up services that are not in the list.
${customInstructions ? `\nSpecial Instructions for this business:\n${customInstructions}` : ""}`.trim();

  const geminiHistory = history.map((msg) => ({
    role: msg.sender === "ai" ? "model" : "user",
    parts: [{ text: msg.text }],
  }));

  if (geminiHistory.length > 0 && geminiHistory[0].role === "model") {
    geminiHistory.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }

  const chatSession = model.startChat({
    history: geminiHistory,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: [{ functionDeclarations: [bookAppointmentDeclaration as any] }],
  });

  const result = await chatSession.sendMessage(currentMessage);
  const functionCalls = result.response.functionCalls();

  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];
    if (call.name === "book_appointment") {
      const args = call.args as any;
      let dbResult = "No booking callback configured.";

      try {
        let customerId: string;
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("organization_id", orgId)
          .eq("email", args.customer_email)
          .maybeSingle();

        if (existing) {
          customerId = existing.id;
        } else {
          const { data: newCust } = await supabase
            .from("customers")
            .insert({
              organization_id: orgId,
              name: args.customer_name,
              email: args.customer_email,
              status: "lead",
            })
            .select()
            .single();
          customerId = newCust.id;
        }

        const service = services.find((s: any) =>
          s.name.toLowerCase().includes(String(args.service_name).toLowerCase()) ||
          String(args.service_name).toLowerCase().includes(s.name.toLowerCase()),
        );

        if (!service) {
          dbResult = "Error: Could not match the requested service.";
        } else {
          const start = new Date(`${args.date} ${args.time}`);
          if (isNaN(start.getTime())) {
            dbResult = "Error: Invalid date/time format.";
          } else {
            const end = new Date(start.getTime() + service.duration_minutes * 60000);
            const { error: bookErr } = await supabase.from("bookings").insert({
              organization_id: orgId,
              customer_id: customerId,
              service_id: service.id,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              status: "pending",
              source: "ai_chat",
              price: service.price,
            });
            dbResult = bookErr ? "Failed: " + bookErr.message : "Success! Booking created.";
          }
        }
      } catch (err: any) {
        dbResult = "Failed: " + err.message;
      }

      try {
        const secondResult = await chatSession.sendMessage([{
          functionResponse: { name: "book_appointment", response: { result: dbResult } },
        }]);
        return secondResult.response.text();
      } catch {
        if (dbResult.toLowerCase().includes("success")) {
          return "Thank you! Your appointment has been booked. Let me know if you need anything else.";
        }
        return "I tried to book your appointment, but something went wrong. Please try again.";
      }
    }
  }

  return result.response.text();
}

// ── Email helpers ────────────────────────────────────────────

/** Strip quoted replies and signatures from email body (best-effort) */
function cleanEmailBody(text: string): string {
  if (!text) return "";
  // Remove common quoted-reply markers
  const patterns = [
    /On .* wrote:[\s\S]*$/i,
    /On .* at .* wrote:[\s\S]*$/i,
    /-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
    />[\s\S]*$/,
  ];
  let cleaned = text;
  for (const p of patterns) {
    cleaned = cleaned.replace(p, "");
  }
  return cleaned.trim();
}

/** Send reply email via Resend API (or SendGrid fallback) */
async function sendReplyEmail(
  to: string,
  from: string,
  fromName: string,
  subject: string,
  replyBody: string,
): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${from}>`,
        to,
        subject: `Re: ${subject.replace(/^Re:\s*/i, "")}`,
        text: replyBody,
      }),
    });
    return res.ok;
  }

  // Fallback: SendGrid
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY");
  if (sendgridKey) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName },
        subject: `Re: ${subject.replace(/^Re:\s*/i, "")}`,
        content: [{ type: "text/plain", value: replyBody }],
      }),
    });
    return res.ok;
  }

  console.warn("No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY)");
  return false;
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let senderEmail = "";
    let senderName = "";
    let subject = "";
    let bodyText = "";
    let recipientEmail = "";

    // ── SendGrid Inbound Parse (multipart/form-data or JSON) ──
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      senderEmail = (formData.get("from") as string) || "";
      senderName = (formData.get("fromname") as string) || "";
      subject = (formData.get("subject") as string) || "";
      bodyText = (formData.get("text") as string) || (formData.get("html") as string) || "";
      recipientEmail = (formData.get("to") as string) || "";
    } else {
      // ── Mailgun / Resend / generic JSON webhook ──
      const json = await req.json().catch(() => ({}));
      // Mailgun format
      senderEmail = json.sender || json.from || "";
      senderName = json.from || senderEmail;
      subject = json.subject || "";
      bodyText = json["body-plain"] || json["stripped-text"] || json.text || "";
      recipientEmail = json.recipient || json.to || "";
    }

    // Extract bare email from "Name <email>" format
    const emailMatch = senderEmail.match(/<([^>]+)>/) || [null, senderEmail];
    senderEmail = emailMatch[1] || senderEmail;
    const recipientMatch = recipientEmail.match(/<([^>]+)>/) || [null, recipientEmail];
    recipientEmail = recipientMatch[1] || recipientEmail;

    if (!senderEmail || !bodyText) {
      return new Response(JSON.stringify({ error: "Missing sender email or body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanedBody = cleanEmailBody(bodyText);

    // 1. Resolve organization by recipient email (stored in channel_config.email_address)
    const { data: orgs } = await supabase
      .from("organizations")
      .select("*")
      .eq("is_active", true);

    // Fallback: no is_active column — fetch all and filter in JS
    let org: any = null;
    if (orgs && orgs.length > 0) {
      org = orgs.find((o: any) =>
        o.channel_config?.email_address &&
        o.channel_config.email_address.toLowerCase() === recipientEmail.toLowerCase()
      );
    }

    if (!org) {
      // Fallback: search without is_active filter
      const { data: allOrgs } = await supabase.from("organizations").select("*");
      if (allOrgs) {
        org = allOrgs.find((o: any) =>
          o.channel_config?.email_address &&
          o.channel_config.email_address.toLowerCase() === recipientEmail.toLowerCase(),
        ) || null;
      }
    }

    if (!org) {
      return new Response(JSON.stringify({ error: "No organization found for this email address" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch active services
    const { data: services } = await supabase
      .from("services")
      .select("id, name, duration_minutes, price")
      .eq("organization_id", org.id)
      .eq("is_active", true);

    // 3. Upsert conversation + log incoming message
    const { data: convData, error: convErr } = await supabase.rpc("upsert_webhook_conversation", {
      p_org_id: org.id,
      p_channel: "email",
      p_customer_phone: null,
      p_customer_email: senderEmail,
      p_message_text: cleanedBody,
      p_metadata: { from: senderEmail, from_name: senderName, subject, to: recipientEmail },
    });

    if (convErr || !convData) {
      console.error("Conversation upsert failed:", convErr);
      return new Response(JSON.stringify({ error: "Failed to process conversation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const history = convData.history || [];
    const conversationId = convData.conversation_id;

    // 4. Generate AI response
    const aiResponse = await generateAIResponse(
      history,
      org,
      services || [],
      cleanedBody,
      org.id,
    );

    // 5. Log AI response in conversation_messages
    await supabase.from("conversation_messages").insert({
      conversation_id: conversationId,
      sender_type: "ai",
      content: aiResponse,
      metadata: { channel: "email", to: senderEmail },
    });

    // 6. Update conversation
    await supabase.from("conversations")
      .update({ last_message: aiResponse, last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    // 7. Send reply email
    const replyFrom = org.channel_config?.email_address || recipientEmail;
    const replyFromName = org.settings?.ai_config?.name || org.name || "AI Receptionist";
    const sent = await sendReplyEmail(senderEmail, replyFrom, replyFromName, subject, aiResponse);

    return new Response(JSON.stringify({
      success: true,
      conversation_id: conversationId,
      email_sent: sent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Email webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
