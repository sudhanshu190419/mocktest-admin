'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { OverviewView } from '@/views/OverviewView';
import { ScheduleView } from '@/views/ScheduleView';
import { AssessmentsView } from '@/views/AssessmentsView';
import { HrPortalView } from '@/views/HrPortalView';
import { LoginView } from '@/views/LoginView';
import { AdminOverviewView } from '@/views/admin/AdminOverviewView';
import { AdminFacultyView } from '@/views/admin/AdminFacultyView';
import { useAuth } from '@/context/AuthContext';
import { LiveStudioView } from '@/components/live-studio/LiveStudioView';

export default function App() {
  const { user, teacherProfile, isDemoMode, loading, completeOnboarding, skipOnboarding } = useAuth();
  const [activeRole, setActiveRole] = useState<'teacher' | 'admin'>(() => {
    if (typeof window !== 'undefined') {
      const simRole = localStorage.getItem('EDTECH_SIM_ROLE');
      return simRole === 'admin' ? 'admin' : 'teacher';
    }
    return 'teacher';
  });
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const simRole = localStorage.getItem('EDTECH_SIM_ROLE');
      return simRole === 'admin' ? 'admin-overview' : 'overview';
    }
    return 'overview';
  });
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  useEffect(() => {
    if (teacherProfile?.needsOnboarding) {
      setShowOnboardingModal(true);
    } else {
      setShowOnboardingModal(false);
    }
  }, [teacherProfile]);
  const [showLiveStudio, setShowLiveStudio] = useState(false);

  useEffect(() => {
    const role = teacherProfile?.role === 'admin' || localStorage.getItem('EDTECH_SIM_ROLE') === 'admin' ? 'admin' : 'teacher';
    setActiveRole(role);
    if (role === 'admin' && (activeTab === 'overview' || activeTab === 'hr-portal')) {
      setActiveTab('admin-overview');
    } else if (role === 'teacher' && (activeTab === 'admin-overview' || activeTab === 'admin-faculty')) {
      setActiveTab('overview');
    }
  }, [teacherProfile, user]);

  const handleToggleRole = () => {
    // No-op: Role is strictly locked to logged-in credentials in production
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-navy-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-amber-400 border-t-transparent animate-spin" />
          <span className="text-sm font-mono tracking-widest uppercase text-blue-200">Initializing Faculty Studio...</span>
        </div>
      </div>
    );
  }

  if (!user && !isDemoMode) {
    return <LoginView />;
  }

  const getTabTitle = () => {
    switch (activeTab) {
      case 'overview': return 'Overview & Analytics Hub';
      case 'schedule': return 'Batches & Timetable';
      case 'assessments': return 'Test & Assessment Manager';
      case 'hr-portal': return 'HR & Faculty Profile Portal';
      case 'admin-overview': return 'Institute Command Center';
      case 'admin-faculty': return 'Faculty Roster & HR Administration';
      default: return activeRole === 'admin' ? 'Institute Governance Dashboard' : 'Faculty Dashboard';
    }
  };



  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Navigation Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} activeRole={activeRole} />

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar */}
        <Header 
          activeTabTitle={getTabTitle()} 
          onLaunchLive={() => setShowLiveStudio(true)} 
          activeRole={activeRole}
          onToggleRole={handleToggleRole}
        />

        {/* Dynamic Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'overview' && (
              <OverviewView 
                onNavigateTab={setActiveTab} 
                onLaunchLive={() => setShowLiveStudio(true)} 
              />
            )}
            {activeTab === 'admin-overview' && (
              <AdminOverviewView 
                onNavigateTab={setActiveTab} 
                onLaunchLive={() => setShowLiveStudio(true)} 
              />
            )}
            {activeTab === 'admin-faculty' && <AdminFacultyView />}
            {activeTab === 'schedule' && (
              <ScheduleView onLaunchLive={() => setShowLiveStudio(true)} />
            )}
            {activeTab === 'assessments' && <AssessmentsView />}
            {activeTab === 'hr-portal' && <HrPortalView />}
          </div>
        </main>
      </div>

      {/* LiveKit-Powered Live Studio Modal */}
      <LiveStudioView
        isOpen={showLiveStudio}
        onClose={() => setShowLiveStudio(false)}
      />
      {/* Interactive Credentials Onboarding Modal */}
      {showOnboardingModal && (
        <div className="fixed inset-0 z-[100] bg-navy-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface border border-border rounded-[2.5rem] p-8 shadow-2xl flex flex-col gap-6 animate-fadeIn text-text-primary">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-100 text-primary-800 text-xs font-mono font-bold uppercase mb-3">
                🎓 Faculty Onboarding Step
              </div>
              <h3 className="text-2xl font-extrabold tracking-tight">Complete Your Faculty Profile</h3>
              <p className="text-sm text-text-muted mt-1">
                Please provide your academic credentials and bank details for salary payouts and batch allocations. You can skip this and complete it later under the HR Portal.
              </p>
            </div>

            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              await completeOnboarding({
                qualification: formData.get('qualification') as string,
                institution: formData.get('institution') as string,
                year: formData.get('year') as string,
                accountHolder: formData.get('accountHolder') as string,
                bankName: formData.get('bankName') as string,
                accountNumber: formData.get('accountNumber') as string,
                ifscCode: formData.get('ifscCode') as string,
              });
              setShowOnboardingModal(false);
            }} className="space-y-6">
              
              {/* Part 1: Academic Credentials */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-primary-800 pb-1 border-b border-border">1. Highest Educational Qualification</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Degree Title</label>
                    <input name="qualification" required type="text" placeholder="Ph.D. or M.Sc." className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white" />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Institution</label>
                    <input name="institution" required type="text" placeholder="IIT Madras or Delhi Univ" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white" />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Year of Passing</label>
                    <input name="year" required type="text" placeholder="e.g. 2022" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white font-mono" />
                  </div>
                </div>
              </div>

              {/* Part 2: Bank Account Details */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-primary-800 pb-1 border-b border-border">2. Bank Details (For Monthly Salary Disbursement)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Account Holder Name</label>
                    <input name="accountHolder" required type="text" placeholder="Full name as in bank" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Bank Name</label>
                    <input name="bankName" required type="text" placeholder="HDFC, SBI, ICICI, etc." className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Account Number</label>
                    <input name="accountNumber" required type="password" placeholder="12 to 16 digit account number" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">IFSC Code</label>
                    <input name="ifscCode" required type="text" placeholder="e.g. HDFC0001234" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium outline-none focus:border-primary-800 focus:bg-white font-mono uppercase" />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    skipOnboarding();
                    setShowOnboardingModal(false);
                  }}
                  className="px-5 py-2.5 rounded-full border border-border hover:bg-slate-50 text-text-primary text-xs font-bold transition-all"
                >
                  Skip & Do It Later
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-full bg-primary-800 hover:bg-primary-700 text-white text-xs font-bold transition-all shadow-md"
                >
                  Complete Onboarding &rarr;
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
