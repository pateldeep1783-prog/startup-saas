import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage, SignUpPage, ForgotPasswordPage } from '@/pages/Auth';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { Dashboard } from '@/pages/Dashboard';
import { PublicBookingPage } from '@/pages/PublicBookingPage';
import { PublicAppointmentPage } from '@/pages/PublicAppointmentPage';
import { PublicChatPage } from '@/pages/PublicChatPage';
import { SuperAdminPage } from '@/pages/SuperAdminPage';
import type { ReactNode } from 'react';

/** Auth guard — redirects to /login if not authenticated */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Landing & Marketing */}
            <Route path="/" element={<LandingPage />} />

            {/* Authentication */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            {/* Protected: Onboarding Wizard */}
            <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />

            {/* Protected: Core B2B SaaS Dashboard Panel */}
            <Route path="/app/*" element={<RequireAuth><Dashboard /></RequireAuth>} />

            {/* Customer Facing Portals (public) */}
            <Route path="/book/:businessSlug" element={<PublicBookingPage />} />
            <Route path="/appointment/:bookingId" element={<PublicAppointmentPage />} />
            <Route path="/ai-chat/:businessSlug" element={<PublicChatPage />} />

            {/* Super Admin Route */}
            <Route path="/super-admin" element={<RequireAuth><SuperAdminPage /></RequireAuth>} />

            {/* Fallback Catch-All */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
