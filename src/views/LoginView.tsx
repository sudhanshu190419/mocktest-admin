'use client';

import React, { useState } from 'react';
import { 
  Phone, 
  LockKey, 
  ArrowRight, 
  CircleNotch, 
  Sparkle,
  ShieldCheck
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';

export const LoginView: React.FC = () => {
  const { signIn } = useAuth();
  
  // Login State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !password.trim()) {
      setErrorMsg('Please enter both your mobile number and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const { error } = await signIn(phoneNumber.trim(), password);
    if (error) {
      setErrorMsg(error);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen w-full bg-navy-900 flex items-center justify-center p-4 sm:p-6 lg:p-10 font-sans selection:bg-amber-400 selection:text-slate-900">
      <div className="w-full max-w-6xl h-full min-h-[680px] rounded-[3rem] bg-surface shadow-2xl border border-white/10 overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative animate-fadeIn">
        
        {/* Left Panel (Span 7) - Physics & Quantum Animation Engine */}
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

        {/* Right Panel (Span 5) - Strict Professional Vault (Sign In Only) */}
        <div className="lg:col-span-5 bg-surface p-8 sm:p-10 flex flex-col justify-center relative z-10 overflow-y-auto max-h-[90vh]">
          <div className="max-w-sm mx-auto w-full space-y-6 my-auto">
            
            {/* Form Header */}
            <div>
              <span className="text-xs font-bold font-mono tracking-wider uppercase text-primary-800 bg-primary-100 px-3 py-1 rounded-full">
                Faculty & Admin Access
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight mt-3">
                Sign In to Portal
              </h2>
              <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                Enter your registered mobile number and password to access the academic console.
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

            {/* SIGN IN FORM */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
                  Mobile Number
                </label>
                <div className="relative flex items-center">
                  <Phone size={18} className="absolute left-3.5 text-text-muted" />
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+919876543210"
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-2xl bg-slate-50 border border-border text-sm font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                    Password
                  </label>
                </div>
                <div className="relative flex items-center">
                  <LockKey size={18} className="absolute left-3.5 text-text-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-2xl bg-slate-50 border border-border text-sm font-medium text-text-primary placeholder:text-slate-400 outline-none focus:border-primary-800 focus:bg-white transition-all font-mono"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-full bg-primary-800 hover:bg-primary-900 active:scale-[0.99] disabled:opacity-70 text-white font-bold text-xs tracking-wider uppercase shadow-xl flex items-center justify-center gap-2 transition-all duration-300"
                >
                  {isSubmitting ? (
                    <>
                      <CircleNotch size={18} className="animate-spin text-white" />
                      <span>Authenticating Credentials...</span>
                    </>
                  ) : (
                    <>
                      <span>Authorize Session</span>
                      <ArrowRight size={16} weight="bold" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Information Notice for Teachers */}
            <div className="pt-6 border-t border-border">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-text-muted text-xs leading-relaxed flex items-start gap-2.5">
                <ShieldCheck size={20} weight="duotone" className="text-primary-700 shrink-0 mt-0.5" />
                <p>
                  Faculty and administrative accounts are provisioned directly by the <strong className="text-text-primary font-semibold">Institute Super Administrator</strong>. Contact administration if you require access.
                </p>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
