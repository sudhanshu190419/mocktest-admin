'use client';

import React, { useState } from 'react';
import { 
  EnvelopeSimple, 
  LockKey, 
  ArrowRight, 
  CircleNotch, 
  Sparkle,
  IdentificationCard,
  User,
  Buildings,
  MagicWand,
  ArrowLeft
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

export const LoginView: React.FC = () => {
  const { signIn, registerTeacher } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // Login State
  const [emailOrId, setEmailOrId] = useState('');
  const [password, setPassword] = useState('');
  
  // Register State
  const [fullName, setFullName] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [department, setDepartment] = useState('Physics & Applied Mechanics');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrId.trim() || !password.trim()) {
      setErrorMsg('Please enter both your Faculty ID/Email and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const { error } = await signIn(emailOrId, password);
    if (error) {
      setErrorMsg(error);
    }
    setIsSubmitting(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !facultyId.trim() || !regPassword.trim()) {
      setErrorMsg('Please complete Full Name, Faculty ID, and Password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const { error } = await registerTeacher(
      regEmail.trim() || `${facultyId.toLowerCase()}@edtech.org`,
      regPassword,
      facultyId.trim(),
      fullName.trim(),
      department
    );

    if (error) {
      setErrorMsg(error);
    }
    setIsSubmitting(false);
  };

  const handleAutoGenId = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const deptPrefix = department.toLowerCase().includes('physics') ? 'phy' :
                       department.toLowerCase().includes('chemistry') ? 'chem' :
                       department.toLowerCase().includes('math') ? 'math' :
                       department.toLowerCase().includes('bio') ? 'bio' : 'cs';
    const newId = `t-${randomNum}-${deptPrefix}`;
    setFacultyId(newId);
    if (!regEmail) {
      setRegEmail(`${newId}@edtech.org`);
    }
  };

  return (
    <div className="min-h-screen w-full bg-navy-900 flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans selection:bg-amber-400 selection:text-slate-900">
      <div className="w-full max-w-6xl h-full min-h-[680px] rounded-[3rem] bg-surface shadow-2xl border border-white/10 overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative animate-fadeIn">
        
        {/* Left Panel (Span 7) - Cool Physics & Quantum Animation Engine ONLY */}
        <div className="lg:col-span-7 bg-gradient-to-br from-[#030914] via-[#081b3b] to-[#0d3478] p-10 lg:p-14 flex flex-col justify-between relative overflow-hidden text-white">
          
          {/* Animated Background Canvas / Physics Particles */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Glowing Orb 1 */}
            <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-blue-500/20 blur-[100px] animate-pulse" style={{ animationDuration: '6s' }} />
            {/* Glowing Orb 2 */}
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-amber-500/15 blur-[120px] animate-pulse" style={{ animationDuration: '8s' }} />

            {/* Geometric Rotating Rings Animation */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] border border-blue-400/20 rounded-full animate-[spin_30s_linear_infinite]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] border border-dashed border-amber-300/20 rounded-full animate-[spin_20s_linear_infinite_reverse]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] border border-blue-300/15 rounded-full animate-[spin_15s_linear_infinite]" />
            
            {/* Floating Particle Nodes */}
            <div className="absolute top-1/3 right-1/3 w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_15px_#fbbf24] animate-bounce" style={{ animationDuration: '4s' }} />
            <div className="absolute bottom-1/3 left-1/3 w-2.5 h-2.5 rounded-full bg-blue-400 shadow-[0_0_15px_#60a5fa] animate-ping" style={{ animationDuration: '3s' }} />
            <div className="absolute top-2/3 right-1/4 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-pulse" />
          </div>

          {/* Top Brand Tag */}
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-mono tracking-widest uppercase text-blue-200">
              <Sparkle size={14} className="text-amber-400 animate-spin" style={{ animationDuration: '10s' }} />
              <span>EdTech Faculty Studio v2.4</span>
            </div>
          </div>

          {/* Center Title in Animated Panel */}
          <div className="relative z-10 my-auto py-12 space-y-4 max-w-xl">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight font-display">
              Empowering India’s Top Educators with <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400">Intelligent Tools.</span>
            </h1>
            <p className="text-sm sm:text-base text-blue-100/80 font-normal leading-relaxed">
              Manage live virtual studios, AI grading pipelines, question banks, and timetable assignments from a unified academic console.
            </p>
          </div>

          {/* Bottom Live Pulse Indicator */}
          <div className="relative z-10 flex items-center gap-3 pt-6 border-t border-white/10">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-mono text-blue-200/80 tracking-wide uppercase">
              System Operational • Supabase Domain 01 & 13 Connected
            </span>
          </div>

        </div>

        {/* Right Panel (Span 5) - Strict Professional Vault (Login / Register Switch) */}
        <div className="lg:col-span-5 bg-surface p-8 sm:p-10 flex flex-col justify-center relative z-10 overflow-y-auto max-h-[90vh]">
          <div className="max-w-sm mx-auto w-full space-y-6 my-auto">
            
            {/* Form Header */}
            <div>
              <span className="text-xs font-bold font-mono tracking-wider uppercase text-primary-800 bg-primary-100 px-3 py-1 rounded-full">
                {authMode === 'login' ? 'Faculty Access' : 'New Faculty Onboarding'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight mt-3">
                {authMode === 'login' ? 'Sign In to Portal' : 'Register Faculty ID'}
              </h2>
              <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                {authMode === 'login' 
                  ? 'Enter your Faculty ID or institutional email to access your teacher dashboard.'
                  : 'Initialize your teacher profile and obtain instant workspace authorization.'}
              </p>
            </div>

            {/* Error Banner */}
            {errorMsg && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium flex items-start gap-2.5 animate-shake">
                <span className="font-bold">Notice:</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* MODE 1: LOGIN FORM */}
            {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
                    Faculty ID / Institutional Email
                  </label>
                  <div className="relative flex items-center">
                    <IdentificationCard size={20} className="absolute left-4 text-text-muted" />
                    <input
                      type="text"
                      value={emailOrId}
                      onChange={(e) => setEmailOrId(e.target.value)}
                      placeholder="t-8492-phy or arvind@edtech.org"
                      required
                      className="w-full pl-12 pr-4 py-3 rounded-2xl bg-slate-50 border border-border text-sm font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white focus:ring-4 focus:ring-primary-800/10 transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                      Password
                    </label>
                    <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Please contact Institute HR to reset credentials.'); }} className="text-[11px] font-semibold text-primary-800 hover:underline">
                      Forgot Password?
                    </a>
                  </div>
                  <div className="relative flex items-center">
                    <LockKey size={20} className="absolute left-4 text-text-muted" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="w-full pl-12 pr-4 py-3 rounded-2xl bg-slate-50 border border-border text-sm font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white focus:ring-4 focus:ring-primary-800/10 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 rounded-full bg-primary-800 hover:bg-primary-700 active:scale-[0.99] disabled:opacity-70 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2.5 transition-all duration-300"
                  >
                    {isSubmitting ? (
                      <>
                        <CircleNotch size={18} className="animate-spin text-amber-400" />
                        <span>Authenticating Faculty...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In to Dashboard</span>
                        <ArrowRight size={18} weight="bold" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* MODE 2: TEACHER REGISTRATION FORM */
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1">
                    Full Name & Title
                  </label>
                  <div className="relative flex items-center">
                    <User size={18} className="absolute left-3.5 text-text-muted" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Dr. Rajeshwar Prasad"
                      required
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                      Faculty ID / Employee Code
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoGenId}
                      className="text-[11px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded flex items-center gap-1 font-mono transition-colors"
                    >
                      <MagicWand size={12} weight="fill" /> Auto-Generate
                    </button>
                  </div>
                  <div className="relative flex items-center">
                    <IdentificationCard size={18} className="absolute left-3.5 text-text-muted" />
                    <input
                      type="text"
                      value={facultyId}
                      onChange={(e) => setFacultyId(e.target.value)}
                      placeholder="t-2026-phy or EMP-8842"
                      required
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-bold text-primary-800 placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1">
                    Academic Department
                  </label>
                  <div className="relative flex items-center">
                    <Buildings size={18} className="absolute left-3.5 text-text-muted pointer-events-none" />
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium text-text-primary outline-none focus:border-primary-800 focus:bg-white"
                    >
                      <option value="Physics & Applied Mechanics">Physics & Applied Mechanics</option>
                      <option value="Organic & Physical Chemistry">Organic & Physical Chemistry</option>
                      <option value="Pure & Applied Mathematics">Pure & Applied Mathematics</option>
                      <option value="Biological Sciences (NEET)">Biological Sciences (NEET)</option>
                      <option value="Computer Science & AI">Computer Science & AI</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1">
                    Institutional Email (Optional)
                  </label>
                  <div className="relative flex items-center">
                    <EnvelopeSimple size={18} className="absolute left-3.5 text-text-muted" />
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="rajeshwar@edtech.org"
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1">
                    Create Password
                  </label>
                  <div className="relative flex items-center">
                    <LockKey size={18} className="absolute left-3.5 text-text-muted" />
                    <input
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-border text-xs font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 rounded-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] disabled:opacity-70 text-slate-900 font-extrabold text-xs tracking-wide shadow-xl flex items-center justify-center gap-2 transition-all duration-300"
                  >
                    {isSubmitting ? (
                      <>
                        <CircleNotch size={16} className="animate-spin text-slate-900" />
                        <span>Creating Faculty Workspace...</span>
                      </>
                    ) : (
                      <>
                        <Sparkle size={16} weight="fill" />
                        <span>Register & Launch Dashboard</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Mode Switcher Footer */}
            <div className="pt-4 border-t border-border text-center">
              {authMode === 'login' ? (
                <div>
                  <p className="text-xs text-text-muted mb-2.5">New teacher joining the institute faculty?</p>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('register'); setErrorMsg(null); }}
                    className="w-full py-3 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300/80 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Sparkle size={16} weight="fill" className="text-amber-600" />
                    <span>Register New Faculty ID & Workspace &rarr;</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setErrorMsg(null); }}
                  className="text-xs font-bold text-primary-800 hover:text-primary-900 flex items-center justify-center gap-1.5 mx-auto py-1"
                >
                  <ArrowLeft size={14} weight="bold" />
                  <span>Back to Faculty Sign In</span>
                </button>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
