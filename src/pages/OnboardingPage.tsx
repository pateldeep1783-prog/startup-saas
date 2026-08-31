import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Store, Scissors, Users, Clock, CalendarCheck, Bot, Plug } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { INDUSTRIES, COUNTRIES, TIMEZONES, DAYS_SHORT, STAFF_COLORS } from '@/lib/utils';

const STEPS = [
  { num: 1, label: 'Business', icon: Store },
  { num: 2, label: 'Services', icon: Scissors },
  { num: 3, label: 'Staff', icon: Users },
  { num: 4, label: 'Hours', icon: Clock },
  { num: 5, label: 'Rules', icon: CalendarCheck },
  { num: 6, label: 'AI', icon: Bot },
  { num: 7, label: 'Integrations', icon: Plug },
];

export function OnboardingPage() {
  const { organization, refreshOrganization } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [business, setBusiness] = useState({
    name: organization?.name ?? '',
    industry: organization?.industry ?? 'dental',
    country: organization?.country ?? 'GB',
    currency: organization?.currency ?? 'GBP',
    timezone: organization?.timezone ?? 'Europe/London',
    address: '',
    phone: '',
    website: '',
  });

  // Step 2
  const [services, setServices] = useState([
    { name: '', description: '', duration_minutes: 30, price: 0, buffer_before: 0, buffer_after: 0, deposit_required: false, deposit_amount: 0, cancellation_policy: '' },
  ]);

  // Step 3
  const [staff, setStaff] = useState([
    { name: '', email: '', phone: '', role: 'staff', job_title: '' },
  ]);

  // Step 4
  const [hours, setHours] = useState(
    DAYS_SHORT.map((_, i) => ({
      day: i,
      is_open: i >= 1 && i <= 5,
      start: '09:00',
      end: '17:00',
    }))
  );

  // Step 5
  const [rules, setRules] = useState({
    min_notice_hours: 2,
    max_booking_days: 60,
    cancellation_window_hours: 24,
    buffer_time: 15,
    allow_same_day: true,
    allow_emergency: false,
    auto_assign_staff: true,
  });

  // Step 6
  const [ai, setAi] = useState({
    name: 'Sarah',
    greeting: "Hi! I'm here to help you book an appointment. How can I assist you today?",
    personality: 'friendly',
    description: '',
    instructions: '',
    allow_booking: true,
    allow_cancellation: true,
    allow_refund: false,
    after_hours_behavior: 'basic',
  });

  // Step 7 - integrations (skip-only)
  const [integrations, setIntegrations] = useState<string[]>([]);

  async function saveStep1() {
    if (!organization) return;
    const countryInfo = COUNTRIES.find((c) => c.value === business.country);
    await supabase.from('organizations').update({
      name: business.name,
      industry: business.industry,
      country: business.country,
      currency: countryInfo?.currency ?? business.currency,
      timezone: business.timezone,
      settings: { address: business.address, phone: business.phone, website: business.website },
    }).eq('id', organization.id);

    const { data: loc } = await supabase.from('locations').select('*').eq('organization_id', organization.id).limit(1);
    if (!loc || loc.length === 0) {
      await supabase.from('locations').insert({
        organization_id: organization.id,
        name: business.name + ' - Main',
        address: business.address,
        phone: business.phone,
        timezone: business.timezone,
      });
    } else {
      await supabase.from('locations').update({
        name: business.name + ' - Main',
        address: business.address,
        phone: business.phone,
        timezone: business.timezone,
      }).eq('id', loc[0].id);
    }

    const { data: locData } = await supabase.from('locations').select('id').eq('organization_id', organization.id).limit(1);
    const locId = locData?.[0]?.id;
    if (locId) {
      for (const h of hours) {
        if (h.is_open) {
          await supabase.from('business_hours').upsert({
            location_id: locId,
            day_of_week: h.day,
            start_time: h.start,
            end_time: h.end,
            is_open: true,
          }, { onConflict: 'location_id,day_of_week' });
        } else {
          await supabase.from('business_hours').upsert({
            location_id: locId,
            day_of_week: h.day,
            is_open: false,
          }, { onConflict: 'location_id,day_of_week' });
        }
      }
    }

    await supabase.from('organizations').update({ onboarding_step: 2 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function saveStep2() {
    if (!organization) return;
    const validServices = services.filter((s) => s.name.trim());
    for (const s of validServices) {
      await supabase.from('services').insert({
        organization_id: organization.id,
        name: s.name,
        description: s.description,
        duration_minutes: s.duration_minutes,
        price: s.price,
        currency: business.currency,
        buffer_before: s.buffer_before,
        buffer_after: s.buffer_after,
        deposit_required: s.deposit_required,
        deposit_amount: s.deposit_amount,
        cancellation_policy: s.cancellation_policy || null,
      });
    }
    await supabase.from('organizations').update({ onboarding_step: 3 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function saveStep3() {
    if (!organization) return;
    const { data: locData } = await supabase.from('locations').select('id').eq('organization_id', organization.id).limit(1);
    const locId = locData?.[0]?.id;
    const validStaff = staff.filter((s) => s.name.trim());
    for (let i = 0; i < validStaff.length; i++) {
      const s = validStaff[i];
      const { data } = await supabase.from('staff').insert({
        organization_id: organization.id,
        name: s.name,
        email: s.email || null,
        phone: s.phone || null,
        role: s.role,
        job_title: s.job_title || null,
        location_id: locId,
        color: STAFF_COLORS[i % STAFF_COLORS.length],
      }).select().single();
      if (data) {
        for (const h of hours.filter((h) => h.is_open)) {
          await supabase.from('staff_hours').insert({
            staff_id: data.id,
            day_of_week: h.day,
            start_time: h.start,
            end_time: h.end,
            is_working: true,
          });
        }
      }
    }
    await supabase.from('organizations').update({ onboarding_step: 4 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function saveStep4() {
    if (!organization) return;
    const { data: locData } = await supabase.from('locations').select('id').eq('organization_id', organization.id).limit(1);
    const locId = locData?.[0]?.id;
    if (locId) {
      for (const h of hours) {
        await supabase.from('business_hours').upsert({
          location_id: locId,
          day_of_week: h.day,
          start_time: h.start,
          end_time: h.end,
          is_open: h.is_open,
        }, { onConflict: 'location_id,day_of_week' });
      }
    }
    await supabase.from('organizations').update({ onboarding_step: 5 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function saveStep5() {
    if (!organization) return;
    const settings = { ...organization.settings, booking_rules: rules };
    await supabase.from('organizations').update({ settings, onboarding_step: 6 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function saveStep6() {
    if (!organization) return;
    const settings = { ...organization.settings, ai_config: ai };
    await supabase.from('organizations').update({ settings, onboarding_step: 7 }).eq('id', organization.id);
    refreshOrganization();
  }

  async function finishOnboarding() {
    if (!organization) return;
    setLoading(true);
    await supabase.from('organizations').update({
      onboarding_completed: true,
      onboarding_step: 7,
    }).eq('id', organization.id);
    refreshOrganization();
    setLoading(false);
    toast('Your AI receptionist is ready!');
    navigate('/app');
  }

  async function nextStep() {
    setLoading(true);
    try {
      if (step === 1) await saveStep1();
      else if (step === 2) await saveStep2();
      else if (step === 3) await saveStep3();
      else if (step === 4) await saveStep4();
      else if (step === 5) await saveStep5();
      else if (step === 6) await saveStep6();
      if (step < 7) setStep(step + 1);
      else await finishOnboarding();
    } catch (err) {
      toast('Something went wrong. Please try again.', 'error');
    }
    setLoading(false);
  }

  function prevStep() {
    if (step > 1) setStep(step - 1);
  }

  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">ReceptionAI Onboarding</span>
          <span className="text-sm text-gray-500">Step {step} of {STEPS.length}</span>
        </div>
      </header>

      {/* Progress */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = step > s.num;
              const active = step === s.num;
              return (
                <div key={s.num} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                      done ? 'bg-success-500 text-white' :
                      active ? 'bg-primary-600 text-white ring-4 ring-primary-100' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block ${active ? 'text-primary-600' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 rounded ${done ? 'bg-success-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto py-8 px-6">
        <div className="mx-auto max-w-2xl">
          {step === 1 && <Step1Business business={business} setBusiness={setBusiness} />}
          {step === 2 && <Step2Services services={services} setServices={setServices} currency={business.currency} />}
          {step === 3 && <Step3Staff staff={staff} setStaff={setStaff} />}
          {step === 4 && <Step4Hours hours={hours} setHours={setHours} />}
          {step === 5 && <Step5Rules rules={rules} setRules={setRules} />}
          {step === 6 && <Step6AI ai={ai} setAi={setAi} />}
          {step === 7 && <Step7Integrations integrations={integrations} setIntegrations={setIntegrations} />}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white px-6 py-4">
        <div className="mx-auto max-w-2xl flex items-center justify-between">
          <button onClick={prevStep} disabled={step === 1} className="btn-ghost">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button onClick={nextStep} disabled={loading} className="btn-primary">
            {loading ? 'Saving...' : step === 7 ? 'Finish setup' : 'Continue'} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}

function Step1Business({ business, setBusiness }: { business: any; setBusiness: any }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Tell us about your business</h2>
        <p className="text-sm text-gray-500 mt-1">This information powers your booking page and AI receptionist.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="label">Business name</label>
          <input className="input" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} placeholder="Acme Dental Clinic" />
        </div>
        <div>
          <label className="label">Industry</label>
          <select className="input" value={business.industry} onChange={(e) => setBusiness({ ...business, industry: e.target.value })}>
            {INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Country</label>
          <select className="input" value={business.country} onChange={(e) => setBusiness({ ...business, country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={business.currency} onChange={(e) => setBusiness({ ...business, currency: e.target.value })}>
            <option value="GBP">£ GBP</option>
            <option value="USD">$ USD</option>
            <option value="EUR">€ EUR</option>
          </select>
        </div>
        <div>
          <label className="label">Timezone</label>
          <select className="input" value={business.timezone} onChange={(e) => setBusiness({ ...business, timezone: e.target.value })}>
            {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Address</label>
          <input className="input" value={business.address} onChange={(e) => setBusiness({ ...business, address: e.target.value })} placeholder="123 High Street, London" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={business.phone} onChange={(e) => setBusiness({ ...business, phone: e.target.value })} placeholder="+44 20 1234 5678" />
        </div>
        <div>
          <label className="label">Website</label>
          <input className="input" value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} placeholder="https://..." />
        </div>
      </div>
    </div>
  );
}

function Step2Services({ services, setServices, currency }: { services: any[]; setServices: any; currency: string }) {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€';
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Add your services</h2>
          <p className="text-sm text-gray-500 mt-1">What can customers book with you?</p>
        </div>
        <button onClick={() => setServices([...services, { name: '', description: '', duration_minutes: 30, price: 0, buffer_before: 0, buffer_after: 0, deposit_required: false, deposit_amount: 0, cancellation_policy: '' }])} className="btn-secondary text-sm">
          + Add service
        </button>
      </div>
      {services.map((s, i) => (
        <div key={i} className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Service {i + 1}</span>
            {services.length > 1 && (
              <button onClick={() => setServices(services.filter((_, idx) => idx !== i))} className="text-sm text-error-600 hover:text-error-700">Remove</button>
            )}
          </div>
          <div>
            <label className="label">Service name</label>
            <input className="input" value={s.name} onChange={(e) => { const n = [...services]; n[i] = { ...s, name: e.target.value }; setServices(n); }} placeholder="Dental Cleaning" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={s.description} onChange={(e) => { const n = [...services]; n[i] = { ...s, description: e.target.value }; setServices(n); }} placeholder="Professional dental cleaning and checkup" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Duration (min)</label>
              <input type="number" className="input" value={s.duration_minutes} onChange={(e) => { const n = [...services]; n[i] = { ...s, duration_minutes: parseInt(e.target.value) || 30 }; setServices(n); }} />
            </div>
            <div>
              <label className="label">Price ({symbol})</label>
              <input type="number" className="input" value={s.price} onChange={(e) => { const n = [...services]; n[i] = { ...s, price: parseFloat(e.target.value) || 0 }; setServices(n); }} />
            </div>
            <div>
              <label className="label">Buffer (min)</label>
              <input type="number" className="input" value={s.buffer_after} onChange={(e) => { const n = [...services]; n[i] = { ...s, buffer_after: parseInt(e.target.value) || 0 }; setServices(n); }} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={s.deposit_required} onChange={(e) => { const n = [...services]; n[i] = { ...s, deposit_required: e.target.checked }; setServices(n); }} className="rounded border-gray-300 text-primary-600" />
            Requires deposit
          </label>
        </div>
      ))}
    </div>
  );
}

function Step3Staff({ staff, setStaff }: { staff: any[]; setStaff: any }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Add your team</h2>
          <p className="text-sm text-gray-500 mt-1">Who will be taking appointments?</p>
        </div>
        <button onClick={() => setStaff([...staff, { name: '', email: '', phone: '', role: 'staff', job_title: '' }])} className="btn-secondary text-sm">
          + Add staff
        </button>
      </div>
      {staff.map((s, i) => (
        <div key={i} className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Staff member {i + 1}</span>
            {staff.length > 1 && (
              <button onClick={() => setStaff(staff.filter((_, idx) => idx !== i))} className="text-sm text-error-600 hover:text-error-700">Remove</button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={s.name} onChange={(e) => { const n = [...staff]; n[i] = { ...s, name: e.target.value }; setStaff(n); }} placeholder="Dr. Jane Smith" />
            </div>
            <div>
              <label className="label">Job title</label>
              <input className="input" value={s.job_title} onChange={(e) => { const n = [...staff]; n[i] = { ...s, job_title: e.target.value }; setStaff(n); }} placeholder="Dentist" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={s.email} onChange={(e) => { const n = [...staff]; n[i] = { ...s, email: e.target.value }; setStaff(n); }} placeholder="jane@acme.com" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={s.phone} onChange={(e) => { const n = [...staff]; n[i] = { ...s, phone: e.target.value }; setStaff(n); }} placeholder="+44..." />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Step4Hours({ hours, setHours }: { hours: any[]; setHours: any }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Working hours</h2>
        <p className="text-sm text-gray-500 mt-1">When is your business open?</p>
      </div>
      <div className="card divide-y divide-gray-100">
        {hours.map((h, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <label className="flex items-center gap-3 w-28">
              <input type="checkbox" checked={h.is_open} onChange={(e) => { const n = [...hours]; n[i] = { ...h, is_open: e.target.checked }; setHours(n); }} className="rounded border-gray-300 text-primary-600" />
              <span className="text-sm font-medium text-gray-700">{DAYS_SHORT[i]}</span>
            </label>
            {h.is_open ? (
              <div className="flex items-center gap-2">
                <input type="time" className="input w-32" value={h.start} onChange={(e) => { const n = [...hours]; n[i] = { ...h, start: e.target.value }; setHours(n); }} />
                <span className="text-gray-400">—</span>
                <input type="time" className="input w-32" value={h.end} onChange={(e) => { const n = [...hours]; n[i] = { ...h, end: e.target.value }; setHours(n); }} />
              </div>
            ) : (
              <span className="text-sm text-gray-400">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Step5Rules({ rules, setRules }: { rules: any; setRules: any }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Booking rules</h2>
        <p className="text-sm text-gray-500 mt-1">Set the rules for how customers can book.</p>
      </div>
      <div className="card p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Minimum notice (hours)</label>
            <input type="number" className="input" value={rules.min_notice_hours} onChange={(e) => setRules({ ...rules, min_notice_hours: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="label">Max booking window (days)</label>
            <input type="number" className="input" value={rules.max_booking_days} onChange={(e) => setRules({ ...rules, max_booking_days: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="label">Cancellation window (hours)</label>
            <input type="number" className="input" value={rules.cancellation_window_hours} onChange={(e) => setRules({ ...rules, cancellation_window_hours: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="label">Buffer time (minutes)</label>
            <input type="number" className="input" value={rules.buffer_time} onChange={(e) => setRules({ ...rules, buffer_time: parseInt(e.target.value) || 0 })} />
          </div>
        </div>
        <div className="space-y-3 pt-2">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={rules.allow_same_day} onChange={(e) => setRules({ ...rules, allow_same_day: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Allow same-day bookings
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={rules.allow_emergency} onChange={(e) => setRules({ ...rules, allow_emergency: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Allow emergency bookings
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={rules.auto_assign_staff} onChange={(e) => setRules({ ...rules, auto_assign_staff: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Auto-assign staff to bookings
          </label>
        </div>
      </div>
    </div>
  );
}

function Step6AI({ ai, setAi }: { ai: any; setAi: any }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Configure your AI receptionist</h2>
        <p className="text-sm text-gray-500 mt-1">Your AI will represent your business to customers.</p>
      </div>
      <div className="card p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">AI name</label>
            <input className="input" value={ai.name} onChange={(e) => setAi({ ...ai, name: e.target.value })} placeholder="Sarah" />
          </div>
          <div>
            <label className="label">Personality</label>
            <select className="input" value={ai.personality} onChange={(e) => setAi({ ...ai, personality: e.target.value })}>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="warm">Warm</option>
              <option value="concise">Concise</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Greeting</label>
          <textarea className="input" rows={2} value={ai.greeting} onChange={(e) => setAi({ ...ai, greeting: e.target.value })} />
        </div>
        <div>
          <label className="label">Business description</label>
          <textarea className="input" rows={3} value={ai.description} onChange={(e) => setAi({ ...ai, description: e.target.value })} placeholder="We are a dental clinic offering cleanings, consultations, and emergency appointments..." />
        </div>
        <div>
          <label className="label">Special instructions</label>
          <textarea className="input" rows={3} value={ai.instructions} onChange={(e) => setAi({ ...ai, instructions: e.target.value })} placeholder="Always be polite. Never promise unavailable times. Ask customers for the information required to book." />
        </div>
        <div className="space-y-3 pt-2">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={ai.allow_booking} onChange={(e) => setAi({ ...ai, allow_booking: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Allow AI to create bookings
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={ai.allow_cancellation} onChange={(e) => setAi({ ...ai, allow_cancellation: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Allow AI to cancel bookings
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={ai.allow_refund} onChange={(e) => setAi({ ...ai, allow_refund: e.target.checked })} className="rounded border-gray-300 text-primary-600" />
            Allow AI to process refunds
          </label>
        </div>
      </div>
    </div>
  );
}

function Step7Integrations({ integrations, setIntegrations }: { integrations: string[]; setIntegrations: any }) {
  const cards = [
    { id: 'google_calendar', name: 'Google Calendar', desc: 'Sync availability and bookings' },
    { id: 'outlook', name: 'Microsoft Outlook', desc: 'Sync with Outlook calendar' },
    { id: 'stripe', name: 'Stripe', desc: 'Accept payments and deposits' },
    { id: 'email', name: 'Email', desc: 'Send confirmations and reminders' },
    { id: 'sms', name: 'SMS', desc: 'Text message notifications' },
    { id: 'whatsapp', name: 'WhatsApp', desc: 'WhatsApp messaging' },
    { id: 'voice', name: 'Voice AI', desc: 'AI answers phone calls' },
  ];
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Connect your tools</h2>
        <p className="text-sm text-gray-500 mt-1">You can skip this and connect later.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {cards.map((c) => {
          const connected = integrations.includes(c.id);
          return (
            <div key={c.id} className={`card p-5 ${connected ? 'border-primary-300 bg-primary-50/30' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
                </div>
                <button
                  onClick={() => setIntegrations(connected ? integrations.filter((x) => x !== c.id) : [...integrations, c.id])}
                  className={connected ? 'btn-ghost text-success-600 text-xs' : 'btn-secondary text-xs'}
                >
                  {connected ? '✓ Connected' : 'Connect'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-sm text-gray-400">You can connect or skip these — they're all optional.</p>
    </div>
  );
}
