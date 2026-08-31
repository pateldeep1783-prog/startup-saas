import { supabase } from '@/lib/supabase';
import type { Service, StaffHours, BusinessHours } from '@/lib/supabase';

export type Slot = {
  start: string;
  end: string;
  staff_id: string | null;
  staff_name: string | null;
  score: number;
  reason: string;
};

export type AvailabilityInput = {
  organization_id: string;
  location_id?: string;
  service_id: string;
  date: Date;
  staff_id?: string;
  timezone?: string;
};

export async function getAvailableSlots(input: AvailabilityInput): Promise<Slot[]> {
  const { organization_id, location_id, service_id, date, staff_id, timezone } = input;

  const { data: service } = await supabase
    .from('services')
    .select('*')
    .eq('id', service_id)
    .maybeSingle();

  if (!service) return [];

  const duration = service.duration_minutes;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;

  let staffQuery = supabase
    .from('staff')
    .select('id, name, color')
    .eq('organization_id', organization_id)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (staff_id) staffQuery = staffQuery.eq('id', staff_id);

  const { data: staffList } = await staffQuery;

  if (!staffList || staffList.length === 0) return [];

  const locId = location_id;
  let businessHours: BusinessHours[] = [];
  if (locId) {
    const { data: bh } = await supabase
      .from('business_hours')
      .select('*')
      .eq('location_id', locId);
    businessHours = bh || [];
  }

  const dayOfWeek = date.getDay();

  const slots: Slot[] = [];

  for (const staffMember of staffList) {
    const { data: sh } = await supabase
      .from('staff_hours')
      .select('*')
      .eq('staff_id', staffMember.id)
      .eq('day_of_week', dayOfWeek)
      .eq('is_working', true)
      .maybeSingle();

    if (!sh) continue;

    const { data: breaks } = await supabase
      .from('staff_breaks')
      .select('*')
      .eq('staff_id', staffMember.id)
      .eq('day_of_week', dayOfWeek);

    const { data: leave } = await supabase
      .from('staff_leave')
      .select('*')
      .eq('staff_id', staffMember.id)
      .gte('start_date', date.toISOString().split('T')[0])
      .lte('end_date', date.toISOString().split('T')[0]);

    if (leave && leave.length > 0) continue;

    const dateStr = date.toISOString().split('T')[0];

    const dayStart = new Date(`${dateStr}T${sh.start_time}`);
    const dayEnd = new Date(`${dateStr}T${sh.end_time}`);

    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('start_time, end_time')
      .eq('staff_id', staffMember.id)
      .in('status', ['pending', 'confirmed', 'rescheduled', 'checked_in'])
      .gte('start_time', `${dateStr}T00:00:00`)
      .lt('start_time', `${dateStr}T23:59:59`);

    const busyIntervals: { start: Date; end: Date }[] = [];
    if (existingBookings) {
      for (const b of existingBookings) {
        busyIntervals.push({ start: new Date(b.start_time), end: new Date(b.end_time) });
      }
    }
    if (breaks) {
      for (const br of breaks) {
        busyIntervals.push({
          start: new Date(`${dateStr}T${br.start_time}`),
          end: new Date(`${dateStr}T${br.end_time}`),
        });
      }
    }

    const interval = 30;
    let current = new Date(dayStart);

    while (current.getTime() + duration * 60000 <= dayEnd.getTime()) {
      const slotStart = new Date(current);
      const slotEnd = new Date(current.getTime() + duration * 60000);

      const bufferStart = new Date(slotStart.getTime() - bufferBefore * 60000);
      const bufferEnd = new Date(slotEnd.getTime() + bufferAfter * 60000);

      const isConflict = busyIntervals.some(
        (bi) => bufferStart < bi.end && bufferEnd > bi.start
      );

      const now = new Date();
      const minNoticeHours = 2;
      if (slotStart.getTime() < now.getTime() + minNoticeHours * 3600000) {
        current = new Date(current.getTime() + interval * 60000);
        continue;
      }

      if (!isConflict) {
        const hour = slotStart.getHours();
        let score = 50;
        let reason = 'Available';

        if (hour >= 9 && hour < 12) { score += 20; reason = 'Morning slot'; }
        if (hour >= 12 && hour < 14) { score += 5; reason = 'Midday slot'; }
        if (hour >= 14 && hour < 17) { score += 15; reason = 'Afternoon slot'; }

        const workloadScore = (existingBookings?.length || 0);
        score -= workloadScore * 2;

        if (staff_id && staffMember.id === staff_id) { score += 15; reason = 'Preferred staff'; }

        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          staff_id: staffMember.id,
          staff_name: staffMember.name,
          score: Math.max(0, Math.min(100, score)),
          reason,
        });
      }

      current = new Date(current.getTime() + interval * 60000);
    }
  }

  slots.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });

  return slots;
}

export function getRecommendedSlot(slots: Slot[]): Slot | null {
  if (slots.length === 0) return null;
  return slots[0];
}
