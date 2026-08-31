import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Organization, OrganizationMember } from '@/lib/supabase';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  organization: Organization | null;
  members: OrganizationMember[];
  role: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (data: SignUpData) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
};

type SignUpData = {
  fullName: string;
  email: string;
  password: string;
  businessName: string;
  country: string;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [role, setRole] = useState<string | null>(null);

  async function loadOrgData(userId: string) {
    const { data: memberData } = await supabase
      .from('organization_members')
      .select('*, organization:organizations(*)')
      .eq('user_id', userId);

    if (memberData && memberData.length > 0) {
      const org = memberData[0].organization as unknown as Organization;
      setOrganization(org);
      setRole(memberData[0].role);
      setMembers(
        memberData.map((m) => ({
          id: m.id,
          organization_id: m.organization_id,
          user_id: m.user_id,
          role: m.role,
          created_at: m.created_at,
        }))
      );
    } else {
      setOrganization(null);
      setRole(null);
      setMembers([]);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrgData(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        (async () => {
          await loadOrgData(session.user.id);
        })();
      } else {
        setOrganization(null);
        setRole(null);
        setMembers([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUp(data: SignUpData) {
    const { data: authData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName,
          business_name: data.businessName,
          country: data.country,
        },
      },
    });

    if (error) return { error: error.message };
    if (!authData.user) return { error: 'Sign up failed' };

    const userId = authData.user.id;

    const { data: profileData } = await supabase
      .from('profiles')
      .insert({ id: userId, full_name: data.fullName, country: data.country })
      .select()
      .single();

    if (!profileData) {
      await supabase.from('profiles').upsert({ id: userId, full_name: data.fullName, country: data.country });
    }

    const slug = data.businessName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    const countryInfo = data.country === 'US'
      ? { currency: 'USD', timezone: 'America/New_York' }
      : { currency: 'GBP', timezone: 'Europe/London' };

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: data.businessName,
        slug,
        country: data.country,
        currency: countryInfo.currency,
        timezone: countryInfo.timezone,
        onboarding_completed: false,
        onboarding_step: 1,
      })
      .select()
      .single();

    if (orgError) return { error: orgError.message };
    if (!orgData) return { error: 'Failed to create organization' };

    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: orgData.id,
        user_id: userId,
        role: 'owner',
      });

    if (memberError) return { error: memberError.message };

    await loadOrgData(userId);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setOrganization(null);
    setRole(null);
    setMembers([]);
  }

  async function refreshOrganization() {
    if (user) await loadOrgData(user.id);
  }

  return (
    <AuthContext.Provider
      value={{ user, session, loading, organization, members, role, signIn, signUp, signOut, refreshOrganization }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
