import { Link } from 'react-router-dom';
import {
  Bot, Calendar, MessageSquare, Phone, BarChart3, Bell, CreditCard,
  Check, ArrowRight, Shield, Users, Globe, ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { AIChatWidget } from '@/components/AIChatWidget';

export function LandingPage() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      name: 'Starter',
      slug: 'starter',
      price: billing === 'monthly' ? 49 : 39,
      description: 'Get started with AI chat and booking',
      features: ['1 location', '2 staff', 'AI chat receptionist', 'Booking engine', 'Reminders', 'Customer CRM'],
      highlight: false,
    },
    {
      name: 'Growth',
      slug: 'growth',
      price: billing === 'monthly' ? 149 : 119,
      description: 'Scale with voice AI and automations',
      features: ['5 staff', 'Voice AI', 'SMS & WhatsApp', 'Automation engine', 'Analytics', 'Multi-channel inbox'],
      highlight: true,
    },
    {
      name: 'Pro',
      slug: 'pro',
      price: billing === 'monthly' ? 299 : 239,
      description: 'Everything for multi-location businesses',
      features: ['Unlimited staff', 'Multiple locations', 'Advanced AI', 'API access', 'Custom workflows', 'Priority support'],
      highlight: false,
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-gray-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Bot className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold text-gray-900">ReceptionAI</span>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">How it works</a>
              <a href="#industries" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">Industries</a>
              <a href="#pricing" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              {user ? (
                <Link to="/app" className="btn-primary">Go to Dashboard</Link>
              ) : (
                <>
                  <Link to="/login" className="btn-ghost hidden sm:inline-flex">Sign in</Link>
                  <Link to="/signup" className="btn-primary">Start Free</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary-50/50 to-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary-100/40 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 border border-primary-200 px-3 py-1 mb-6">
                <span className="flex h-2 w-2 rounded-full bg-success-500 animate-pulse" />
                <span className="text-xs font-medium text-primary-700">AI Receptionist Operating System</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-tight">
                Your AI Receptionist.
                <span className="block text-primary-600">24/7.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-600 max-w-xl leading-relaxed">
                Answer customers, book appointments, manage schedules, and follow up automatically — even when your team is busy.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link to="/signup" className="btn-primary text-base px-6 py-3">
                  Start Free <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#how-it-works" className="btn-secondary text-base px-6 py-3">
                  Book Demo
                </a>
              </div>
              <div className="mt-8 flex items-center gap-6 text-sm text-gray-500">
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-success-500" /> No credit card</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-success-500" /> 14-day trial</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-success-500" /> Cancel anytime</div>
              </div>
            </div>

            {/* Hero visual - chat mockup */}
            <div className="relative animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <div className="rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3 bg-gray-50">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-white text-sm font-semibold">S</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Sarah — AI Receptionist</p>
                    <p className="text-xs text-success-600 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success-500" /> Online</p>
                  </div>
                </div>
                <div className="p-5 space-y-3 min-h-[320px]">
                  <ChatBubble side="customer">Hi, I need to see someone about back pain.</ChatBubble>
                  <ChatBubble side="ai">I'd be happy to help. Would you prefer an in-person or video consultation?</ChatBubble>
                  <ChatBubble side="customer">In-person, tomorrow morning if possible.</ChatBubble>
                  <ChatBubble side="ai">
                    I have 9:30 AM and 11:00 AM available. 9:30 AM is the earliest option. Would you like me to reserve it?
                  </ChatBubble>
                  <ChatBubble side="customer">Yes, please.</ChatBubble>
                  <ChatBubble side="ai">Great. May I have your name and email?</ChatBubble>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 rounded-xl border border-gray-200 bg-white shadow-lg px-4 py-3 hidden sm:block">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-600">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Appointment Booked</p>
                    <p className="text-xs text-gray-500">Tomorrow 9:30 AM · Dr. Smith</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <Stat value="24/7" label="Always available" />
            <Stat value="< 2s" label="Response time" />
            <Stat value="29%" label="Avg. conversion" />
            <Stat value="50+" label="Industries served" />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">How it works</h2>
            <p className="mt-3 text-gray-600 max-w-2xl mx-auto">From customer inquiry to confirmed booking in seconds — fully automated.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <Step icon={<MessageSquare />} num="01" title="Customer reaches out" desc="Via website chat, SMS, WhatsApp, email, or voice. The AI receptionist responds instantly." />
            <Step icon={<Calendar />} num="02" title="AI finds the right slot" desc="The availability engine checks staff schedules, buffers, and business rules to recommend the best time." />
            <Step icon={<Check />} num="03" title="Booking confirmed" desc="The customer books, pays a deposit if needed, and gets a confirmation — all without staff involvement." />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">Everything your front desk needs</h2>
            <p className="mt-3 text-gray-600 max-w-2xl mx-auto">A complete operating system for managing appointments, customers, and communications.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Feature icon={<Bot />} title="AI Receptionist" desc="Handles conversations across chat, SMS, WhatsApp, email, and voice. Understands intent and books appointments." />
            <Feature icon={<Calendar />} title="Booking Engine" desc="Real availability engine that respects staff hours, breaks, leave, buffers, and business rules." />
            <Feature icon={<MessageSquare />} title="Multi-channel Inbox" desc="Unified inbox for all customer conversations. Take over from AI or let it handle things automatically." />
            <Feature icon={<Bell />} title="Automations" desc="Reminders, no-show recovery, review requests, and follow-ups — all automated on your schedule." />
            <Feature icon={<CreditCard />} title="Payments & Deposits" desc="Collect full payments or deposits at booking. Stripe-powered with refund management." />
            <Feature icon={<BarChart3 />} title="Analytics" desc="Track bookings, revenue, AI performance, conversion rates, and no-show trends in real time." />
            <Feature icon={<Users />} title="Customer CRM" desc="Full customer profiles with appointment history, notes, tags, and activity timeline." />
            <Feature icon={<Phone />} title="Voice AI" desc="AI answers calls, identifies intent, and books appointments over the phone 24/7." />
            <Feature icon={<Shield />} title="Multi-tenant Security" desc="Row-level security keeps every business's data isolated. Role-based access for your whole team." />
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">Built for service businesses</h2>
            <p className="mt-3 text-gray-600 max-w-2xl mx-auto">From dental clinics to home services — ReceptionAI adapts to your industry.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {['Dental', 'Medical', 'Physiotherapy', 'Beauty', 'Hair Salon', 'Med Spa', 'Legal', 'Accounting', 'Plumbing', 'Electrical', 'HVAC', 'Roofing', 'Cleaning', 'Automotive', 'Other'].map((ind) => (
              <div key={ind} className="card p-5 text-center hover:shadow-md transition-shadow cursor-default">
                <p className="text-sm font-medium text-gray-700">{ind}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-gray-900">Simple, transparent pricing</h2>
            <p className="mt-3 text-gray-600">Start free for 14 days. No credit card required.</p>
          </div>
          <div className="flex items-center justify-center gap-3 mb-10">
            <span className={`text-sm font-medium ${billing === 'monthly' ? 'text-gray-900' : 'text-gray-400'}`}>Monthly</span>
            <button
              onClick={() => setBilling(billing === 'monthly' ? 'yearly' : 'monthly')}
              className="relative h-6 w-11 rounded-full bg-primary-600 transition-colors"
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${billing === 'yearly' ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className={`text-sm font-medium ${billing === 'yearly' ? 'text-gray-900' : 'text-gray-400'}`}>Yearly</span>
            <span className="badge bg-success-50 text-success-700">Save 20%</span>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.slug}
                className={`card p-8 relative ${plan.highlight ? 'border-primary-600 ring-2 ring-primary-600/20' : ''}`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-1 text-xs font-medium text-white">
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
                  <span className="text-sm text-gray-500">/month</span>
                </div>
                <Link to="/signup" className={`mt-6 w-full ${plan.highlight ? 'btn-primary' : 'btn-secondary'}`}>
                  Start Free Trial
                </Link>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-success-500 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">Frequently asked questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <FAQItem key={i} {...faq} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary-600">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to automate your front desk?</h2>
          <p className="mt-3 text-primary-100">Join thousands of businesses saving time and never missing a booking.</p>
          <Link to="/signup" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-primary-600 hover:bg-primary-50 transition-colors">
            Start Free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <Link to="/" className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <span className="font-bold text-gray-900">ReceptionAI</span>
              </Link>
              <p className="text-sm text-gray-500">Your AI receptionist that answers customers, books appointments, and works 24/7.</p>
            </div>
            <FooterCol title="Product" links={['Features', 'Pricing', 'Industries', 'Demo']} />
            <FooterCol title="Company" links={['About', 'Blog', 'Careers', 'Contact']} />
            <FooterCol title="Legal" links={['Privacy', 'Terms', 'GDPR', 'Security']} />
          </div>
          <div className="mt-10 pt-8 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-400">© 2026 ReceptionAI. All rights reserved.</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Globe className="h-4 w-4" /> United Kingdom & United States
            </div>
          </div>
        </div>
      </footer>
      <AIChatWidget />
    </div>
  );
}

function ChatBubble({ side, children }: { side: 'customer' | 'ai'; children: React.ReactNode }) {
  return (
    <div className={`flex ${side === 'customer' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${side === 'customer' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
        {children}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function Step({ icon, num, title, desc }: { icon: React.ReactNode; num: string; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
        {icon}
      </div>
      <p className="text-xs font-semibold text-primary-600 mb-1">{num}</p>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500">{desc}</p>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card p-6 hover:shadow-md transition-shadow">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="text-sm font-semibold text-gray-900">{q}</span>
        <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-4 text-sm text-gray-600 animate-fade-in">{a}</div>}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l}><a href="#" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">{l}</a></li>
        ))}
      </ul>
    </div>
  );
}

const faqs = [
  { q: 'How does the AI receptionist work?', a: 'The AI receptionist connects to your website, SMS, WhatsApp, email, and voice channels. It understands customer requests, checks real availability, and books appointments — all while respecting your business rules and policies.' },
  { q: 'Can the AI handle payments and deposits?', a: 'Yes. The AI can collect full payments or deposits at the time of booking using Stripe. You can configure deposit requirements per service — fixed amount, percentage, or full prepayment.' },
  { q: 'What if the AI can\'t handle a request?', a: 'The AI automatically escalates to a human team member when it can\'t help, when a customer requests a human, or for sensitive situations like complaints and refunds. Your staff can take over any conversation at any time.' },
  { q: 'Is my business data secure?', a: 'Yes. Every business is a separate tenant with row-level security. Your customers, bookings, conversations, and payments are never visible to other businesses on the platform.' },
  { q: 'Which industries are supported?', a: 'ReceptionAI works for any appointment-based business — dental clinics, medical practices, salons, med spas, legal and accounting firms, trades (plumbing, electrical, HVAC, roofing), cleaning, automotive, and more.' },
];
