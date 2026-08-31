import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Organization = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  country: string;
  currency: string;
  timezone: string;
  settings: Record<string, unknown>;
  onboarding_completed: boolean;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
};

export type OrganizationMember = {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'manager' | 'staff' | 'read_only';
  created_at: string;
};

export type Location = {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  city: string | null;
  postcode: string | null;
  phone: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  currency: string;
  buffer_before: number;
  buffer_after: number;
  location_type: 'in_person' | 'online';
  deposit_required: boolean;
  deposit_amount: number;
  deposit_type: 'fixed' | 'percentage' | 'full';
  cancellation_policy: string | null;
  cancellation_window_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Staff = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  job_title: string | null;
  location_id: string | null;
  is_active: boolean;
  color: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffHours = {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
};

export type BusinessHours = {
  id: string;
  location_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_open: boolean;
};

export type Customer = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'lead' | 'new' | 'active' | 'returning' | 'inactive';
  tags: string[];
  notes: string | null;
  marketing_consent: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  organization_id: string;
  location_id: string | null;
  customer_id: string;
  service_id: string;
  staff_id: string | null;
  start_time: string;
  end_time: string;
  status: 'pending' | 'confirmed' | 'rescheduled' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
  source: 'manual' | 'ai_chat' | 'ai_voice' | 'online' | 'phone';
  notes: string | null;
  price: number;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
  deposit_amount: number;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  organization_id: string;
  customer_id: string | null;
  channel: 'website' | 'sms' | 'whatsapp' | 'email' | 'voice';
  status: 'open' | 'ai_active' | 'human_required' | 'closed';
  assigned_staff_id: string | null;
  owned_by: 'ai' | 'human';
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'ai' | 'staff' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Payment = {
  id: string;
  organization_id: string;
  booking_id: string | null;
  customer_id: string | null;
  amount: number;
  currency: string;
  type: 'full' | 'deposit' | 'balance';
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  organization_id: string;
  customer_id: string | null;
  booking_id: string | null;
  rating: number;
  comment: string | null;
  is_public: boolean;
  staff_response: string | null;
  status: 'pending' | 'positive' | 'negative' | 'responded';
  created_at: string;
};

export type Automation = {
  id: string;
  organization_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: unknown[];
  actions: unknown[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: string[];
  limits: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
};

export type Document = {
  id: string;
  organization_id: string;
  title: string;
  type: 'faq' | 'policy' | 'service' | 'business_info' | 'document';
  content: string | null;
  category: string | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  organization_id: string;
  user_id: string | null;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type Webhook = {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

export type SupportTicket = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  subject: string;
  description: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
};
