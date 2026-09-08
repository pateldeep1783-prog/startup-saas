import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { useGoogleLogin } from '@react-oauth/google';
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  ClipboardList,
  Users,
  Bot,
  MessageSquare,
  Scissors,
  UserSquare2,
  Sparkles,
  CreditCard,
  Star,
  BarChart3,
  Settings as SettingsIcon,
  ShieldAlert,
  LogOut,
  Plus,
  Search,
  Filter,
  Phone,
  CheckCircle,
  Clock,
  X,
  ChevronRight,
  RefreshCw,
  Send,
  AlertCircle,
  AlertTriangle,
  Building,
  Globe,
  Mail,
  MessageCircle,
  HelpCircle,
  FileText,
  Check,
  MapPin,
  DollarSign,
  Menu,
  Plug,
  KeyRound,
  Link as LinkIcon
} from 'lucide-react';
import { formatCurrency, formatDate, formatTime, getInitials } from '@/lib/utils';
import { getAvailableSlots, type Slot } from '@/lib/availability';
import { CustomSelect } from '@/components/ui/Select';
import { generateReceptionistResponse } from '@/lib/gemini';

// Define the navigation tabs
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'bookings', label: 'Bookings', icon: ClipboardList },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'ai-receptionist', label: 'AI Receptionist', icon: Bot },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'services', label: 'Services', icon: Scissors },
  { id: 'staff', label: 'Staff', icon: UserSquare2 },
  { id: 'automations', label: 'Automations', icon: Sparkles },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'integrations', label: 'Integrations', icon: Globe },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function Dashboard() {
  const { user, organization, signOut, role, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // States for various lists & filters
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // State to toggle live AI status
  const [aiEnabled, setAiEnabled] = useState(true);

  // Integrations State
  const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>(
    Array.isArray(organization?.settings?.integrations) ? organization?.settings?.integrations : []
  );
  const [selectedIntegration, setSelectedIntegration] = useState<{id:string;name:string;desc:string;category:string} | null>(null);
  const [intContactType, setIntContactType] = useState<'email'|'phone'>('email');
  const [intContactValue, setIntContactValue] = useState('');
  const [intApiKey, setIntApiKey] = useState('');
  const [intAccountId, setIntAccountId] = useState('');

  // Email Integration Module State
  const [emailIntegration, setEmailIntegration] = useState<{
    status: 'connected' | 'disconnected' | 'token_expired' | 'error';
    email_address: string | null;
    last_synced_at: string | null;
    loading: boolean;
    actionLoading: string | null;
  }>({
    status: 'disconnected',
    email_address: null,
    last_synced_at: null,
    loading: true,
    actionLoading: null,
  });

  const fetchEmailIntegrationStatus = async () => {
    if (!organization?.id) return;
    try {
      setEmailIntegration(prev => ({ ...prev, loading: true }));
      const res = await fetch(`http://localhost:3001/api/integrations/email?organization_id=${organization.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmailIntegration({
          status: data.status || 'disconnected',
          email_address: data.email_address || null,
          last_synced_at: data.last_synced_at || null,
          loading: false,
          actionLoading: null,
        });
      } else {
        setEmailIntegration(prev => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error('Failed to fetch email integration status:', err);
      setEmailIntegration(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    fetchEmailIntegrationStatus();

    const params = new URLSearchParams(window.location.search);
    if (params.get('email_connected') === 'true') {
      const email = params.get('email');
      toast(`Successfully connected Gmail: ${email || ''}`, 'success');
      window.history.replaceState({}, document.title, window.location.pathname + '?tab=integrations');
      fetchEmailIntegrationStatus();
    } else if (params.get('error') === 'oauth_denied') {
      toast('Google authorization was denied.', 'error');
      window.history.replaceState({}, document.title, window.location.pathname + '?tab=integrations');
    } else if (params.get('error') === 'oauth_failed') {
      toast(`OAuth authorization failed: ${params.get('message') || ''}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname + '?tab=integrations');
    }
  }, [organization?.id]);

  const handleConnectGmailBackend = async () => {
    if (!organization?.id) {
      toast('Organization not loaded yet', 'error');
      return;
    }
    try {
      setEmailIntegration(prev => ({ ...prev, actionLoading: 'connecting' }));
      const res = await fetch(`http://localhost:3001/api/integrations/email/gmail/connect?organization_id=${organization.id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to initiate OAuth');
      }
      const data = await res.json();
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        throw new Error('Authorization URL missing');
      }
    } catch (err: any) {
      setEmailIntegration(prev => ({ ...prev, actionLoading: null }));
      toast(err.message || 'Unable to connect Gmail. Please try again.', 'error');
    }
  };

  const handleSyncGmailBackend = async () => {
    if (!organization?.id) return;
    try {
      setEmailIntegration(prev => ({ ...prev, actionLoading: 'syncing' }));
      const res = await fetch('http://localhost:3001/api/integrations/email/gmail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organization.id })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Sync failed');
      }
      const data = await res.json();
      setEmailIntegration({
        status: 'connected',
        email_address: data.emailAddress,
        last_synced_at: data.last_synced_at,
        loading: false,
        actionLoading: null,
      });
      toast(`Mailbox synced successfully! (${data.messageCount || 0} messages checked)`, 'success');
    } catch (err: any) {
      setEmailIntegration(prev => ({ ...prev, actionLoading: null }));
      toast(err.message || 'Mailbox sync failed. Please try again.', 'error');
    }
  };

  const handleDisconnectGmailBackend = async () => {
    if (!organization?.id) return;
    try {
      setEmailIntegration(prev => ({ ...prev, actionLoading: 'disconnecting' }));
      const res = await fetch(`http://localhost:3001/api/integrations/email/gmail?organization_id=${organization.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Disconnect failed');
      }
      setEmailIntegration({
        status: 'disconnected',
        email_address: null,
        last_synced_at: null,
        loading: false,
        actionLoading: null,
      });
      toast('Gmail connection disconnected.', 'success');
    } catch (err: any) {
      setEmailIntegration(prev => ({ ...prev, actionLoading: null }));
      toast(err.message || 'Failed to disconnect Gmail.', 'error');
    }
  };


  // Available Integrations Definitions
  const INTEGRATION_DEFINITIONS = [
    { id: 'google_calendar', name: 'Google Calendar', desc: 'Sync availability and bookings', category: 'Calendar' },
    { id: 'outlook', name: 'Microsoft Outlook', desc: 'Sync with Outlook calendar', category: 'Calendar' },
    { id: 'stripe', name: 'Stripe', desc: 'Accept payments and deposits', category: 'Payments' },
    { id: 'email', name: 'Email', desc: 'Send confirmations and reminders', category: 'Messaging' },
    { id: 'sms', name: 'SMS', desc: 'Text message notifications', category: 'Messaging' },
    { id: 'whatsapp', name: 'WhatsApp', desc: 'WhatsApp Business messaging', category: 'Messaging' },
    { id: 'voice', name: 'Voice AI', desc: 'AI answers phone calls', category: 'Voice' },
    { id: 'hubspot', name: 'HubSpot', desc: 'CRM sync', category: 'CRM' },
    { id: 'zapier', name: 'Zapier', desc: 'Connect to 5000+ apps', category: 'Automation' },
  ];
  const INTEGRATION_CATEGORIES = [...new Set(INTEGRATION_DEFINITIONS.map(i => i.category))];

  // Test Email Modal State
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailFrom, setTestEmailFrom] = useState('rahul.patel@gmail.com');
  const [testEmailName, setTestEmailName] = useState('Rahul Patel');
  const [testEmailSubject, setTestEmailSubject] = useState('Appointment Booking Request');
  const [testEmailBody, setTestEmailBody] = useState('Hello! I would like to book an appointment for tomorrow at 10:00 AM. Please confirm.');
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<any>(null);

  // Manual Booking Modal
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [bookingDetailOpen, setBookingDetailOpen] = useState(false);

  // AI Receptionist Settings State
  const [aiSettings, setAiSettings] = useState({
    name: 'Sarah',
    greeting: "Hi! I'm here to help you book an appointment. How can I assist you today?",
    instructions: "Always be polite. Recommend morning slots first. Do not promise discounts unless configured. Support human escalation for refunds."
  });

  const [playgroundMessages, setPlaygroundMessages] = useState<any[]>([
    { sender: 'ai', text: aiSettings.greeting }
  ]);
  const [playgroundInput, setPlaygroundInput] = useState('');

  async function handleSendTestEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!organization) return;
    setTestEmailLoading(true);
    setTestEmailResult(null);

    try {
      const res = await fetch('http://localhost:3001/api/incoming-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          from: testEmailFrom,
          fromName: testEmailName,
          subject: testEmailSubject,
          body: testEmailBody
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process email');

      setTestEmailResult(data);
      toast('Email processed by Reception AI! Booking created in database.', 'success');

      fetchDashboardData();
    } catch (err: any) {
      toast(err.message || 'Error processing email', 'error');
    } finally {
      setTestEmailLoading(false);
    }
  }

  async function handleIntegrationConnect() {
    if (!selectedIntegration) return;
    const emailOrPhone = intContactValue.trim() || user?.email || 'reception@clinic.com';

    if (selectedIntegration.id === 'email') {
      try {
        if (organization) {
          await fetch('http://localhost:3001/api/connect-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId: organization.id, email: emailOrPhone })
          });
        }
      } catch (e) {
        console.error('API connect email error', e);
      }
    }

    const newList = Array.from(new Set([...connectedIntegrations, selectedIntegration.id]));
    setConnectedIntegrations(newList);
    if (organization) {
      await supabase.from('organizations').update({ settings: { ...organization.settings, integrations: newList } }).eq('id', organization.id);
    }
    toast(`${selectedIntegration.name} connected successfully! AI Receptionist active.`, 'success');
    setSelectedIntegration(null);
    setIntContactValue('');
    setIntApiKey('');
    setIntAccountId('');
  }

  async function handleIntegrationDisconnect(id: string, name: string) {
    const newList = connectedIntegrations.filter(x => x !== id);
    setConnectedIntegrations(newList);
    if (organization) {
      await supabase.from('organizations').update({ settings: { ...organization.settings, integrations: newList } }).eq('id', organization.id);
    }
    toast(`${name} disconnected.`, 'success');
  }
  const [isPlaygroundTyping, setIsPlaygroundTyping] = useState(false);

  // Redirect to login if user not logged in
  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  // Redirect to onboarding if user has no org OR onboarding not completed
  useEffect(() => {
    // If super admin, send to super admin panel
    if (isSuperAdmin) {
      navigate('/super-admin');
      return;
    }
    
    // Normal users must have an organization
    if (user && (!organization || !organization.onboarding_completed)) {
      navigate('/onboarding');
    }
  }, [user, organization, isSuperAdmin, navigate]);

  // Load real or seed fallback data
  useEffect(() => {
    if (!organization) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // Fetch locations
        const { data: locs, error: locsErr } = await supabase
          .from('locations')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentLocs = locs && locs.length > 0 ? locs : [
          { id: 'loc-1', name: 'Main Clinic', address: '100 Medical Plaza, London', timezone: 'Europe/London', is_active: true }
        ];
        setLocations(currentLocs);
        setSelectedLocation(currentLocs[0]);

        // Fetch services
        const { data: servs } = await supabase
          .from('services')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentServices = servs && servs.length > 0 ? servs : [
          { id: 'serv-1', name: 'Initial Consultation', duration_minutes: 30, price: 75, buffer_before: 5, buffer_after: 5, deposit_required: true, deposit_amount: 25, is_active: true, description: 'General diagnosis and assessment consultation.' },
          { id: 'serv-2', name: 'Standard Treatment', duration_minutes: 45, price: 120, buffer_before: 10, buffer_after: 10, deposit_required: false, deposit_amount: 0, is_active: true, description: 'Standard treatment session.' },
          { id: 'serv-3', name: 'Emergency Clinic visit', duration_minutes: 60, price: 200, buffer_before: 15, buffer_after: 15, deposit_required: true, deposit_amount: 50, is_active: true, description: 'Urgent emergency consultation.' }
        ];
        setServices(currentServices);

        // Fetch staff
        const { data: st } = await supabase
          .from('staff')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentStaff = st && st.length > 0 ? st : [
          { id: 'staff-1', name: 'Dr. Jane Smith', email: 'jane.smith@receptionai.com', role: 'practitioner', job_title: 'Lead Specialist', is_active: true, color: '#3b82f6' },
          { id: 'staff-2', name: 'Dr. Robert John', email: 'robert.john@receptionai.com', role: 'practitioner', job_title: 'Associate Therapist', is_active: true, color: '#14b8a6' },
          { id: 'staff-3', name: 'Sarah Connor', email: 'sarah.c@receptionai.com', role: 'staff', job_title: 'Clinic Manager', is_active: true, color: '#f59e0b' }
        ];
        setStaff(currentStaff);

        // Fetch customers
        const { data: custs } = await supabase
          .from('customers')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentCustomers = custs && custs.length > 0 ? custs : [
          { id: 'cust-1', name: 'John Doe', email: 'john.doe@example.com', phone: '+44 7700 900077', status: 'returning', tags: ['VIP', 'Returning'], notes: 'Prefers morning slots.' },
          { id: 'cust-2', name: 'Emma Watson', email: 'emma.w@example.com', phone: '+44 7700 900088', status: 'active', tags: ['Regular'], notes: 'Needs accessible parking.' },
          { id: 'cust-3', name: 'Michael Brown', email: 'michael.b@example.com', phone: '+1 555-0199', status: 'new', tags: ['New Lead'], notes: 'Found us via Google Maps.' }
        ];
        setCustomers(currentCustomers);

        // Fetch bookings
        const { data: bks } = await supabase
          .from('bookings')
          .select('*')
          .eq('organization_id', organization.id)
          .order('start_time', { ascending: false });

        const currentBookings = bks && bks.length > 0 ? bks : [
          { id: 'bk-1', customer_id: 'cust-1', service_id: 'serv-1', staff_id: 'staff-1', start_time: new Date(Date.now() + 86400000 * 1).toISOString().split('T')[0] + 'T10:00:00.000Z', end_time: new Date(Date.now() + 86400000 * 1).toISOString().split('T')[0] + 'T10:30:00.000Z', status: 'confirmed', price: 75, payment_status: 'paid', deposit_amount: 25 },
          { id: 'bk-2', customer_id: 'cust-2', service_id: 'serv-2', staff_id: 'staff-2', start_time: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0] + 'T14:30:00.000Z', end_time: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0] + 'T15:15:00.000Z', status: 'confirmed', price: 120, payment_status: 'pending', deposit_amount: 0 },
          { id: 'bk-3', customer_id: 'cust-3', service_id: 'serv-1', staff_id: 'staff-1', start_time: new Date(Date.now() - 86400000 * 1).toISOString().split('T')[0] + 'T11:00:00.000Z', end_time: new Date(Date.now() - 86400000 * 1).toISOString().split('T')[0] + 'T11:30:00.000Z', status: 'completed', price: 75, payment_status: 'paid', deposit_amount: 25 },
          { id: 'bk-4', customer_id: 'cust-1', service_id: 'serv-3', staff_id: 'staff-2', start_time: new Date(Date.now() - 86400000 * 3).toISOString().split('T')[0] + 'T09:00:00.000Z', end_time: new Date(Date.now() - 86400000 * 3).toISOString().split('T')[0] + 'T10:00:00.000Z', status: 'no_show', price: 200, payment_status: 'failed', deposit_amount: 50 }
        ];
        setBookings(currentBookings);

        // Fetch conversations
        const { data: convs } = await supabase
          .from('conversations')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentConversations = convs && convs.length > 0 ? convs : [
          { id: 'conv-1', customer_id: 'cust-1', channel: 'website', status: 'ai_active', last_message: 'Yes, 10:00 AM on tomorrow works for me. Please book it.', last_message_at: new Date().toISOString() },
          { id: 'conv-2', customer_id: 'cust-2', channel: 'whatsapp', status: 'human_required', last_message: 'Hi, I need a refund on my last booking cancellation.', last_message_at: new Date(Date.now() - 1000000).toISOString() },
          { id: 'conv-3', customer_id: 'cust-3', channel: 'sms', status: 'closed', last_message: 'Thanks for scheduling!', last_message_at: new Date(Date.now() - 86400000).toISOString() }
        ];
        setConversations(currentConversations);

        // Reviews
        const { data: revs } = await supabase
          .from('reviews')
          .select('*')
          .eq('organization_id', organization.id);
        
        const currentReviews = revs && revs.length > 0 ? revs : [
          { id: 'rev-1', customer_id: 'cust-1', rating: 5, comment: 'Sarah was amazing. Super quick scheduling through the web receptionist!', status: 'positive', created_at: new Date(Date.now() - 86400000).toISOString() },
          { id: 'rev-2', customer_id: 'cust-2', rating: 4, comment: 'Clean facilities and friendly staff. Would recommend.', status: 'positive', created_at: new Date(Date.now() - 172800000).toISOString() }
        ];
        setReviews(currentReviews);

        // Activities feed
        const dummyActivities = [
          { id: 'act-1', type: 'booking', text: 'New booking confirmed for John Doe (Initial Consultation)', time: new Date(Date.now() - 600000).toISOString() },
          { id: 'act-2', type: 'conversation', text: 'Sarah (AI) answered query from Michael Brown', time: new Date(Date.now() - 1800000).toISOString() },
          { id: 'act-3', type: 'payment', text: 'Stripe deposit of £25.00 received from Emma Watson', time: new Date(Date.now() - 3600000).toISOString() },
          { id: 'act-4', type: 'review', text: '5-star review received from John Doe', time: new Date(Date.now() - 7200000).toISOString() }
        ];
        setActivities(dummyActivities);

      } catch (err: any) {
        console.error('Error loading dashboard data:', err);
        toast('Error connection to Database. Displaying fallback Demo Mode data.', 'info');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [organization, dataVersion]);

  const handleLogout = async () => {
    await signOut();
    toast('Logged out successfully');
    navigate('/login');
  };

  const handleToggleAI = () => {
    setAiEnabled(!aiEnabled);
    toast(aiEnabled ? 'AI Receptionist disabled' : 'AI Receptionist enabled & working 24/7');
  };

  // Helper selectors
  const getCustomerName = (id: string) => customers.find((c) => c.id === id)?.name ?? 'Unknown Customer';
  const getCustomerPhone = (id: string) => customers.find((c) => c.id === id)?.phone ?? '';
  const getServiceName = (id: string) => services.find((s) => s.id === id)?.name ?? 'Unknown Service';
  const getStaffName = (id: string) => staff.find((s) => s.id === id)?.name ?? 'Auto-Assign';

  // Manual booking form handler
  const [newBooking, setNewBooking] = useState({
    customerId: '',
    serviceId: '',
    staffId: '',
    date: new Date().toISOString().split('T')[0],
    time: '10:00'
  });

  const handleCreateBooking = async (e: any) => {
    e.preventDefault();
    if (!newBooking.customerId || !newBooking.serviceId) {
      toast('Please select customer and service', 'error');
      return;
    }
    const service = services.find((s) => s.id === newBooking.serviceId);
    const start_time = `${newBooking.date}T${newBooking.time}:00.000Z`;
    const end_time = new Date(new Date(start_time).getTime() + (service?.duration_minutes ?? 30) * 60000).toISOString();

    const bookingPayload = {
      organization_id: organization?.id ?? 'demo-org',
      location_id: selectedLocation?.id ?? 'loc-1',
      customer_id: newBooking.customerId,
      service_id: newBooking.serviceId,
      staff_id: newBooking.staffId || null,
      start_time,
      end_time,
      status: 'confirmed',
      source: 'manual',
      price: service?.price ?? 0,
      payment_status: 'pending',
      deposit_amount: service?.deposit_amount ?? 0
    };

    try {
      const { error } = await supabase.from('bookings').insert(bookingPayload);
      if (error) throw error;
      toast('Booking created successfully');
      setBookingModalOpen(false);
      setDataVersion((v) => v + 1);
    } catch (err: any) {
      // Fallback local save
      const localBooking = { id: `bk-${Date.now()}`, ...bookingPayload };
      setBookings([localBooking, ...bookings]);
      setBookingModalOpen(false);
      toast('Saved booking locally (Demo Mode)', 'success');
    }
  };

  const handleUpdateBookingStatus = async (bookingId: string, newStatus: string) => {
    try {
      const { error } = await supabase.from('bookings').update({ status: newStatus }).eq('id', bookingId);
      if (error) throw error;
      toast(`Booking marked as ${newStatus}`);
      setBookingDetailOpen(false);
      setDataVersion((v) => v + 1);
    } catch (err: any) {
      setBookings(bookings.map((b) => b.id === bookingId ? { ...b, status: newStatus } : b));
      setBookingDetailOpen(false);
      toast(`Saved status locally (Demo Mode)`, 'success');
    }
  };

  // Real chatbot response generator for playground
  const handlePlaygroundSend = async () => {
    if (!playgroundInput.trim()) return;

    const userMsg = { sender: 'customer', text: playgroundInput };
    const newMessages = [...playgroundMessages, userMsg];
    setPlaygroundMessages(newMessages);
    setPlaygroundInput('');
    setIsPlaygroundTyping(true);

    try {
      const context = {
        name: organization?.name ?? 'Business',
        industry: organization?.industry ?? 'Service',
        services: services,
        aiName: aiSettings.name,
        customInstructions: aiSettings.instructions,
        onBookingCallback: async (details: any) => {
          if (!organization) return "Error: No organization found.";
          // 1. Find or create customer
          let customerId;
          const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('organization_id', organization.id)
            .eq('email', details.customer_email)
            .single();
            
          if (existing) {
            customerId = existing.id;
          } else {
            const { data: newCust, error: custErr } = await supabase
              .from('customers')
              .insert({
                organization_id: organization.id,
                name: details.customer_name,
                email: details.customer_email,
                status: 'lead'
              }).select().single();
            if (custErr) throw custErr;
            customerId = newCust.id;
          }
          
          // 2. Find service
          const service = services.find(s => 
            s.name.toLowerCase().includes(details.service_name.toLowerCase()) || 
            details.service_name.toLowerCase().includes(s.name.toLowerCase())
          );
          if (!service) return "Error: Could not match the requested service.";
          
          // 3. Create booking
          const start = new Date(`${details.date} ${details.time}`);
          if (isNaN(start.getTime())) return "Error: Invalid date/time format provided.";
          const end = new Date(start.getTime() + service.duration_minutes * 60000);
          
          const { error: bookErr } = await supabase
            .from('bookings')
            .insert({
              organization_id: organization.id,
              customer_id: customerId,
              service_id: service.id,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              status: 'pending',
              source: 'ai_chat',
              price: service.price
            });
            
          if (bookErr) throw bookErr;
          
          // Force UI refresh
          setDataVersion(v => v + 1);
          
          return "Success! Booking created in the database.";
        }
      };
      
      const aiResponse = await generateReceptionistResponse(
        playgroundMessages, 
        context, 
        playgroundInput
      );

      setPlaygroundMessages((prev) => [...prev, { sender: 'ai', text: aiResponse }]);
    } catch (error) {
      console.error(error);
      setPlaygroundMessages((prev) => [...prev, { sender: 'ai', text: "I'm having trouble connecting to my brain right now. Please try again!" }]);
    } finally {
      setIsPlaygroundTyping(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row relative">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 px-6 border-b border-gray-100 flex items-center gap-3">
          <div className="h-9 w-9 bg-primary-600 rounded-lg flex items-center justify-center text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 leading-tight">ReceptionAI</h1>
            <span className="text-xs text-primary-600 font-medium">B2B Operating OS</span>
          </div>
        </div>

        {/* User Info & Quick Selector */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
              {getInitials(user?.email ?? 'Staff Member')}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-gray-800 truncate">{organization?.name ?? '...'}</p>
              <p className="text-[10px] text-gray-500 capitalize">{role ?? 'owner'}</p>
            </div>
          </div>
          <select
            className="w-full text-xs bg-white border border-gray-200 rounded p-1.5 focus:ring-1 focus:ring-primary-500"
            value={selectedLocation?.id ?? ''}
            onChange={(e) => setSelectedLocation(locations.find(l => l.id === e.target.value))}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false); // Close menu on tab click on mobile
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  isTabActive
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-error-600 hover:text-error-700 font-semibold"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
          <div className="text-[10px] text-gray-400 font-mono">v1.2.0</div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="flex-1 flex flex-col min-w-0 min-h-screen lg:w-[calc(100%-16rem)]">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-gray-100 px-4 sm:px-6 flex items-center justify-between z-10 flex-shrink-0 sticky top-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-gray-800 capitalize hidden sm:inline-block">{activeTab.replace('-', ' ')}</span>
            <span className="text-gray-300 hidden sm:inline-block">/</span>
            <span className="text-xs font-medium sm:font-normal text-gray-800 sm:text-gray-500 truncate max-w-[120px] sm:max-w-none">{selectedLocation?.name}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Live AI Status Widget */}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">
              <span className={`h-2.5 w-2.5 rounded-full ${aiEnabled ? 'bg-success-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-xs font-medium text-gray-700">AI Front Desk: {aiEnabled ? 'Live' : 'Off'}</span>
              <button
                onClick={handleToggleAI}
                className="text-[10px] ml-2 px-2 py-0.5 rounded bg-primary-100 hover:bg-primary-200 text-primary-700 font-bold transition-colors"
              >
                Toggle
              </button>
            </div>

            <button
              onClick={() => setBookingModalOpen(true)}
              className="btn-primary flex items-center gap-1.5 py-1.5 px-2 sm:px-3 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Book Appointment</span>
            </button>
          </div>
        </header>

        {/* Dashboard Pages Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-8 w-8 text-primary-600 animate-spin" />
            </div>
          )}

          {!loading && (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'dashboard' && (
                <div className="space-y-6">
                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: "Today's Appointments", val: bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show').length, color: 'text-primary-600' },
                      { label: "AI Receptionist Attributed", val: `${Math.round((bookings.length / (bookings.length + 1)) * 100)}%`, color: 'text-success-600' },
                      { label: "Monthly Revenue", val: formatCurrency(bookings.filter(b => b.payment_status === 'paid').reduce((a, b) => a + b.price, 0), organization?.currency), color: 'text-indigo-600' },
                      { label: "Active AI Sessions", val: conversations.filter(c => c.status === 'ai_active').length, color: 'text-amber-600' }
                    ].map((card, idx) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                        <p className="text-xs text-gray-500 font-medium">{card.label}</p>
                        <h3 className={`text-2xl font-bold mt-2 ${card.color}`}>{card.val}</h3>
                      </div>
                    ))}
                  </div>

                  {/* Main content grid */}
                  <div className="grid lg:grid-cols-3 gap-6">
                    {/* Left: Quick Overview List */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-gray-900">Upcoming Appointments</h3>
                          <button onClick={() => setActiveTab('calendar')} className="text-xs text-primary-600 font-semibold hover:underline">View Calendar</button>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {bookings.slice(0, 4).map((bk) => (
                            <div key={bk.id} className="p-4 flex items-center justify-between hover:bg-gray-50/50">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-800">{getCustomerName(bk.customer_id)}</h4>
                                <p className="text-[10px] text-gray-500 mt-0.5">{getServiceName(bk.service_id)} with {getStaffName(bk.staff_id)}</p>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] font-semibold text-gray-800 block">{formatDate(bk.start_time)}</span>
                                <span className="text-[10px] text-gray-500 mt-0.5 block">{formatTime(bk.start_time)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right: Live Activity Feed */}
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
                      <div className="flow-root">
                        <ul className="-mb-8">
                          {activities.map((act, actIdx) => (
                            <li key={act.id}>
                              <div className="relative pb-8">
                                {actIdx !== activities.length - 1 ? (
                                  <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                                ) : null}
                                <div className="relative flex space-x-3">
                                  <div>
                                    <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${
                                      act.type === 'booking' ? 'bg-primary-50 text-primary-600' :
                                      act.type === 'payment' ? 'bg-success-500/10 text-success-600' :
                                      act.type === 'conversation' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-600'
                                    }`}>
                                      {act.type === 'booking' && <CalendarIcon className="h-4 w-4" />}
                                      {act.type === 'payment' && <CreditCard className="h-4 w-4" />}
                                      {act.type === 'conversation' && <MessageSquare className="h-4 w-4" />}
                                      {act.type === 'review' && <Star className="h-4 w-4" />}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                                    <div>
                                      <p className="text-xs text-gray-800">{act.text}</p>
                                    </div>
                                    <div className="text-right text-[10px] whitespace-nowrap text-gray-400">
                                      <time dateTime={act.time}>{new Date(act.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CALENDAR */}
              {activeTab === 'calendar' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-6">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Appointment Calendar</h2>
                      <p className="text-xs text-gray-500">Manage bookings across staff schedules</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded">Week</button>
                      <button className="px-3 py-1 hover:bg-gray-100 text-gray-600 text-xs font-medium rounded">Month</button>
                      <button className="px-3 py-1 hover:bg-gray-100 text-gray-600 text-xs font-medium rounded">Day</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden text-center text-xs">
                    {/* Header days */}
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                      <div key={d} className="bg-gray-50 py-2 font-semibold text-gray-700">{d}</div>
                    ))}
                    
                    {/* Month Slots */}
                    {Array.from({ length: 28 }).map((_, idx) => {
                      const dayNumber = idx + 1;
                      const dayBookings = bookings.filter(b => new Date(b.start_time).getDate() === dayNumber);
                      
                      return (
                        <div key={idx} className="bg-white min-h-[100px] p-2 text-left flex flex-col justify-between border-t border-r border-gray-100">
                          <span className="font-semibold text-gray-400 text-[10px]">{dayNumber}</span>
                          <div className="space-y-1 mt-1 flex-1 overflow-y-auto">
                            {dayBookings.map(b => (
                              <div
                                key={b.id}
                                onClick={() => { setSelectedBooking(b); setBookingDetailOpen(true); }}
                                className="px-1.5 py-0.5 rounded text-[8px] font-semibold truncate cursor-pointer bg-primary-50 text-primary-700 border-l-2 border-primary-500"
                              >
                                {formatTime(b.start_time)} {getCustomerName(b.customer_id)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: BOOKINGS */}
              {activeTab === 'bookings' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-base font-bold text-gray-900">Bookings Directory</h2>
                    <span className="text-xs bg-gray-100 text-gray-600 font-medium px-2 py-0.5 rounded-full">{bookings.length} Total</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                          <th className="p-4">Customer</th>
                          <th className="p-4">Service</th>
                          <th className="p-4">Staff Member</th>
                          <th className="p-4">Start Time</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Payment</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bookings.map((bk) => (
                          <tr key={bk.id} className="hover:bg-gray-50/50">
                            <td className="p-4">
                              <span className="font-semibold text-gray-800 block">{getCustomerName(bk.customer_id)}</span>
                              <span className="text-[10px] text-gray-500 mt-0.5 block">{getCustomerPhone(bk.customer_id)}</span>
                            </td>
                            <td className="p-4">{getServiceName(bk.service_id)}</td>
                            <td className="p-4">{getStaffName(bk.staff_id)}</td>
                            <td className="p-4">
                              <span className="font-semibold text-gray-800 block">{formatDate(bk.start_time)}</span>
                              <span className="text-[10px] text-gray-500 mt-0.5 block">{formatTime(bk.start_time)}</span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                bk.status === 'confirmed' ? 'bg-success-100 text-success-700' :
                                bk.status === 'completed' ? 'bg-primary-100 text-primary-700' :
                                bk.status === 'no_show' ? 'bg-error-100 text-error-700' : 'bg-gray-100 text-gray-700'
                              }`}>
                                {bk.status}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                bk.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                              }`}>
                                {bk.payment_status}
                              </span>
                            </td>
                            <td className="p-4">
                              <button
                                onClick={() => { setSelectedBooking(bk); setBookingDetailOpen(true); }}
                                className="text-xs text-primary-600 hover:text-primary-700 font-semibold"
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: CUSTOMERS (CRM) */}
              {activeTab === 'customers' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Customer CRM</h2>
                      <p className="text-xs text-gray-500">Manage client directory, records, and preferences</p>
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 border-r border-gray-100 pr-6 space-y-4">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Client List</h3>
                      <div className="space-y-2">
                        {customers.map((c) => (
                          <div key={c.id} className="p-3 bg-gray-50 rounded-lg hover:bg-primary-50 hover:text-primary-800 transition-colors cursor-pointer">
                            <span className="font-semibold text-xs text-gray-900 block">{c.name}</span>
                            <span className="text-[10px] text-gray-500 mt-0.5 block">{c.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-2 space-y-6">
                      <div className="bg-gray-50 rounded-xl p-6">
                        <h3 className="text-sm font-bold text-gray-900 mb-4">Customer profile: {customers[0]?.name}</h3>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-gray-400 block">Email Address</span>
                            <span className="font-medium text-gray-900 block mt-1">{customers[0]?.email}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Phone Number</span>
                            <span className="font-medium text-gray-900 block mt-1">{customers[0]?.phone}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Customer Status</span>
                            <span className="font-medium text-gray-900 block mt-1 capitalize">{customers[0]?.status}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Notes & Preferences</span>
                            <span className="font-medium text-gray-900 block mt-1">{customers[0]?.notes ?? 'No notes added'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: AI RECEPTIONIST */}
              {activeTab === 'ai-receptionist' && (
                <div className="space-y-6">
                  <div className="grid lg:grid-cols-2 gap-6">
                    {/* Left: AI Settings */}
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                      <h2 className="text-base font-bold text-gray-900">AI receptionist Settings</h2>
                      <div className="space-y-4 text-xs">
                        <div>
                          <label className="label">AI Assistant Name</label>
                          <input 
                            type="text" 
                            className="input" 
                            value={aiSettings.name}
                            onChange={(e) => setAiSettings({ ...aiSettings, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">Greeting Message</label>
                          <textarea 
                            className="input" 
                            rows={3} 
                            value={aiSettings.greeting}
                            onChange={(e) => setAiSettings({ ...aiSettings, greeting: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">System Training Instructions</label>
                          <textarea 
                            className="input" 
                            rows={4} 
                            value={aiSettings.instructions}
                            onChange={(e) => setAiSettings({ ...aiSettings, instructions: e.target.value })}
                          />
                        </div>
                        <button 
                          className="btn-primary w-full py-2"
                          onClick={() => {
                            setPlaygroundMessages([{ sender: 'ai', text: aiSettings.greeting }]);
                            toast('AI settings saved and playground reset!');
                          }}
                        >
                          Save Instructions
                        </button>
                      </div>
                    </div>

                    {/* Right: Playground Chat Widget Sandbox */}
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-[500px]">
                      <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                        <Bot className="h-5 w-5 text-primary-600 animate-bounce" />
                        <div>
                          <h3 className="text-xs font-semibold text-gray-800">{aiSettings.name} Sandbox Playground</h3>
                          <p className="text-[10px] text-gray-500">Test how the receptionist responds</p>
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 rounded-lg mt-4 text-xs">
                        {playgroundMessages.map((msg, idx) => (
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
                        {isPlaygroundTyping && (
                          <div className="flex justify-start">
                            <div className="p-3 bg-white border border-gray-200 text-gray-400 rounded-lg rounded-tl-none animate-pulse">
                              Sarah is typing...
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Playground Input */}
                      <div className="mt-4 flex gap-2">
                        <input
                          type="text"
                          className="input flex-1 text-xs"
                          placeholder="Type 'i want to book tomorrow morning'..."
                          value={playgroundInput}
                          onChange={(e) => setPlaygroundInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handlePlaygroundSend()}
                        />
                        <button onClick={handlePlaygroundSend} className="btn-primary p-2">
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: CONVERSATIONS */}
              {activeTab === 'conversations' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm h-[600px] flex">
                  {/* Left: Chat list */}
                  <div className="w-1/3 border-r border-gray-100 flex flex-col">
                    <div className="p-4 border-b border-gray-100 font-bold text-xs text-gray-800">Unified Inbox</div>
                    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                      {conversations.map((c) => (
                        <div key={c.id} className="p-4 hover:bg-gray-50/50 cursor-pointer text-xs">
                          <div className="flex justify-between font-semibold text-gray-800">
                            <span>{getCustomerName(c.customer_id)}</span>
                            <span className="text-[10px] text-gray-400 capitalize">{c.channel}</span>
                          </div>
                          <p className="text-[10px] text-gray-500 truncate mt-1">{c.last_message}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Message Screen */}
                  <div className="flex-1 flex flex-col bg-gray-50/50">
                    <div className="h-12 bg-white border-b border-gray-100 px-6 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800">Chat Session: {getCustomerName(conversations[0]?.customer_id)}</span>
                      <button className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded">Take Over Manually</button>
                    </div>
                    <div className="flex-1 p-6 space-y-4 overflow-y-auto text-xs">
                      <div className="flex justify-start">
                        <div className="p-3 bg-white rounded-lg border border-gray-100 max-w-md">Hi Emma! How can I help you?</div>
                      </div>
                      <div className="flex justify-end">
                        <div className="p-3 bg-primary-600 text-white rounded-lg max-w-md">Can I reschedule my appointment?</div>
                      </div>
                    </div>
                    <div className="p-4 bg-white border-t border-gray-100 flex gap-2">
                      <input type="text" className="input flex-1 text-xs" placeholder="Reply to customer..." />
                      <button className="btn-primary p-2"><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: SERVICES */}
              {activeTab === 'services' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Services Configuration</h2>
                      <p className="text-xs text-gray-500">Add or edit services provided by the business</p>
                    </div>
                    <button className="btn-primary flex items-center gap-1.5 py-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" /> Add Service
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {services.map((s) => (
                      <div key={s.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                        <div>
                          <h3 className="font-bold text-gray-800 text-xs">{s.name}</h3>
                          <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                        </div>
                        <div className="mt-4 border-t border-gray-100 pt-4 flex items-center justify-between text-xs font-semibold text-gray-900">
                          <span>{s.duration_minutes} mins</span>
                          <span>{formatCurrency(s.price, organization?.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 8: STAFF */}
              {activeTab === 'staff' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Staff Management</h2>
                      <p className="text-xs text-gray-500">Configure team rosters and availability schedules</p>
                    </div>
                    <button className="btn-primary flex items-center gap-1.5 py-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" /> Add Staff
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {staff.map((st) => (
                      <div key={st.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow bg-white flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-white text-xs" style={{ backgroundColor: st.color || '#3b82f6' }}>
                          {getInitials(st.name)}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-800 text-xs">{st.name}</h3>
                          <p className="text-[10px] text-gray-500 mt-0.5">{st.job_title}</p>
                          <span className="text-[9px] font-semibold text-primary-600 block mt-1">{st.email}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 9: AUTOMATIONS */}
              {activeTab === 'automations' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Automation Engine</h2>
                      <p className="text-xs text-gray-500">Deploy automated alerts, triggers, and follow-ups</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6 text-xs">
                    {[
                      { name: '24-Hour Confirmation Reminder', trigger: '24 hours before appointment start', action: 'Send Confirmation SMS + Email template', active: true },
                      { name: 'Review Acquisition Campaign', trigger: '2 hours after appointment marked as completed', action: 'Request Review; route negative comments to internal team', active: true },
                      { name: 'No-Show Recovery Trigger', trigger: 'Immediately when appointment marked no_show', action: 'Launch AI follow-up message to reschedule', active: true },
                      { name: 'Unconfirmed Booking Follow-up', trigger: '6 hours after booking remains pending', action: 'Send reminder notice link', active: false }
                    ].map((aut, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-xl p-5 bg-white space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-gray-800">{aut.name}</h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${aut.active ? 'bg-success-100 text-success-700' : 'bg-gray-100 text-gray-600'}`}>
                            {aut.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="space-y-1 text-gray-500 text-[11px]">
                          <p><span className="font-medium text-gray-700">Trigger:</span> {aut.trigger}</p>
                          <p><span className="font-medium text-gray-700">Action:</span> {aut.action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 10: PAYMENTS */}
              {activeTab === 'payments' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Payments & Deposits</h2>
                      <p className="text-xs text-gray-500">Monitor deposits, balance collections, and refund history</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                          <th className="p-4">Transaction ID</th>
                          <th className="p-4">Customer</th>
                          <th className="p-4">Type</th>
                          <th className="p-4">Amount</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bookings.map((bk, idx) => (
                          <tr key={bk.id} className="hover:bg-gray-50/50">
                            <td className="p-4 font-mono text-[10px]">TXN-{1000 + idx}</td>
                            <td className="p-4">{getCustomerName(bk.customer_id)}</td>
                            <td className="p-4 capitalize">Deposit</td>
                            <td className="p-4 font-semibold">{formatCurrency(bk.deposit_amount, organization?.currency)}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                bk.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                              }`}>
                                {bk.payment_status}
                              </span>
                            </td>
                            <td className="p-4 text-gray-500">{formatDate(bk.start_time)}</td>
                          </tr>
                        ))}
                      </tbody>
</table>
                  </div>
                </div>
              )}

              {/* TAB 11: REVIEWS */}
              {activeTab === 'reviews' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Reviews & Feedback</h2>
                      <p className="text-xs text-gray-500">Collect ratings and draft AI-guided responses</p>
                    </div>
                  </div>

                  <div className="space-y-4 text-xs">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="border border-gray-200 rounded-xl p-5 bg-white space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-800">{getCustomerName(rev.customer_id)}</span>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: rev.rating }).map((_, i) => (
                              <Star key={i} className="h-4.5 w-4.5 fill-amber-400 text-amber-400" />
                            ))}
                          </div>
                        </div>
                        <p className="text-gray-600 italic">"{rev.comment}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 12: ANALYTICS */}
              {activeTab === 'analytics' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Performance Analytics</h2>
                    <p className="text-xs text-gray-500">Track conversion rates, AI receptionist performance, and workload utilization</p>
                  </div>

                  <div className="grid md:grid-cols-3 gap-6 text-center text-xs">
                    <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                      <span className="text-gray-500 block">Total Conversations Handled</span>
                      <span className="text-2xl font-bold text-gray-900 block mt-2">1,248</span>
                    </div>
                    <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                      <span className="text-gray-500 block">AI Scheduling Success Rate</span>
                      <span className="text-2xl font-bold text-success-600 block mt-2">87.4%</span>
                    </div>
                    <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50">
                      <span className="text-gray-500 block">Average Response Time</span>
                      <span className="text-2xl font-bold text-indigo-600 block mt-2">1.8 seconds</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 13: INTEGRATIONS */}
              {activeTab === 'integrations' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-8">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Integration Hub</h2>
                    <p className="text-xs text-gray-500">Connect with third-party tools, calendars, and channels</p>
                  </div>

                  {INTEGRATION_CATEGORIES.map((cat) => (
                    <div key={cat}>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{cat}</h3>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {INTEGRATION_DEFINITIONS.filter(i => i.category === cat).map((int) => {
                          if (int.id === 'email') {
                            const isConnected = emailIntegration.status === 'connected';
                            const isExpired = emailIntegration.status === 'token_expired';
                            const isActionLoading = !!emailIntegration.actionLoading;

                            return (
                              <div key={int.id} className={`border rounded-xl p-5 bg-white flex flex-col justify-between transition-all ${
                                isConnected ? 'border-emerald-300 bg-emerald-50/20' : isExpired ? 'border-amber-300 bg-amber-50/20' : 'border-gray-200'
                              }`}>
                                <div>
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="h-10 w-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center font-bold">
                                      <Mail className="h-5 w-5" />
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isConnected ? 'bg-emerald-100 text-emerald-700' : isExpired ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {isConnected ? '✓ Connected' : isExpired ? '⚠ Connection Expired' : 'Not Connected'}
                                    </span>
                                  </div>
                                  <h4 className="font-semibold text-gray-900 text-sm">Gmail Email Integration</h4>
                                  <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                                    Connect your Gmail business account via Google OAuth 2.0 to securely receive and sync email metadata.
                                  </p>

                                  {emailIntegration.email_address && (
                                    <div className="mt-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100 space-y-1 text-xs">
                                      <div className="flex items-center gap-1.5 font-medium text-gray-800">
                                        <Mail className="h-3.5 w-3.5 text-gray-500" />
                                        <span>{emailIntegration.email_address}</span>
                                      </div>
                                      {emailIntegration.last_synced_at && (
                                        <div className="text-[11px] text-gray-500 flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          <span>Last synced: {formatDate(emailIntegration.last_synced_at)} {formatTime(emailIntegration.last_synced_at)}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                  {isConnected ? (
                                    <>
                                      <button
                                        disabled={isActionLoading}
                                        onClick={handleSyncGmailBackend}
                                        className="btn-secondary text-xs flex items-center gap-1 px-3 py-1.5"
                                      >
                                        <RefreshCw className={`h-3.5 w-3.5 ${emailIntegration.actionLoading === 'syncing' ? 'animate-spin' : ''}`} />
                                        {emailIntegration.actionLoading === 'syncing' ? 'Syncing...' : 'Sync Now'}
                                      </button>
                                      <button
                                        disabled={isActionLoading}
                                        onClick={handleDisconnectGmailBackend}
                                        className="text-xs text-red-600 hover:underline px-2 py-1"
                                      >
                                        {emailIntegration.actionLoading === 'disconnecting' ? 'Disconnecting...' : 'Disconnect'}
                                      </button>
                                    </>
                                  ) : isExpired ? (
                                    <>
                                      <button
                                        disabled={isActionLoading}
                                        onClick={handleConnectGmailBackend}
                                        className="btn-primary bg-amber-600 hover:bg-amber-700 text-xs flex items-center gap-1 px-3 py-1.5"
                                      >
                                        <RefreshCw className={`h-3.5 w-3.5 ${emailIntegration.actionLoading === 'connecting' ? 'animate-spin' : ''}`} />
                                        {emailIntegration.actionLoading === 'connecting' ? 'Connecting to Google...' : 'Reconnect Gmail'}
                                      </button>
                                      <button
                                        disabled={isActionLoading}
                                        onClick={handleDisconnectGmailBackend}
                                        className="text-xs text-red-600 hover:underline px-2 py-1"
                                      >
                                        Disconnect
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      disabled={isActionLoading}
                                      onClick={handleConnectGmailBackend}
                                      className="btn-primary text-xs flex items-center gap-1 px-4 py-1.5"
                                    >
                                      <Mail className="h-3.5 w-3.5" />
                                      {emailIntegration.actionLoading === 'connecting' ? 'Connecting to Google...' : 'Connect Gmail'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          const isConnected = connectedIntegrations.includes(int.id);
                          return (
                            <div key={int.id} className={`border rounded-xl p-5 bg-white flex flex-col justify-between transition-all ${isConnected ? 'border-success-300 bg-success-50/20' : 'border-gray-200'}`}>
                              <div>
                                <div className="flex items-start justify-between mb-3">
                                  <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                                    <Plug className="h-5 w-5" />
                                  </div>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isConnected ? 'bg-success-100 text-success-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {isConnected ? '✓ Connected' : 'Not connected'}
                                  </span>
                                </div>
                                <h4 className="font-semibold text-gray-900 text-sm">{int.name}</h4>
                                <p className="text-gray-500 text-xs mt-1 leading-relaxed">{int.desc}</p>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                {isConnected ? (
                                  <>
                                    <button onClick={() => handleIntegrationDisconnect(int.id, int.name)} className="text-xs text-error-600 hover:underline">Disconnect</button>
                                    <button onClick={() => toast('Sync started', 'success')} className="btn-ghost text-xs flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Sync</button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => {
                                      const needsPhone = int.id === 'sms' || int.id === 'voice' || int.id === 'whatsapp';
                                      setIntContactType(needsPhone ? 'phone' : 'email');
                                      setIntContactValue('');
                                      setIntApiKey('');
                                      setIntAccountId('');
                                      setSelectedIntegration(int);
                                    }}
                                    className="btn-secondary text-xs"
                                  >
                                    Connect
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 14: SETTINGS */}
              {activeTab === 'settings' && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Business settings</h2>
                    <p className="text-xs text-gray-500">Manage rules, parameters, currency, and locale defaults</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6 text-xs">
                    <div className="space-y-4">
                      <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2">Scheduling Rules</h3>
                      <div>
                        <label className="label">Minimum Notice Period (Hours)</label>
                        <input type="number" className="input" defaultValue={2} />
                      </div>
                      <div>
                        <label className="label">Maximum Booking Horizon (Days)</label>
                        <input type="number" className="input" defaultValue={60} />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2">Locale & Configurations</h3>
                      <div>
                        <label className="label">Country / Default Region</label>
                        <input type="text" className="input" defaultValue={organization?.country ?? 'GB'} disabled />
                      </div>
                      <div>
                        <label className="label">Preferred Currency Symbol</label>
                        <input type="text" className="input" defaultValue={organization?.currency ?? 'GBP'} disabled />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Manual Booking Modal Dialog */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setBookingModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl animate-scale-in p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Create Manual Appointment</h3>
              <button onClick={() => setBookingModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <form onSubmit={handleCreateBooking} className="space-y-4 text-xs">
              <div>
                <label className="label">Select Customer</label>
                <CustomSelect
                  required
                  placeholder="-- Choose Customer --"
                  value={newBooking.customerId}
                  onChange={(val) => setNewBooking({ ...newBooking, customerId: val })}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div>
                <label className="label">Select Service</label>
                <CustomSelect
                  required
                  placeholder="-- Choose Service --"
                  value={newBooking.serviceId}
                  onChange={(val) => setNewBooking({ ...newBooking, serviceId: val })}
                  options={services.map((s) => ({ value: s.id, label: `${s.name} (${s.duration_minutes} mins)` }))}
                />
              </div>
              <div>
                <label className="label">Select Practitioner (Staff)</label>
                <CustomSelect
                  placeholder="Auto-Assign"
                  value={newBooking.staffId}
                  onChange={(val) => setNewBooking({ ...newBooking, staffId: val })}
                  options={staff.map((st) => ({ value: st.id, label: st.name }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    required
                    className="input"
                    value={newBooking.date}
                    onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input
                    type="time"
                    required
                    className="input"
                    value={newBooking.time}
                    onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value })}
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary w-full py-2.5 mt-2">
                Book Appointment
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Booking Detail Modal */}
      {bookingDetailOpen && selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setBookingDetailOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl animate-scale-in p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-semibold text-gray-900">Appointment Detail</h3>
              <button onClick={() => setBookingDetailOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="text-xs space-y-4">
              <div>
                <span className="text-gray-400 block font-medium">Customer</span>
                <span className="text-gray-900 font-bold block mt-1">{getCustomerName(selectedBooking.customer_id)}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-400 block font-medium">Service</span>
                  <span className="text-gray-900 font-semibold block mt-1">{getServiceName(selectedBooking.service_id)}</span>
                </div>
                <div>
                  <span className="text-gray-400 block font-medium">Staff Assigned</span>
                  <span className="text-gray-900 font-semibold block mt-1">{getStaffName(selectedBooking.staff_id)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-gray-400 block font-medium">Date & Time</span>
                  <span className="text-gray-900 font-semibold block mt-1">{formatDate(selectedBooking.start_time)} at {formatTime(selectedBooking.start_time)}</span>
                </div>
                <div>
                  <span className="text-gray-400 block font-medium">Pricing</span>
                  <span className="text-gray-900 font-bold block mt-1">{formatCurrency(selectedBooking.price, organization?.currency)}</span>
                </div>
              </div>
              <div>
                <span className="text-gray-400 block font-medium">Current Status</span>
                <span className="capitalize font-semibold text-gray-900 block mt-1">{selectedBooking.status}</span>
              </div>

              {/* Status Action Buttons */}
              <div className="border-t border-gray-100 pt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => handleUpdateBookingStatus(selectedBooking.id, 'completed')}
                  className="px-2.5 py-1.5 bg-success-50 text-success-700 border border-success-200 rounded font-semibold text-[10px]"
                >
                  Mark Completed
                </button>
                <button
                  onClick={() => handleUpdateBookingStatus(selectedBooking.id, 'no_show')}
                  className="px-2.5 py-1.5 bg-error-50 text-error-700 border border-error-200 rounded font-semibold text-[10px]"
                >
                  Mark No Show
                </button>
                <button
                  onClick={() => handleUpdateBookingStatus(selectedBooking.id, 'cancelled')}
                  className="px-2.5 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded font-semibold text-[10px]"
                >
                  Cancel Booking
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Integration Connect Modal */}
      {selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setSelectedIntegration(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl animate-scale-in p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Connect {selectedIntegration.name}</h3>
              <button onClick={() => setSelectedIntegration(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            
            <div className="space-y-4 text-xs">
              <p className="text-gray-500">{selectedIntegration.desc}</p>
              
              {selectedIntegration.id === 'email' ? (
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="label">Clinic / Reception Email Address</label>
                    <input
                      type="email"
                      className="input"
                      placeholder="reception@clinic.com or deepdental@gmail.com"
                      value={intContactValue}
                      onChange={(e) => setIntContactValue(e.target.value)}
                    />
                  </div>

                  <button 
                    onClick={handleIntegrationConnect}
                    className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
                  >
                    <Mail className="h-4 w-4" />
                    Save & Connect Email Account
                  </button>

                  <div className="border-t border-gray-100 pt-3 mt-3">
                    <p className="text-gray-500 text-[11px] mb-2">Optional Google Workspace OAuth Login:</p>
                    <button 
                      onClick={() => googleLogin()}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 font-medium text-gray-700 transition-colors text-xs"
                    >
                      <Mail className="h-3.5 w-3.5 text-red-500" />
                      Sign in with Google OAuth
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="label">
                      {intContactType === 'phone' ? 'Phone Number' : 'Email Address'}
                    </label>
                    <input
                      type={intContactType === 'phone' ? 'tel' : 'email'}
                      className="input"
                      placeholder={intContactType === 'phone' ? '+1 234 567 8900' : 'hello@company.com'}
                      value={intContactValue}
                      onChange={(e) => setIntContactValue(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="label">API Key (Optional)</label>
                    <input
                      type="password"
                      className="input"
                      placeholder="sk_test_..."
                      value={intApiKey}
                      onChange={(e) => setIntApiKey(e.target.value)}
                    />
                  </div>

                  <button 
                    onClick={handleIntegrationConnect}
                    className="btn-primary w-full py-2.5 mt-2"
                  >
                    Complete Connection
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test AI Email Modal */}
      {testEmailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setTestEmailOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl animate-scale-in p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Simulate Customer Email to Reception AI</h3>
                  <p className="text-[11px] text-gray-500">Test how Reception AI reads incoming email & books appointment</p>
                </div>
              </div>
              <button onClick={() => setTestEmailOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <form onSubmit={handleSendTestEmail} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Customer Name</label>
                  <input
                    type="text"
                    required
                    className="input"
                    value={testEmailName}
                    onChange={(e) => setTestEmailName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Customer Email</label>
                  <input
                    type="email"
                    required
                    className="input"
                    value={testEmailFrom}
                    onChange={(e) => setTestEmailFrom(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label">Email Subject</label>
                <input
                  type="text"
                  required
                  className="input"
                  value={testEmailSubject}
                  onChange={(e) => setTestEmailSubject(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Email Message Body (Customer Booking Request)</label>
                <textarea
                  required
                  rows={3}
                  className="input"
                  value={testEmailBody}
                  onChange={(e) => setTestEmailBody(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={testEmailLoading}
                className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
              >
                {testEmailLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Reception AI Reading Email & Booking...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Email to Reception AI
                  </>
                )}
              </button>
            </form>

            {testEmailResult && (
              <div className="mt-4 border border-indigo-100 rounded-xl p-4 bg-indigo-50/40 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-bold text-indigo-900 border-b border-indigo-100 pb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  AI Receptionist Reply & Auto-Booking Result
                </div>
                <div>
                  <span className="font-semibold text-gray-700 block mb-1">AI Automated Email Response:</span>
                  <p className="p-3 bg-white border border-gray-200 rounded-lg text-gray-800 leading-relaxed italic">
                    "{testEmailResult.aiReply}"
                  </p>
                </div>

                {testEmailResult.booking ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 font-medium">
                    <span className="font-bold">✓ Booking Automatically Saved to Database:</span>
                    <ul className="mt-1 space-y-0.5 text-[11px]">
                      <li>• Service: {testEmailResult.booking.service?.name || 'Consultation'}</li>
                      <li>• Date & Time: {new Date(testEmailResult.booking.start_time).toLocaleString()}</li>
                      <li>• Status: {testEmailResult.booking.status}</li>
                      <li>• Booking ID: {testEmailResult.booking.id}</li>
                    </ul>
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px]">
                    ℹ️ AI Replied to customer. Include date, time, and service name to trigger automatic database booking!
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
