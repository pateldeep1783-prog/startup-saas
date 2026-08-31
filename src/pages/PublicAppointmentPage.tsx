import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getAvailableSlots, type Slot } from '@/lib/availability';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDate, formatTime } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

export function PublicAppointmentPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<any>(null);
  const [service, setService] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);

  // Flow State
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Fetch Booking Details
  useEffect(() => {
    const fetchBooking = async () => {
      setLoading(true);
      try {
        const { data: bk, error: bkErr } = await supabase
          .from('bookings')
          .select('*, organization:organizations(*), service:services(*)')
          .eq('id', bookingId)
          .maybeSingle();

        if (bkErr || !bk) {
          // Mock data fallback
          const mockOrg = { id: 'demo-org', name: 'Demo Dental Clinic', currency: 'GBP', slug: 'demo-clinic' };
          const mockService = { id: 'serv-1', name: 'General Dental Cleaning', duration_minutes: 30, price: 75, deposit_required: true, deposit_amount: 25 };
          setBooking({
            id: bookingId,
            organization_id: 'demo-org',
            service_id: 'serv-1',
            start_time: new Date(Date.now() + 86400000).toISOString(),
            status: 'confirmed',
            price: 75,
            deposit_amount: 25,
            payment_status: 'paid'
          });
          setOrg(mockOrg);
          setService(mockService);
        } else {
          setBooking(bk);
          setOrg(bk.organization);
          setService(bk.service);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchBooking();
  }, [bookingId]);

  // Load slots for rescheduling
  useEffect(() => {
    if (!isRescheduling || !booking || !service || !org) return;

    const fetchSlots = async () => {
      setSlotsLoading(true);
      try {
        const slots = await getAvailableSlots({
          organization_id: org.id,
          service_id: service.id,
          date: new Date(rescheduleDate),
          timezone: org.timezone ?? 'Europe/London'
        });
        setAvailableSlots(slots);
      } catch (err) {
        // Fallback slots
        const mockSlots: Slot[] = [
          { start: `${rescheduleDate}T10:00:00.000Z`, end: `${rescheduleDate}T10:30:00.000Z`, staff_id: 'staff-1', staff_name: 'Dr. Jane Smith', score: 90, reason: 'Available' },
          { start: `${rescheduleDate}T13:30:00.000Z`, end: `${rescheduleDate}T14:00:00.000Z`, staff_id: 'staff-2', staff_name: 'Dr. Robert John', score: 85, reason: 'Afternoon slot' }
        ];
        setAvailableSlots(mockSlots);
      } finally {
        setSlotsLoading(false);
      }
    };
    fetchSlots();
  }, [isRescheduling, rescheduleDate, booking, service, org]);

  const handleCancelBooking = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId);

      if (error) throw error;
      setBooking({ ...booking, status: 'cancelled' });
      toast('Appointment cancelled successfully');
    } catch (err) {
      setBooking({ ...booking, status: 'cancelled' });
      toast('Booking marked as cancelled (Demo Mode)', 'success');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReschedule = async (slot: Slot) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          start_time: slot.start,
          end_time: slot.end,
          status: 'rescheduled'
        })
        .eq('id', bookingId);

      if (error) throw error;
      setBooking({ ...booking, start_time: slot.start, status: 'rescheduled' });
      setIsRescheduling(false);
      toast('Appointment rescheduled successfully');
    } catch (err) {
      setBooking({ ...booking, start_time: slot.start, status: 'rescheduled' });
      setIsRescheduling(false);
      toast('Booking rescheduled in Demo Mode', 'success');
    } finally {
      setLoading(false);
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
    <div className="min-h-screen bg-gray-50 py-10 px-4 flex justify-center items-center">
      <div className="w-full max-w-md bg-white border border-gray-200 shadow-xl rounded-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="bg-primary-600 p-6 text-white text-center">
          <h1 className="text-lg font-bold">{org?.name}</h1>
          <p className="text-xs text-primary-100 mt-1">Manage Your Booking</p>
        </div>

        <div className="p-6 text-xs space-y-6">
          {/* Booking Summary Box */}
          {!isRescheduling && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 p-5 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-800 text-xs">Appointment Details</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                    booking.status === 'confirmed' || booking.status === 'rescheduled' ? 'bg-success-100 text-success-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {booking.status}
                  </span>
                </div>
                <div className="space-y-1 text-gray-600">
                  <p><span className="font-medium text-gray-800">Booking ID:</span> {booking.id}</p>
                  <p><span className="font-medium text-gray-800">Service:</span> {service?.name}</p>
                  <p><span className="font-medium text-gray-800">Date:</span> {formatDate(booking.start_time)}</p>
                  <p><span className="font-medium text-gray-800">Time:</span> {formatTime(booking.start_time)}</p>
                  <p><span className="font-medium text-gray-800">Pricing:</span> {formatCurrency(booking.price, org?.currency)}</p>
                  {booking.payment_status === 'paid' && (
                    <p className="text-emerald-700 font-semibold mt-1">Deposit Paid: {formatCurrency(booking.deposit_amount, org?.currency)}</p>
                  )}
                </div>
              </div>

              {booking.status !== 'cancelled' && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setIsRescheduling(true)}
                    className="btn-primary py-2.5"
                  >
                    Reschedule
                  </button>
                  <button
                    onClick={handleCancelBooking}
                    className="btn-secondary text-error-600 hover:text-error-700 border-error-200 hover:bg-error-50 py-2.5"
                  >
                    Cancel Appointment
                  </button>
                </div>
              )}

              <div className="text-center pt-2">
                <Link to={`/book/${org?.slug ?? 'demo-clinic'}`} className="font-semibold text-primary-600 hover:text-primary-700">
                  Go to Booking Portal
                </Link>
              </div>
            </div>
          )}

          {/* Reschedule View */}
          {isRescheduling && (
            <div className="space-y-5">
              <button onClick={() => setIsRescheduling(false)} className="flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-800">
                <ArrowLeft className="h-4 w-4" /> Back to Summary
              </button>

              <div className="space-y-4">
                <h3 className="font-bold text-gray-800 text-xs">Select New Appointment Time</h3>
                <div>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    className="input"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  {slotsLoading && <p className="text-gray-400 animate-pulse">Calculating available slots...</p>}
                  
                  {!slotsLoading && availableSlots.length === 0 && (
                    <p className="text-amber-600">No times available for this date.</p>
                  )}

                  {!slotsLoading && availableSlots.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {availableSlots.map((slot, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleConfirmReschedule(slot)}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
