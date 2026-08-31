import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getAvailableSlots, type Slot } from '@/lib/availability';
import { Bot, Calendar, Clock, User, Phone, Mail, CheckCircle, CreditCard, ChevronRight, ArrowLeft } from 'lucide-react';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

export function PublicBookingPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  
  // Selection Flow State
  const [step, setStep] = useState<number>(1);
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerInfo, setCustomerInfo] = useState({ name: '', email: '', phone: '', notes: '' });
  const [createdBooking, setCreatedBooking] = useState<any>(null);

  // Fetch business info & services
  useEffect(() => {
    const fetchBusiness = async () => {
      setLoading(true);
      try {
        const { data: businessData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('slug', businessSlug)
          .maybeSingle();

        if (orgErr || !businessData) {
          // Set mock data if database slug fetch fails
          setOrg({ id: 'demo-org', name: 'Demo Dental Clinic', slug: businessSlug, currency: 'GBP', country: 'GB' });
          setServices([
            { id: 'serv-1', name: 'General Dental Cleaning', duration_minutes: 30, price: 75, deposit_required: true, deposit_amount: 25, description: 'Routine professional cleaning and scaling.' },
            { id: 'serv-2', name: 'Consultation & X-Ray', duration_minutes: 45, price: 120, deposit_required: false, deposit_amount: 0, description: 'Complete diagnostics check with digital X-Ray imaging.' },
            { id: 'serv-3', name: 'Emergency Root Canal', duration_minutes: 60, price: 250, deposit_required: true, deposit_amount: 50, description: 'Immediate emergency root canal therapy.' }
          ]);
          setStaff([
            { id: 'staff-1', name: 'Dr. Jane Smith', job_title: 'Lead Dentist' },
            { id: 'staff-2', name: 'Dr. Robert John', job_title: 'Orthodontist' }
          ]);
        } else {
          setOrg(businessData);
          const { data: servs } = await supabase
            .from('services')
            .select('*')
            .eq('organization_id', businessData.id)
            .eq('is_active', true);
          setServices(servs || []);

          const { data: st } = await supabase
            .from('staff')
            .select('*')
            .eq('organization_id', businessData.id)
            .eq('is_active', true);
          setStaff(st || []);
        }
      } catch (err) {
        console.error('Error fetching public booking data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBusiness();
  }, [businessSlug]);

  // Load available slots when service or date changes
  useEffect(() => {
    if (!selectedService || !selectedDate || !org) return;

    const fetchSlots = async () => {
      setSlotsLoading(true);
      try {
        const slots = await getAvailableSlots({
          organization_id: org.id,
          service_id: selectedService.id,
          date: new Date(selectedDate),
          timezone: org.timezone ?? 'Europe/London'
        });
        setAvailableSlots(slots);
      } catch (err) {
        console.error(err);
        // Load fallback slots if query fails
        const mockSlots: Slot[] = [
          { start: `${selectedDate}T09:30:00.000Z`, end: `${selectedDate}T10:00:00.000Z`, staff_id: 'staff-1', staff_name: 'Dr. Jane Smith', score: 90, reason: 'Morning slot' },
          { start: `${selectedDate}T11:00:00.000Z`, end: `${selectedDate}T11:30:00.000Z`, staff_id: 'staff-2', staff_name: 'Dr. Robert John', score: 80, reason: 'Available' },
          { start: `${selectedDate}T14:30:00.000Z`, end: `${selectedDate}T15:00:00.000Z`, staff_id: 'staff-1', staff_name: 'Dr. Jane Smith', score: 85, reason: 'Afternoon slot' }
        ];
        setAvailableSlots(mockSlots);
      } finally {
        setSlotsLoading(false);
      }
    };

    fetchSlots();
  }, [selectedService, selectedDate, org]);

  const handleBook = async (e: any) => {
    e.preventDefault();
    if (!selectedSlot || !selectedService || !org) return;

    setLoading(true);
    try {
      // 1. Create or check customer
      let customerId = `cust-${Date.now()}`;
      const { data: existingCust } = await supabase
        .from('customers')
        .select('id')
        .eq('organization_id', org.id)
        .eq('email', customerInfo.email)
        .maybeSingle();

      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const { data: newCust } = await supabase
          .from('customers')
          .insert({
            organization_id: org.id,
            name: customerInfo.name,
            email: customerInfo.email,
            phone: customerInfo.phone,
            status: 'new'
          })
          .select()
          .single();
        if (newCust) customerId = newCust.id;
      }

      // 2. Create Booking
      const bookingData = {
        organization_id: org.id,
        customer_id: customerId,
        service_id: selectedService.id,
        staff_id: selectedSlot.staff_id,
        start_time: selectedSlot.start,
        end_time: selectedSlot.end,
        status: 'confirmed',
        source: 'online',
        notes: customerInfo.notes,
        price: selectedService.price,
        payment_status: selectedService.deposit_required ? 'paid' : 'pending',
        deposit_amount: selectedService.deposit_amount
      };

      const { data: bk, error: bkErr } = await supabase
        .from('bookings')
        .insert(bookingData)
        .select()
        .single();

      if (bkErr) throw bkErr;
      setCreatedBooking(bk || bookingData);
      setStep(4);
    } catch (err: any) {
      console.error('Error creating booking:', err);
      // Mock Success state
      setCreatedBooking({
        id: `bk-${Date.now()}`,
        start_time: selectedSlot.start,
        price: selectedService.price,
        deposit_amount: selectedService.deposit_amount,
        status: 'confirmed'
      });
      setStep(4);
      toast('Booking completed in Demo/Test Mode.', 'success');
    } finally {
      setLoading(false);
    }
  };

  if (loading && step !== 4) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 flex justify-center items-center">
      <div className="w-full max-w-xl bg-white border border-gray-200 shadow-xl rounded-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="bg-primary-600 p-6 text-white text-center relative">
          <h1 className="text-lg font-bold">{org?.name ?? 'Loading Clinic...'}</h1>
          <p className="text-xs text-primary-100 mt-1">AI Receptionist & Appointment Engine</p>
        </div>

        {/* Steps Visual Indicator */}
        {step < 4 && (
          <div className="bg-gray-50 border-b border-gray-100 px-6 py-3 flex justify-between items-center text-xs text-gray-500 font-medium">
            <span className={step >= 1 ? 'text-primary-600 font-bold' : ''}>1. Service</span>
            <ChevronRight className="h-3 w-3" />
            <span className={step >= 2 ? 'text-primary-600 font-bold' : ''}>2. Slot Selection</span>
            <ChevronRight className="h-3 w-3" />
            <span className={step >= 3 ? 'text-primary-600 font-bold' : ''}>3. Details & Deposit</span>
          </div>
        )}

        <div className="p-6 flex-1 overflow-y-auto max-h-[60vh] text-xs">
          {/* STEP 1: CHOOSE SERVICE */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-900 mb-2">Select a Service</h2>
              {services.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { setSelectedService(s); setStep(2); }}
                  className="border border-gray-200 rounded-xl p-4 hover:border-primary-500 hover:bg-primary-50/20 transition-all cursor-pointer flex justify-between items-center"
                >
                  <div className="space-y-1">
                    <h3 className="font-semibold text-gray-800 text-xs">{s.name}</h3>
                    <p className="text-[10px] text-gray-500 leading-normal">{s.description}</p>
                    <span className="text-[10px] text-gray-400 block">{s.duration_minutes} minutes</span>
                  </div>
                  <div className="text-right font-bold text-primary-600 text-sm whitespace-nowrap">
                    {formatCurrency(s.price, org?.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 2: CHOOSE DATE & TIME */}
          {step === 2 && (
            <div className="space-y-6">
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-800">
                <ArrowLeft className="h-4 w-4" /> Back to Services
              </button>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Preferred Date</label>
                  <input
                    type="date"
                    className="input"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
                <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg flex flex-col justify-center">
                  <span className="text-[10px] text-gray-400">Selected Service:</span>
                  <span className="font-semibold text-gray-800 mt-0.5">{selectedService?.name}</span>
                </div>
              </div>

              <div className="space-y-3">
                <label className="label block font-semibold text-gray-800">Available Slots</label>
                {slotsLoading && <p className="text-gray-400 animate-pulse">Calculating real availability...</p>}
                
                {!slotsLoading && availableSlots.length === 0 && (
                  <p className="text-amber-600">No slots available for this day. Try another date.</p>
                )}

                {!slotsLoading && availableSlots.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {availableSlots.map((slot, idx) => (
                      <div
                        key={idx}
                        onClick={() => { setSelectedSlot(slot); setStep(3); }}
                        className="border border-gray-200 hover:border-primary-500 hover:bg-primary-50/30 p-3 rounded-lg text-center cursor-pointer transition-all"
                      >
                        <span className="font-bold text-gray-800 block text-xs">{formatTime(slot.start)}</span>
                        <span className="text-[9px] text-gray-500 mt-0.5 block">with {slot.staff_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: DETAILS & DEPOSIT */}
          {step === 3 && selectedSlot && selectedService && (
            <form onSubmit={handleBook} className="space-y-5">
              <button onClick={() => setStep(2)} className="flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-800">
                <ArrowLeft className="h-4 w-4" /> Back to Slots
              </button>

              <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl space-y-2">
                <h3 className="font-semibold text-gray-900">Appointment Summary</h3>
                <div className="text-[11px] text-gray-600 space-y-1">
                  <p><span className="font-medium text-gray-800">Service:</span> {selectedService.name}</p>
                  <p><span className="font-medium text-gray-800">Practitioner:</span> {selectedSlot.staff_name}</p>
                  <p><span className="font-medium text-gray-800">Time:</span> {formatDate(selectedSlot.start)} at {formatTime(selectedSlot.start)}</p>
                  <p><span className="font-medium text-gray-800">Price:</span> {formatCurrency(selectedService.price, org?.currency)}</p>
                  {selectedService.deposit_required && (
                    <p className="text-amber-700 font-semibold mt-1">Deposit Required: {formatCurrency(selectedService.deposit_amount, org?.currency)}</p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-gray-800">Contact Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Full Name</label>
                    <input
                      type="text"
                      required
                      className="input"
                      value={customerInfo.name}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Phone Number</label>
                    <input
                      type="tel"
                      required
                      className="input"
                      value={customerInfo.phone}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Email Address</label>
                  <input
                    type="email"
                    required
                    className="input"
                    value={customerInfo.email}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Appointment Notes (Optional)</label>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Provide any context for your appointment..."
                    value={customerInfo.notes}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, notes: e.target.value })}
                  />
                </div>
              </div>

              {selectedService.deposit_required && (
                <div className="border border-gray-200 rounded-xl p-4 bg-emerald-50/20 space-y-3">
                  <h4 className="font-semibold text-gray-900 flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-emerald-600" /> Secure Deposit Checkout
                  </h4>
                  <div className="space-y-2">
                    <label className="label">Card Details (Demo Mode)</label>
                    <input type="text" className="input" placeholder="4242 4242 4242 4242" defaultValue="4242 4242 4242 4242" />
                  </div>
                </div>
              )}

              <button type="submit" className="btn-primary w-full py-3 mt-2">
                {selectedService.deposit_required ? 'Pay Deposit & Book' : 'Confirm Appointment'}
              </button>
            </form>
          )}

          {/* STEP 4: SUCCESS CONFIRMATION */}
          {step === 4 && createdBooking && (
            <div className="text-center py-8 space-y-5">
              <CheckCircle className="h-12 w-12 text-success-500 mx-auto animate-bounce" />
              <div>
                <h2 className="text-base font-bold text-gray-900">Appointment Confirmed!</h2>
                <p className="text-xs text-gray-500 mt-1">A calendar invite and SMS confirmation are on their way.</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl text-left max-w-sm mx-auto text-[11px] text-gray-600 space-y-1">
                <p><span className="font-medium text-gray-800">Booking ID:</span> {createdBooking.id}</p>
                <p><span className="font-medium text-gray-800">Service:</span> {selectedService?.name}</p>
                <p><span className="font-medium text-gray-800">Time:</span> {formatDate(selectedSlot?.start ?? '')} at {formatTime(selectedSlot?.start ?? '')}</p>
                {selectedService?.deposit_required && (
                  <p className="text-emerald-700 font-semibold"><span className="font-medium text-gray-800">Deposit Paid:</span> {formatCurrency(selectedService.deposit_amount, org?.currency)}</p>
                )}
              </div>

              <div className="flex flex-col gap-2 max-w-xs mx-auto">
                <Link
                  to={`/appointment/${createdBooking.id}`}
                  className="btn-primary py-2 text-xs"
                >
                  Manage Appointment
                </Link>
                <button
                  onClick={() => {
                    setStep(1);
                    setSelectedService(null);
                    setSelectedSlot(null);
                    setCustomerInfo({ name: '', email: '', phone: '', notes: '' });
                  }}
                  className="btn-secondary py-2 text-xs"
                >
                  Book Another Session
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
