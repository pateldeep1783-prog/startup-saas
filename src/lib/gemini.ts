import { GoogleGenerativeAI, SchemaType, FunctionDeclaration } from '@google/generative-ai';

// Initialize the API using the Vite env variable
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
export const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

export interface ChatMessage {
  sender: 'ai' | 'customer';
  text: string;
}

export interface BookingDetails {
  customer_name: string;
  customer_email: string;
  service_name: string;
  date: string;
  time: string;
}

export interface BusinessContext {
  name: string;
  industry: string;
  services: any[];
  aiName: string;
  customInstructions?: string;
  onBookingCallback?: (details: BookingDetails) => Promise<string>;
}

// Define the tool for Gemini
const bookAppointmentDeclaration: FunctionDeclaration = {
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
  }
};

export async function generateReceptionistResponse(
  chatHistory: ChatMessage[],
  context: BusinessContext,
  currentMessage: string
): Promise<string> {
  if (!apiKey) {
    console.error("Missing Gemini API Key");
    return "I'm sorry, my AI systems are currently offline. Please try again later.";
  }

  try {
    const servicesList = context.services
      .map(s => `- ${s.name} (${s.duration_minutes} mins, ${s.price > 0 ? '$' + s.price : 'Free'})`)
      .join('\n');

    const systemInstruction = `
You are ${context.aiName}, a helpful AI receptionist for ${context.name}, which is in the ${context.industry} industry.
Your goal is to assist customers, answer their questions, and help them book an appointment.

Here is the list of services we offer:
${servicesList}

Rules for your behavior:
1. Always be polite, professional, and concise.
2. If the user asks to book an appointment, ask them which service they want, what date/time they prefer, and collect their name and email.
3. ONCE YOU HAVE THEIR NAME, EMAIL, SERVICE, DATE, AND TIME, YOU MUST CALL THE "book_appointment" function to save it. Do not just say "I have booked it", actually call the function!
4. If they ask for human assistance, politely inform them that you will transfer them.
7. Do NOT make up services that are not in the list.
${context.customInstructions ? `\nSpecial Instructions for this business:\n${context.customInstructions}` : ''}
    `.trim();

    const history = chatHistory.map(msg => ({
      role: msg.sender === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    // Gemini API requires the first message in history to be from the user
    if (history.length > 0 && history[0].role === 'model') {
      history.unshift({ role: 'user', parts: [{ text: "Hello" }] });
    }

    const chatSession = model.startChat({
      history: history,
      systemInstruction: systemInstruction,
      tools: [{ functionDeclarations: [bookAppointmentDeclaration] }],
    });

    // Send the user's new message
    const result = await chatSession.sendMessage(currentMessage);
    const functionCalls = result.response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "book_appointment") {
        const args = call.args as any;
        console.log("Gemini requested to book:", args);
        
        let dbResultText = "";
        if (context.onBookingCallback) {
          try {
            dbResultText = await context.onBookingCallback(args as BookingDetails);
          } catch (err: any) {
            dbResultText = "Failed to save booking: " + err.message;
          }
        } else {
          dbResultText = "Successfully saved booking in DB!";
        }

        // Send function response back to Gemini so it can generate the final human-readable text
        try {
          const secondResult = await chatSession.sendMessage([{
            functionResponse: {
              name: "book_appointment",
              response: { result: dbResultText }
            }
          }]);
          return secondResult.response.text();
        } catch (functionErr) {
          console.warn("Gemini failed to generate text after function call, using fallback:", functionErr);
          // If the booking succeeded but the AI crashed generating the text response,
          // just return a success string so the user knows it worked!
          if (dbResultText.toLowerCase().includes('success')) {
            return "Thank you! Your appointment has been successfully booked. Let me know if you need anything else.";
          }
          return "I tried to book your appointment, but something went wrong: " + dbResultText;
        }
      }
    }

    return result.response.text();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "I'm having trouble processing that right now. Could you please rephrase or try again in a moment?";
  }
}
