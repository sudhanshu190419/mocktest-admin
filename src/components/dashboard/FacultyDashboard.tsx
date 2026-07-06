'use client';

import { useState, useEffect, useRef } from 'react';
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
import { MOCK_LIVE_CLASSES } from '@/data/mockData';
import { VideoCamera, Microphone, Desktop, X, Users, Record } from '@phosphor-icons/react';
import { teacherService } from '@/services/teacherService';

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
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [liveStudentsCount, setLiveStudentsCount] = useState(38);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const broadcastIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (broadcastIntervalRef.current) {
        clearInterval(broadcastIntervalRef.current);
      }
    };
  }, []);

  // Strategy C: Handle local webcam and microphone capture when live studio is open
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    
    const startCapture = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.warn('Webcam & audio input APIs are not supported or mocked in this environment');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        activeStream = stream;
        setMediaStream(stream);
        
        // Apply initial mute/cam-off states to the audio/video tracks
        stream.getVideoTracks().forEach(track => {
          track.enabled = !isCamOff;
        });
        stream.getAudioTracks().forEach(track => {
          track.enabled = !isMuted;
        });
      } catch (err) {
        console.warn('Could not start local device preview stream:', err);
      }
    };

    const getOrCreateClass = async () => {
      if (teacherProfile && !isDemoMode) {
        const classId = await teacherService.getOrCreateActiveLiveClass(teacherProfile.id);
        setActiveClassId(classId);
      } else {
        setActiveClassId('demo-classroom-id');
      }
    };

    if (showLiveStudio) {
      startCapture();
      getOrCreateClass();
    } else {
      // Turn off webcam and microphone tracks to release device locks
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        setMediaStream(null);
      }
      setActiveClassId(null);
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showLiveStudio]);

  // Bind the media stream to the video tag when it becomes available
  useEffect(() => {
    if (videoRef.current && mediaStream && !isCamOff) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream, isCamOff]);

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



  const toggleMicrophone = () => {
    const nextState = !isMuted;
    setIsMuted(nextState);
    if (mediaStream) {
      mediaStream.getAudioTracks().forEach(track => {
        track.enabled = !nextState;
      });
    }
  };

  const toggleCamera = () => {
    const nextState = !isCamOff;
    setIsCamOff(nextState);
    if (mediaStream) {
      mediaStream.getVideoTracks().forEach(track => {
        track.enabled = !nextState;
      });
    }
  };

  const handleStartBroadcast = async () => {
    setIsBroadcasting(true);
    
    if (activeClassId && !isDemoMode) {
      await teacherService.startLiveClass(activeClassId);
    }

    if (broadcastIntervalRef.current) {
      clearInterval(broadcastIntervalRef.current);
    }
    setLiveStudentsCount(38);
    const interval = setInterval(() => {
      setLiveStudentsCount((prev) => (prev < 48 ? prev + 1 : prev));
    }, 3000);
    broadcastIntervalRef.current = interval;
  };

  const handleEndBroadcast = async () => {
    setIsBroadcasting(false);
    
    if (activeClassId && !isDemoMode) {
      await teacherService.endLiveClass(activeClassId);
    }

    if (broadcastIntervalRef.current) {
      clearInterval(broadcastIntervalRef.current);
      broadcastIntervalRef.current = null;
    }
  };

  const handleCloseStudio = () => {
    if (isBroadcasting) {
      handleEndBroadcast();
    }
    setShowLiveStudio(false);
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

      {/* Interactive Live Studio Broadcast Modal */}
      {showLiveStudio && (
        <div className="fixed inset-0 z-50 bg-navy-800/90 backdrop-blur-xl flex flex-col justify-between p-6 sm:p-10 animate-fadeIn text-white">
          {/* Studio Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-6">
            <div className="flex items-center gap-4">
              <div className={`w-3.5 h-3.5 rounded-full ${isBroadcasting ? 'bg-red-500 animate-ping' : 'bg-amber-400'}`} />
              <div>
                <span className="text-[11px] font-mono uppercase tracking-widest text-blue-300/80">
                  {isBroadcasting ? '• LIVE ON AIR (STUDIO 01)' : '• PRE-BROADCAST STUDIO GREENROOM'}
                </span>
                <h3 className="text-xl font-bold tracking-tight mt-0.5">
                  {MOCK_LIVE_CLASSES[0].title}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {isBroadcasting && (
                <div className="px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-mono text-xs font-bold flex items-center gap-2">
                  <Record size={16} weight="fill" className="text-red-500 animate-pulse" />
                  <span>REC 00:14:32</span>
                </div>
              )}
              <button 
                onClick={handleCloseStudio}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Main Video Stage */}
          <div className="flex-1 my-6 grid grid-cols-1 lg:grid-cols-4 gap-6 overflow-hidden">
            <div className="lg:col-span-3 rounded-[2.5rem] bg-black/40 border border-white/10 relative overflow-hidden flex items-center justify-center shadow-2xl">
              {!isCamOff ? (
                mediaStream ? (
                  <div className="w-full h-full relative flex items-center justify-center">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover rounded-[2.5rem]"
                    />
                    <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-xs">
                      <p className="font-bold">{teacherProfile?.name || 'Dr. Arvind Sharma'} (Host & Faculty)</p>
                      <p className="text-[10px] text-blue-200/80 font-mono mt-0.5">Local Camera Preview • WebRTC Loopback</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=800"
                      alt="Teacher Cam"
                      className="w-40 h-40 rounded-full object-cover border-4 border-primary-700 mx-auto mb-4 shadow-2xl"
                    />
                    <p className="font-bold text-lg">{teacherProfile?.name || 'Dr. Arvind Sharma'} (Host & Faculty)</p>
                    <p className="text-xs text-blue-200/60 font-mono mt-1">1080p 60fps • Low Latency WebRTC Studio</p>
                  </div>
                )
              ) : (
                <div className="text-center text-slate-400">
                  <VideoCamera size={48} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">Camera Feed Muted</p>
                </div>
              )}

              {/* Top left overlay stats */}
              <div className="absolute top-6 left-6 flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs font-mono flex items-center gap-2">
                  <Users size={16} className="text-blue-400" />
                  <span>{isBroadcasting ? `${liveStudentsCount} Students Active` : '48 Enrolled in Roster'}</span>
                </div>
              </div>
            </div>

            {/* Right Student Chat & Questions Feed */}
            <div className="lg:col-span-1 rounded-[2.5rem] bg-white/5 border border-white/10 p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                  <span className="font-bold text-sm tracking-wide">Live Student Q&A</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">Domain 04</span>
                </div>
                <div className="space-y-4 mt-4 text-xs">
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                    <p className="font-bold text-amber-300 mb-1">Rohan M. (JEE Adv Target)</p>
                    <p className="text-blue-100/80">Sir, could you re-explain the angular momentum conservation when the axis changes?</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                    <p className="font-bold text-emerald-300 mb-1">Ananya K. (JEE Adv Target)</p>
                    <p className="text-blue-100/80">Audio and 4K board visual is super clear sir! 👍</p>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <input
                  type="text"
                  placeholder="Broadcast message to class..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-400 outline-none focus:border-blue-400"
                />
              </div>
            </div>
          </div>

          {/* Studio Control Deck */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleMicrophone}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isMuted ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <Microphone size={22} />
              </button>
              <button
                onClick={toggleCamera}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isCamOff ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <VideoCamera size={22} />
              </button>
              <button className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all">
                <Desktop size={22} />
              </button>
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              {!isBroadcasting ? (
                <button
                  onClick={handleStartBroadcast}
                  className="w-full sm:w-auto px-8 py-4 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-extrabold text-sm tracking-wide shadow-2xl transition-all"
                >
                  START LIVE BROADCAST NOW
                </button>
              ) : (
                <button
                  onClick={handleEndBroadcast}
                  className="w-full sm:w-auto px-8 py-4 rounded-full bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm tracking-wide shadow-2xl transition-all"
                >
                  END SESSION & SAVE RECORDING
                </button>
              )}
          </div>
        </div>
      </div>
      )}
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
