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

// ── Shared AI logic ──────────────────────────────────────────

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
  if (!geminiKey) return "I'm sorry, my AI systems are currently offline. Please call back later.";

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const servicesList = services
    .map((s: any) => `- ${s.name} (${s.duration_minutes} mins, ${s.price > 0 ? s.price : 'Free'})`)
    .join("\n");

  const aiName = org.settings?.ai_config?.name || "Sarah";
  const customInstructions = org.settings?.ai_config?.instructions || "";

  const systemInstruction = `You are ${aiName}, a helpful AI receptionist for ${org.name}, which is in the ${org.industry} industry.
Your goal is to assist callers, answer their questions, and help them book an appointment.

Here is the list of services we offer:
${servicesList}

Rules for your behavior:
1. Always be polite, professional, and concise — this is a PHONE CALL, so keep responses very short and conversational (1-2 sentences max).
2. If the user asks to book an appointment, ask them which service they want, what date/time they prefer, and collect their name and email.
3. ONCE YOU HAVE THEIR NAME, EMAIL, SERVICE, DATE, AND TIME, YOU MUST CALL THE "book_appointment" function to save it.
4. If they ask for human assistance, politely inform them that you will transfer them.
5. Do NOT make up services that are not in the list.
6. Do not use special characters, formatting, or emojis — responses will be read aloud by text-to-speech.
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
              source: "ai_voice",
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
          return "Thank you. Your appointment has been booked. Is there anything else I can help you with?";
        }
        return "I tried to book your appointment, but something went wrong. Please try again.";
      }
    }
  }

  return result.response.text();
}

// ── Voice helpers ────────────────────────────────────────────

/** Parse Twilio form-encoded body */
function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/** Escape text for XML */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build voice TwiML response.
 * - `speechResult`: the AI's text to speak back.
 * - `actionUrl`: URL Twilio should POST to when the caller speaks their next input.
 * - `gatherSpeech`: if true, wrap the <Say> inside a <Gather> for continuous conversation.
 */
function voiceTwiml(speechResult: string, actionUrl: string, gatherSpeech: boolean = true): string {
  const say = `<Say voice="Polly.Joanna-Neural">${escapeXml(speechResult)}</Say>`;
  const gather = `<Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" language="en-US">${say}</Gather>`;
  // Fallback if Gather times out — say goodbye and hang up
  const fallback = `<Say voice="Polly.Joanna-Neural">I didn't hear anything. Goodbye!</Say><Hangup/>`;

  if (gatherSpeech) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${gather}${fallback}</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
}

/** Initial greeting TwiML when a call comes in */
function greetingTwiml(greeting: string, actionUrl: string): string {
  const say = `<Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>`;
  const gather = `<Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" language="en-US"/>`;
  const fallback = `<Say voice="Polly.Joanna-Neural">I didn't hear anything. Goodbye!</Say><Hangup/>`;

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}${gather}${fallback}</Response>`;
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const body = parseFormBody(rawBody);

    const toNumber = body.To || "";
    const fromNumber = (body.From || "").replace(/^\+/, "");
    const speechResult = body.SpeechResult || "";
    const callSid = body.CallSid || "";

    // The webhook URL to call back for the next turn of the conversation
    const baseUrl = new URL(req.url).origin;
    const functionPath = `${new URL(req.url).pathname}`;
    const actionUrl = `${baseUrl}${functionPath}?CallSid=${encodeURIComponent(callSid)}&From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}`;

    // ── Case 1: Initial incoming call (no SpeechResult) ──
    if (!speechResult) {
      // Resolve org by the called number
      const { data: org } = await supabase
        .rpc("get_org_by_phone", { p_phone: toNumber })
        .maybeSingle();

      if (!org) {
        return new Response(
          voiceTwiml("Sorry, this number is not configured.", "", false),
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } },
        );
      }

      const aiName = org.settings?.ai_config?.name || "Sarah";
      const greeting = org.settings?.ai_config?.greeting ||
        `Hello, thank you for calling ${org.name}. I'm ${aiName}, your AI receptionist. How can I help you today?`;

      // Create conversation + log a system message for the call start
      const { data: services } = await supabase
        .from("services")
        .select("id, name, duration_minutes, price")
        .eq("organization_id", org.id)
        .eq("is_active", true);

      const { data: convData } = await supabase.rpc("upsert_webhook_conversation", {
        p_org_id: org.id,
        p_channel: "voice",
        p_customer_phone: fromNumber,
        p_customer_email: null,
        p_message_text: "[Call connected]",
        p_metadata: { call_sid: callSid, from: fromNumber, to: toNumber, event: "call_start" },
      });

      // If conversation was created, log the greeting as the first AI message
      if (convData?.conversation_id) {
        await supabase.from("conversation_messages").insert({
          conversation_id: convData.conversation_id,
          sender_type: "ai",
          content: greeting,
          metadata: { channel: "voice", call_sid: callSid },
        });
      }

      return new Response(greetingTwiml(greeting, actionUrl), {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // ── Case 2: Caller spoke — we have SpeechResult ──

    // Resolve org
    const { data: org } = await supabase
      .rpc("get_org_by_phone", { p_phone: toNumber })
      .maybeSingle();

    if (!org) {
      return new Response(
        voiceTwiml("Sorry, this number is not configured.", "", false),
        { headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Fetch services
    const { data: services } = await supabase
      .from("services")
      .select("id, name, duration_minutes, price")
      .eq("organization_id", org.id)
      .eq("is_active", true);

    // Upsert conversation + log the caller's speech as their message
    const { data: convData, error: convErr } = await supabase.rpc("upsert_webhook_conversation", {
      p_org_id: org.id,
      p_channel: "voice",
      p_customer_phone: fromNumber,
      p_customer_email: null,
      p_message_text: speechResult,
      p_metadata: { call_sid: callSid, from: fromNumber, to: toNumber, confidence: body.Confidence },
    });

    if (convErr || !convData) {
      console.error("Conversation upsert failed:", convErr);
      return new Response(
        voiceTwiml("Sorry, something went wrong. Please call back.", "", false),
        { headers: { ...corsHeaders, "Content-Type": "text/xml" } },
      );
    }

    const history = convData.history || [];
    const conversationId = convData.conversation_id;

    // Generate AI response
    const aiResponse = await generateAIResponse(
      history,
      org,
      services || [],
      speechResult,
      org.id,
    );

    // Log AI response
    await supabase.from("conversation_messages").insert({
      conversation_id: conversationId,
      sender_type: "ai",
      content: aiResponse,
      metadata: { channel: "voice", call_sid: callSid },
    });

    // Update conversation
    await supabase.from("conversations")
      .update({ last_message: aiResponse, last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    // Detect if AI is wrapping up (contains goodbye / anything else → end call)
    const isEnding = /\b(goodbye|see you|have a great day|thank you for calling|is there anything else)\b/i.test(aiResponse)
      && !/how can i help|what can i do|anything else/i.test(aiResponse);

    if (isEnding) {
      // Final response — no further gather
      return new Response(voiceTwiml(aiResponse, "", false), {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Continue conversation — speak response and gather next input
    return new Response(voiceTwiml(aiResponse, actionUrl, true), {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (err: any) {
    console.error("Voice webhook error:", err);
    return new Response(
      voiceTwiml("Sorry, I'm having trouble right now. Please call back shortly.", "", false),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
    );
  }
});
