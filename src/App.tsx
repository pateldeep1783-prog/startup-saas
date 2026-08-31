import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage, SignUpPage } from '@/pages/Auth';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { Dashboard } from '@/pages/Dashboard';
import { PublicBookingPage } from '@/pages/PublicBookingPage';
import { PublicAppointmentPage } from '@/pages/PublicAppointmentPage';
import { PublicChatPage } from '@/pages/PublicChatPage';

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

            {/* Onboarding Wizard */}
            <Route path="/onboarding" element={<OnboardingPage />} />

            {/* Core B2B SaaS Dashboard Panel */}
            <Route path="/app/*" element={<Dashboard />} />

            {/* Customer Facing Portals */}
            <Route path="/book/:businessSlug" element={<PublicBookingPage />} />
            <Route path="/appointment/:bookingId" element={<PublicAppointmentPage />} />
            <Route path="/ai-chat/:businessSlug" element={<PublicChatPage />} />

            {/* Fallback Catch-All */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;

