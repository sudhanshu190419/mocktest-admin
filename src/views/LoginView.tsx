'use client';

import React, { useState } from 'react';
import { 
  Phone, 
  LockKey, 
  ArrowRight, 
  CircleNotch, 
  Sparkle,
  IdentificationCard,
  User,
  Buildings,
  MagicWand,
  ArrowLeft,
  ArrowClockwise,
  CheckCircle
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

export const LoginView: React.FC = () => {
  const { signIn, registerTeacher, verifyRegistrationOtp, resendRegistrationOtp, cancelOtpVerification, needsOtpVerification, pendingPhone } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'otp'>('login');
  
  // Login State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  
  // Register State
  const [fullName, setFullName] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [department, setDepartment] = useState('Physics & Applied Mechanics');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // OTP State
  const [otpCode, setOtpCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auto-switch to OTP mode when registration sends OTP
  React.useEffect(() => {
    if (needsOtpVerification && pendingPhone) {
      setAuthMode('otp');
      setSuccessMsg('OTP sent to ' + pendingPhone);
      setCountdown(60);
    }
  }, [needsOtpVerification, pendingPhone]);

  // Countdown timer for OTP resend
  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !password.trim()) {
      setErrorMsg('Please enter both your mobile number and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const { error } = await signIn(phoneNumber, password);
    if (error) {
      setErrorMsg(error);
    }
    setIsSubmitting(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !facultyId.trim() || !regPhone.trim() || !regPassword.trim()) {
      setErrorMsg('Please complete Full Name, Faculty ID, Mobile Number, and Password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const { error } = await registerTeacher(
      regPhone.trim(),
      regPassword,
      facultyId.trim(),
      fullName.trim(),
      department
    );

    if (error) {
      setErrorMsg(error);
      setIsSubmitting(false);
    } else {
      setIsSubmitting(false);
      // OTP is sent — effect will switch to OTP mode
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the OTP code sent to your phone.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const { error } = await verifyRegistrationOtp(otpCode.trim());
    if (error) {
      setErrorMsg(error);
      setSuccessMsg(null);
    }
    setIsSubmitting(false);
  };

  const handleResendOtp = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    const { error } = await resendRegistrationOtp();
    if (error) {
      setErrorMsg(error);
    } else {
      setSuccessMsg('New OTP sent to ' + pendingPhone);
      setCountdown(60);
    }
    setIsSubmitting(false);
  };

  const handleCancelOtp = () => {
    cancelOtpVerification();
    setAuthMode('register');
    setOtpCode('');
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleAutoGenId = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const deptPrefix = department.toLowerCase().includes('physics') ? 'phy' :
                       department.toLowerCase().includes('chemistry') ? 'chem' :
                       department.toLowerCase().includes('math') ? 'math' :
                       department.toLowerCase().includes('bio') ? 'bio' : 'cs';
    const newId = `t-${randomNum}-${deptPrefix}`;
    setFacultyId(newId);
    if (!regPhone) {
      setRegPhone('+91');
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
                {authMode === 'login' ? 'Faculty Access' : authMode === 'otp' ? 'Verify OTP' : 'New Faculty Onboarding'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight mt-3">
                {authMode === 'login' ? 'Sign In to Portal' : authMode === 'otp' ? 'Enter Verification Code' : 'Register Faculty ID'}
              </h2>
              <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                {authMode === 'login' 
                  ? 'Enter your registered mobile number to access your teacher dashboard.'
                  : authMode === 'otp' 
                  ? 'Enter the 6-digit code sent to your registered mobile number.'
                  : 'Initialize your teacher profile and obtain instant workspace authorization.'}
              </p>
            </div>

            {/* Success Banner */}
            {successMsg && (
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2.5">
                <span className="font-bold">✓</span>
                <span>{successMsg}</span>
              </div>
            )}

            {/* Error Banner */}
            {errorMsg && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium flex items-start gap-2.5 animate-shake">
                <span className="font-bold">Notice:</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* MODE 3: OTP VERIFICATION FORM */}
            {authMode === 'otp' ? (
              <form onSubmit={handleVerifyOtp} className="space-y-5">
                {/* Phone Display */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-border text-center">
                  <p className="text-[11px] text-text-muted uppercase tracking-wider font-bold mb-1">Code sent to</p>
                  <p className="text-sm font-bold text-text-primary font-mono">{pendingPhone}</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
                    OTP Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    required
                    maxLength={6}
                    className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 border border-border text-center text-lg font-bold tracking-[0.5em] text-text-primary placeholder:text-slate-300 outline-none focus:border-primary-800 focus:bg-white focus:ring-4 focus:ring-primary-800/10 transition-all font-mono"
                  />
                </div>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={isSubmitting || otpCode.length < 4}
                    className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-70 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2.5 transition-all duration-300"
                  >
                    {isSubmitting ? (
                      <>
                        <CircleNotch size={18} className="animate-spin text-white" />
                        <span>Verifying Code...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={18} weight="fill" />
                        <span>Verify & Complete Registration</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Resend & Cancel */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={isSubmitting || countdown > 0}
                    onClick={handleResendOtp}
                    className="flex items-center gap-1.5 text-xs font-bold text-primary-800 hover:text-primary-900 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowClockwise size={14} weight="bold" className={countdown > 0 ? 'animate-spin' : ''} />
                    {countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelOtp}
                    className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : authMode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
                    Mobile Number
                  </label>
                  <div className="relative flex items-center">
                    <Phone size={20} className="absolute left-4 text-text-muted" />
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+919876543210"
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
                    Mobile Number
                  </label>
                  <div className="relative flex items-center">
                    <Phone size={18} className="absolute left-3.5 text-text-muted" />
                    <input
                      type="tel"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="+919876543210"
                      required
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
