import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the API using the Vite env variable
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

// We export the client in case we need it directly
export const genAI = new GoogleGenerativeAI(apiKey);

// Using a stable gemini model
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export interface ChatMessage {
  sender: 'ai' | 'customer';
  text: string;
}

export interface BusinessContext {
  name: string;
  industry: string;
  services: any[];
  aiName: string;
}

/**
 * Generates a response from the Gemini AI acting as a receptionist.
 */
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
    // Format the system instruction / context
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
2. If the user asks to book an appointment, ask them which service they want, what time they prefer, and collect their name and email.
3. If they ask for human assistance, politely inform them that you will transfer them.
4. Do NOT make up services that are not in the list.
5. Keep your responses under 3-4 sentences.
    `.trim();

    // Convert our ChatMessage format to Gemini's format
    const history = chatHistory.map(msg => ({
      role: msg.sender === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    // Start a chat session with the model
    const chatSession = model.startChat({
      history: history,
      systemInstruction: systemInstruction, // gemini-1.5 supports systemInstruction
    });

    // Send the user's new message
    const result = await chatSession.sendMessage(currentMessage);
    return result.response.text();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "I'm having trouble processing that right now. Could you please rephrase or try again in a moment?";
  }
}
