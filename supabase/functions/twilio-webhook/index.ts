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
  if (!geminiKey) return "I'm sorry, my AI systems are currently offline. Please try again later.";

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const servicesList = services
    .map((s: any) => `- ${s.name} (${s.duration_minutes} mins, ${s.price > 0 ? s.price : 'Free'})`)
    .join("\n");

  const aiName = org.settings?.ai_config?.name || "Sarah";
  const customInstructions = org.settings?.ai_config?.instructions || "";

  const systemInstruction = `You are ${aiName}, a helpful AI receptionist for ${org.name}, in the ${org.industry} industry.
Your goal is to assist customers, answer questions, list available services, and help them book an appointment.

Here is the list of services we offer:
${servicesList}

Rules for your behavior:
1. Always be polite, professional, and concise. Keep responses under 320 characters for SMS.
2. IF THE CUSTOMER ASKS WHAT SERVICES WE OFFER OR INQUIRES ABOUT PRICES/DETAILS:
   - Provide a clear, friendly list of available services with their prices and duration.
   - Ask them which service they would like to book and what date/time they prefer.
3. IMPORTANT FOR BOOKINGS:
   - If the customer asks to book an appointment BUT HAS NOT specified a date and time yet, DO NOT call "book_appointment". Respond by politely asking what date and time works best for them.
   - ONLY call the "book_appointment" function when the customer has provided or confirmed a specific date and time (e.g. "tomorrow at 11:00 am", "10th Sept at 2:00 PM").
4. When calling "book_appointment", pass customer_name, customer_email, service_name, date, and time.
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
        // Find or create customer
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

        // Match service
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

// ── Helpers ──────────────────────────────────────────────────

/** Parse Twilio form-encoded body into a flat key-value object */
function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/** Build TwiML MessagingResponse XML */
function twimlResponse(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
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

    const incomingMessage = body.Body || "";
    const fromNumber = body.From || "";       // e.g. "+447123456789" or "whatsapp:+447123456789"
    const toNumber = body.To || "";            // The Twilio number that received the message

    // Determine channel: WhatsApp vs SMS based on the From prefix
    const isWhatsApp = fromNumber.toLowerCase().startsWith("whatsapp:");
    const channel = isWhatsApp ? "whatsapp" : "sms";

    // Extract the raw phone number (strip "whatsapp:" prefix)
    const customerPhone = fromNumber.replace(/^whatsapp:/i, "").replace(/^\+/, "");

    if (!incomingMessage || !toNumber) {
      return new Response(twimlResponse("Sorry, I couldn't process your message."), {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // 1. Resolve which organization owns this Twilio number
    const { data: org } = await supabase
      .rpc("get_org_by_phone", { p_phone: toNumber })
      .maybeSingle();

    if (!org) {
      return new Response(twimlResponse("Sorry, this number is not configured."), {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // 2. Fetch active services for this org
    const { data: services } = await supabase
      .from("services")
      .select("id, name, duration_minutes, price")
      .eq("organization_id", org.id)
      .eq("is_active", true);

    // 3. Upsert conversation + log incoming message, get history
    const { data: convData, error: convErr } = await supabase.rpc("upsert_webhook_conversation", {
      p_org_id: org.id,
      p_channel: channel,
      p_customer_phone: customerPhone,
      p_customer_email: null,
      p_message_text: incomingMessage,
      p_metadata: { from: fromNumber, to: toNumber, twilio_message_sid: body.MessageSid },
    });

    if (convErr || !convData) {
      console.error("Conversation upsert failed:", convErr);
      return new Response(twimlResponse("Sorry, something went wrong. Please try again."), {
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    const history = convData.history || [];
    const conversationId = convData.conversation_id;

    // 4. Generate AI response
    const aiResponse = await generateAIResponse(
      history,
      org,
      services || [],
      incomingMessage,
      org.id,
    );

    // 5. Log the AI response in conversation_messages
    await supabase.from("conversation_messages").insert({
      conversation_id: conversationId,
      sender_type: "ai",
      content: aiResponse,
      metadata: { channel, from: toNumber, to: fromNumber },
    });

    // 6. Update conversation last_message
    await supabase.from("conversations")
      .update({ last_message: aiResponse, last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    // 7. Return TwiML so Twilio sends the reply
    return new Response(twimlResponse(aiResponse), {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (err: any) {
    console.error("Twilio webhook error:", err);
    return new Response(
      twimlResponse("Sorry, I'm having trouble right now. Please try again shortly."),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } },
    );
  }
});
