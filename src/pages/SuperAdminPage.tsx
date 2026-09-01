import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { ShieldAlert, LogOut, Building, Activity, Users } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export function SuperAdminPage() {
  const { user, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [allOrganizations, setAllOrganizations] = useState<any[]>([]);

  useEffect(() => {
    // If not logged in or not a super admin, redirect to login
    if (!user) {
      navigate('/login');
      return;
    }
    
    if (user && !isSuperAdmin) {
      navigate('/app');
      return;
    }

    if (isSuperAdmin) {
      fetchOrganizations();
    }
  }, [user, isSuperAdmin, navigate]);

  const fetchOrganizations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (!error && data) {
      setAllOrganizations(data);
    }
    setLoading(false);
  };

  const handleUpdatePlan = async (orgId: string, newPlan: string) => {
    const { error } = await supabase
      .from('organizations')
      .update({ subscription_plan: newPlan })
      .eq('id', orgId);
      
    if (!error) {
      toast(`Plan updated to ${newPlan}`);
      setAllOrganizations(prev => prev.map(o => o.id === orgId ? { ...o, subscription_plan: newPlan } : o));
    } else {
      toast('Failed to update plan');
    }
  };

  const handleUpdateStatus = async (orgId: string, newStatus: string) => {
    const { error } = await supabase
      .from('organizations')
      .update({ subscription_status: newStatus })
      .eq('id', orgId);
      
    if (!error) {
      toast(`Status updated to ${newStatus}`);
      setAllOrganizations(prev => prev.map(o => o.id === orgId ? { ...o, subscription_status: newStatus } : o));
    } else {
      toast('Failed to update status');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-wide text-white">RECEPTION.AI ADMIN</h1>
              <p className="text-[10px] text-slate-400">Master Control Panel</p>
            </div>
          </div>
          <button 
            onClick={handleSignOut}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
              <Building className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Total Organizations</p>
              <h3 className="text-2xl font-bold text-gray-900">{allOrganizations.length}</h3>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Active Subscriptions</p>
              <h3 className="text-2xl font-bold text-gray-900">
                {allOrganizations.filter(o => o.subscription_status === 'active' && o.subscription_plan !== 'free').length}
              </h3>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Free Tier</p>
              <h3 className="text-2xl font-bold text-gray-900">
                {allOrganizations.filter(o => !o.subscription_plan || o.subscription_plan === 'free').length}
              </h3>
            </div>
          </div>
        </div>

        {/* Organizations Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
            <div>
              <h2 className="text-base font-bold text-gray-900">Registered SaaS Organizations</h2>
              <p className="text-xs text-gray-500 mt-0.5">Manage billing plans and account status for all tenants</p>
            </div>
          </div>
          
          <div className="overflow-x-auto text-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold text-xs uppercase tracking-wider">
                  <th className="p-4">Business Name</th>
                  <th className="p-4">Domain/Slug</th>
                  <th className="p-4">Country</th>
                  <th className="p-4">Current Plan</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allOrganizations
                  .filter((org) => org.name.toLowerCase() !== 'super admin')
                  .map((org) => (
                  <tr key={org.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 font-semibold text-gray-900">{org.name}</td>
                    <td className="p-4 text-gray-500 font-mono text-xs">{org.slug}</td>
                    <td className="p-4 text-gray-600">{org.country}</td>
                    <td className="p-4">
                      <select 
                        className="input py-1.5 px-3 text-xs w-full max-w-[140px] font-medium"
                        value={org.subscription_plan || 'free'}
                        onChange={(e) => handleUpdatePlan(org.id, e.target.value)}
                      >
                        <option value="free">Free Trial</option>
                        <option value="starter">Starter</option>
                        <option value="growth">Growth</option>
                        <option value="pro">Pro</option>
                      </select>
                      {(!org.subscription_plan || org.subscription_plan === 'free') && (
                        <div className="text-[10px] text-gray-500 mt-1 pl-1">
                          {(() => {
                            const trialEnd = new Date(new Date(org.created_at).getTime() + 14 * 24 * 60 * 60 * 1000);
                            
                            // Calculate days and hours left accurately
                            const diffTime = trialEnd.getTime() - new Date().getTime();
                            const daysLeft = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                            
                            if (diffTime < 0) return <span className="text-error-600 font-medium">Trial Expired</span>;
                            
                            // Format: 9/15/2026, 10:30 AM
                            const endFormatted = trialEnd.toLocaleString(undefined, { 
                              year: 'numeric', month: 'numeric', day: 'numeric', 
                              hour: 'numeric', minute: '2-digit' 
                            });
                            
                            return <span>Ends {endFormatted} ({daysLeft} days left)</span>;
                          })()}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <select 
                        className={`input py-1.5 px-3 text-[10px] w-full max-w-[120px] font-bold uppercase tracking-wide cursor-pointer ${
                          (org.subscription_status || 'active') === 'active' 
                            ? 'bg-success-50 text-success-700 border-success-200' 
                            : (org.subscription_status === 'suspended' || org.subscription_status === 'canceled')
                              ? 'bg-error-50 text-error-700 border-error-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                        value={org.subscription_status || 'active'}
                        onChange={(e) => handleUpdateStatus(org.id, e.target.value)}
                      >
                        <option value="active">Active</option>
                        <option value="past_due">Past Due</option>
                        <option value="suspended">Suspended</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </td>
                    <td className="p-4 text-gray-500 text-xs">
                      {new Date(org.created_at).toLocaleString(undefined, {
                        year: 'numeric', month: 'numeric', day: 'numeric', 
                        hour: 'numeric', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
                
                {allOrganizations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500">
                      No organizations found in the database.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
