import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Bot, Send, ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import { generateReceptionistResponse } from '@/lib/gemini';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

export function PublicChatPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Load Organization & default AI setup
  useEffect(() => {
    const fetchOrg = async () => {
      setLoading(true);
      try {
        const { data: businessData } = await supabase
          .from('organizations')
          .select('*')
          .eq('slug', businessSlug)
          .maybeSingle();

        if (!businessData) {
          // Fallback mock org
          setOrg({ id: 'demo-org', name: 'Demo Dental Clinic', slug: businessSlug, currency: 'GBP' });
          setServices([
            { id: 'serv-1', name: 'General Dental Cleaning', duration_minutes: 30, price: 75 },
            { id: 'serv-2', name: 'Standard Consultation', duration_minutes: 45, price: 120 }
          ]);
          setMessages([
            { sender: 'ai', text: "Hi! I am Sarah, your AI Receptionist. I can assist you with scheduling, services details, and policies. How can I help you today?" }
          ]);
        } else {
          setOrg(businessData);
          const { data: servs } = await supabase
            .from('services')
            .select('*')
            .eq('organization_id', businessData.id)
            .eq('is_active', true);
          setServices(servs || []);

          // AI settings or defaults
          const aiName = 'Sarah';
          const aiGreeting = "Hi! I'm here to help you book an appointment. How can I assist you today?";
          setMessages([
            { sender: 'ai', text: aiGreeting }
          ]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrg();
  }, [businessSlug]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'customer', text: chatInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput('');
    setIsTyping(true);

    try {
      const context = {
        name: org?.name ?? 'Business',
        industry: org?.industry ?? 'Service',
        services: services,
        aiName: 'Sarah',
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 shadow-2xl rounded-2xl overflow-hidden flex flex-col h-[550px]">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 text-white flex items-center gap-3">
          <div className="h-9 w-9 bg-white/20 rounded-full flex items-center justify-center">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xs leading-none">{org?.name}</h1>
            <span className="text-[10px] text-primary-100 flex items-center gap-1 mt-1">
              <Sparkles className="h-2.5 w-2.5 text-amber-300" /> AI Receptionist is Online
            </span>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 text-xs">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-3 rounded-lg max-w-[80%] whitespace-pre-line ${
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
              <div className="p-3 bg-white border border-gray-200 text-gray-400 rounded-lg rounded-tl-none animate-pulse">
                Assistant is typing...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div className="p-4 bg-white border-t border-gray-100 flex gap-2">
          <input
            type="text"
            className="input flex-1 text-xs"
            placeholder="Ask me to schedule a booking..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <button onClick={handleSendMessage} className="btn-primary p-2">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
