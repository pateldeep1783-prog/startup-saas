import { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, MessageSquare, Sparkles } from 'lucide-react';
import { generateReceptionistResponse } from '@/lib/gemini';

export function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([
    { sender: 'ai', text: "Hi! I am Sarah, ReceptionAI's demo receptionist. How can I help you today?" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, isOpen]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'customer', text: chatInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput('');
    setIsTyping(true);

    try {
      const context = {
        name: 'ReceptionAI Demo Clinic',
        industry: 'Software SaaS',
        services: [
          { name: 'Product Demo', duration_minutes: 30, price: 0 },
          { name: 'Sales Call', duration_minutes: 15, price: 0 }
        ],
        aiName: 'Sarah',
        customInstructions: "We offer 3 pricing plans:\n1. Starter: $49/month (1 location, 2 staff, AI chat receptionist, Booking engine, Reminders, CRM).\n2. Growth: $149/month (5 staff, Voice AI, SMS & WhatsApp, Automation engine, Analytics, Multi-channel inbox).\n3. Pro: $299/month (Unlimited staff, Multiple locations, Advanced AI, API access, Custom workflows, Priority support).\nAll plans have a 14-day free trial, no credit card required.",
        onBookingCallback: async (details: any) => {
          return "Success! I've scheduled a demo for you. (Note: This is a sandbox demo).";
        }
      };

      const aiResponse = await generateReceptionistResponse(
        messages,
        context,
        chatInput
      );

      setMessages((prev) => [...prev, { sender: 'ai', text: aiResponse }]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { sender: 'ai', text: "I'm having trouble connecting to my brain right now. Please try again!" }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 bg-primary-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-primary-700 transition-transform hover:scale-105 z-50 animate-bounce-slow"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[350px] bg-white border border-gray-200 shadow-2xl rounded-2xl overflow-hidden flex flex-col h-[500px] z-50 animate-slide-up">
          {/* Header */}
          <div className="bg-primary-600 px-5 py-4 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-none">Sarah</h3>
                <span className="text-[10px] text-primary-100 flex items-center gap-1 mt-1">
                  <Sparkles className="h-2.5 w-2.5 text-amber-300" /> AI is Online
                </span>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-primary-100 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 text-xs">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`p-3 rounded-xl max-w-[85%] whitespace-pre-line shadow-sm ${
                  msg.sender === 'customer'
                    ? 'bg-primary-600 text-white rounded-tr-none'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="p-3 bg-white border border-gray-200 text-gray-400 rounded-xl rounded-tl-none shadow-sm animate-pulse flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
            <input
              type="text"
              className="input flex-1 text-xs py-2 px-3 focus:ring-1"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button onClick={handleSendMessage} className="btn-primary p-2 h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
