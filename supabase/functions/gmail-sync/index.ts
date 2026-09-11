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

// --- Shared AI logic (same as email-webhook) ---
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

/**
 * Sync unread emails for all organizations that have Gmail connected
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Find organizations with a google_refresh_token
  const { data: allOrgs } = await supabase.from("organizations").select("*");
  const connectedOrgs = (allOrgs || []).filter((o: any) => o.channel_config?.google_refresh_token);

  console.log(`Found ${connectedOrgs.length} orgs with Gmail connected.`);

  let processedCount = 0;

  for (const org of connectedOrgs) {
    try {
      // 1. In a real application, you would use google_refresh_token to get a new access_token.
      // Since this is a template/mock, we assume we have a valid mock token or we skip if we can't authenticate.
      const refreshToken = org.channel_config.google_refresh_token;
      console.log(`Processing real-time Gmail for org ${org.name}...`);

      const clientId = Deno.env.get("VITE_GOOGLE_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID") || "";
      const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

      // 1. Get access token from refresh token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error(`Failed to refresh Google token for org ${org.id}:`, errBody);
        continue;
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      // 2. Fetch unread messages
      const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!listRes.ok) {
        console.error(`Failed listing messages for org ${org.id}`);
        continue;
      }

      const listData = await listRes.json();
      const messages = listData.messages || [];

      for (const msg of messages) {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();

        let sender = "";
        const headers = msgData.payload?.headers || [];
        for (const header of headers) {
          if (header.name === "From") sender = header.value;
        }

        let body = "";
        if (msgData.payload?.parts) {
          const part = msgData.payload.parts.find((p: any) => p.mimeType === "text/plain");
          if (part?.body?.data) {
            body = new TextDecoder().decode(Uint8Array.from(atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
          }
        } else if (msgData.payload?.body?.data) {
          body = new TextDecoder().decode(Uint8Array.from(atob(msgData.payload.body.data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
        }

        console.log(`Received unread email for ${org.name} from ${sender}: ${body.substring(0, 50)}...`);

        const orgEmail = org.channel_config?.email_address || "";
        if (sender && !sender.includes(orgEmail)) {
          // Fetch services for org
          const { data: services } = await supabase.from("services").select("*").eq("organization_id", org.id);
          const aiReply = await generateAIResponse([], org, services || [], body, org.id);

          const rawMessageStr =
            `To: ${sender}\r\n` +
            `Subject: Re: Your Inquiry\r\n\r\n` +
            aiReply;

          const encoder = new TextEncoder();
          const encodedBytes = encoder.encode(rawMessageStr);
          let binary = "";
          for (let i = 0; i < encodedBytes.byteLength; i++) {
            binary += String.fromCharCode(encodedBytes[i]);
          }
          const base64Message = btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

          await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              raw: base64Message,
              threadId: msgData.threadId,
            }),
          });
          console.log(`Sent real-time AI email reply to ${sender}`);
        }

        // Remove UNREAD label
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            removeLabelIds: ["UNREAD"],
          }),
        });
        processedCount++;
      }
    } catch (err: any) {
      console.error(`Failed to process Gmail sync for org ${org.id}:`, err);
    }
  }

  return new Response(JSON.stringify({ success: true, processed: processedCount }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
