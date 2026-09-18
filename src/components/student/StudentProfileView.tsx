'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Envelope,
  Phone,
  GraduationCap,
  Buildings,
  IdentificationBadge,
  CalendarBlank,
  Lock,
  SignOut,
  CheckCircle,
  WarningCircle,
  CircleNotch,
  Sparkle,
  Books,
  ShieldCheck,
  PencilSimple,
  X,
  Check,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentFullProfile,
  updateStudentPersonalInfo,
  updateStudentPassword,
  type StudentFullProfile,
} from '@/services/student/studentProfileWebService';
import { ChangeMobileModal } from '@/components/student/profile/ChangeMobileModal';

export const StudentProfileView: React.FC = () => {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [profile, setProfile] = useState<StudentFullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit personal info state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSuccess, setInfoSuccess] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  // Change mobile modal state
  const [isChangeMobileOpen, setIsChangeMobileOpen] = useState(false);

  // Password update state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Sign out state
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchStudentFullProfile(user?.id);
      if (res.error || !res.data) {
        setError(res.error || 'Failed to load student profile.');
      } else {
        setProfile(res.data);
        setEditName(res.data.name || '');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load profile.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Window focus & visibility sync: automatically refreshes profile if updated on mobile
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchStudentFullProfile(user?.id).then((res) => {
          if (res.data) {
            setProfile(res.data);
            setEditName(res.data.name || '');
          }
        });
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [user?.id]);

  const handleSavePersonalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!editName.trim()) {
      setInfoError('Full name cannot be empty.');
      return;
    }

    setSavingInfo(true);
    setInfoError(null);
    setInfoSuccess(null);

    try {
      const res = await updateStudentPersonalInfo(profile.profileId, {
        name: editName,
      });

      if (res.error || !res.data) {
        setInfoError(res.error || 'Failed to update personal information.');
      } else {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                name: res.data!.name,
              }
            : null
        );
        setInfoSuccess('Personal information updated successfully.');
        setIsEditing(false);
        setTimeout(() => setInfoSuccess(null), 4000);
      }
    } catch (err: any) {
      setInfoError(err?.message || 'Failed to save personal info.');
    } finally {
      setSavingInfo(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await updateStudentPassword(newPassword);
      if (res.error) {
        setPasswordError(res.error);
      } else {
        setPasswordSuccess('Password changed successfully.');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordForm(false);
        setTimeout(() => setPasswordSuccess(null), 4000);
      }
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to update password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/login');
    } catch (err) {
      console.error('Logout error:', err);
      setSigningOut(false);
      setShowSignOutConfirm(false);
    }
  };

  const getInitials = (name?: string): string => {
    if (!name) return 'ST';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // ─── Loading Skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-12 animate-pulse">
        <div className="h-6 w-36 bg-slate-200 rounded-lg" />
        <div className="h-44 bg-slate-200 rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-slate-200 rounded-3xl" />
          <div className="h-64 bg-slate-200 rounded-3xl" />
        </div>
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────────────────────
  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-red-100 rounded-3xl shadow-xs text-center space-y-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 mx-auto">
          <WarningCircle size={32} weight="duotone" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-900">Failed to Load Student Profile</h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">{error || 'Unable to retrieve your student profile.'}</p>
        <div className="pt-2">
          <button
            onClick={loadProfile}
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors shadow-xs"
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* ── Top Header Navigation ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/student/overview"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 mb-1 transition-colors"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Back to Dashboard</span>
          </Link>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Student Profile & Account</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your personal contact details, academic stream, enrolled batches, and account security.
          </p>
        </div>
      </div>

      {/* ── Feedback Banners ───────────────────────────────────────────────── */}
      {infoSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0" />
          <span>{infoSuccess}</span>
        </div>
      )}
      {passwordSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0" />
          <span>{passwordSuccess}</span>
        </div>
      )}

      {/* ── Hero Profile Card ──────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-700 p-6 sm:p-8 text-white shadow-lg">
        {/* Subtle Decorative Backdrop Elements */}
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-48 h-48 rounded-full bg-sky-400/20 blur-xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5 z-10">
          {/* Avatar Circle */}
          <div className="relative shrink-0">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="h-20 w-20 sm:h-22 sm:w-22 rounded-2xl object-cover ring-4 ring-white/30 shadow-md bg-white"
              />
            ) : (
              <div className="flex h-20 w-20 sm:h-22 sm:w-22 items-center justify-center rounded-2xl bg-white text-sky-700 font-black text-2xl ring-4 ring-white/30 shadow-md">
                {getInitials(profile.name)}
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-400 ring-2 ring-white" title="Active Account" />
          </div>

          {/* Identity Information */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                {profile.name}
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[11px] font-black uppercase tracking-wider backdrop-blur-xs border border-white/25">
                <Sparkle size={12} weight="fill" className="text-amber-300" />
                <span>Verified Student</span>
              </span>
            </div>

            <p className="text-xs text-sky-100 font-medium flex items-center gap-1.5">
              <Envelope size={14} />
              <span>{profile.email}</span>
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {profile.instituteName && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/20 text-white text-xs font-semibold backdrop-blur-xs border border-white/10">
                  <Buildings size={14} className="text-sky-300" />
                  <span>{profile.instituteName}</span>
                </span>
              )}
              {profile.streamName && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/20 text-white text-xs font-semibold backdrop-blur-xs border border-white/10">
                  <GraduationCap size={14} className="text-amber-300" />
                  <span>Target: {profile.streamName}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Two-Column Content Layout ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left Column: Personal Information (2 Cols) ──────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card: Personal Details */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                  <User size={18} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Personal Information</h3>
                  <p className="text-[11px] text-slate-400">Keep your contact details updated for institute communications.</p>
                </div>
              </div>

              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-bold transition-colors"
                >
                  <PencilSimple size={13} weight="bold" />
                  <span>Edit Name</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditName(profile.name);
                    setInfoError(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors"
                >
                  <X size={13} weight="bold" />
                  <span>Cancel</span>
                </button>
              )}
            </div>

            {infoError && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <WarningCircle size={16} weight="fill" className="text-red-600 shrink-0" />
                <span>{infoError}</span>
              </div>
            )}

            {!isEditing ? (
              /* Read-only Grid View */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Full Name</span>
                  <p className="text-xs font-black text-slate-900">{profile.name}</p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Phone Number</span>
                    <p className="text-xs font-black text-slate-900 truncate">{profile.phone || '--'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsChangeMobileOpen(true)}
                    className="px-2.5 py-1 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-[11px] font-bold transition-colors shrink-0"
                  >
                    Change
                  </button>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email Address (Managed)</span>
                  <p className="text-xs font-bold text-slate-700 truncate">{profile.email}</p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Official Student ID</span>
                  <p className="text-xs font-mono font-bold text-slate-700">{profile.enrollmentNo || profile.studentId || '--'}</p>
                </div>

                {/* Optional Guardian Details if available */}
                {(profile.guardianName || profile.guardianMobile) && (
                  <div className="sm:col-span-2 p-3.5 rounded-2xl bg-sky-50/40 border border-sky-100 space-y-2">
                    <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">Guardian Details</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">Name</span>
                        <span className="font-bold text-slate-800">{profile.guardianName || '--'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">Mobile</span>
                        <span className="font-bold text-slate-800">{profile.guardianMobile || '--'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">Email</span>
                        <span className="font-bold text-slate-800">{profile.guardianEmail || '--'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Editable Form View */
              <form onSubmit={handleSavePersonalInfo} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Full Name</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Enter your full name"
                      required
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Phone Number</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="tel"
                        value={profile.phone || ''}
                        disabled
                        placeholder="No mobile number registered"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500 cursor-not-allowed"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsChangeMobileOpen(true)}
                      className="px-3.5 py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 text-xs font-bold transition-colors shrink-0"
                    >
                      Change Mobile via OTP
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400">Mobile number changes require password re-authentication and SMS OTP verification.</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Email Address (Managed)</label>
                  <div className="relative">
                    <Envelope size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={profile.email}
                      disabled
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400">Account login email is managed by your institute administrator.</span>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingInfo}
                    className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {savingInfo ? (
                      <>
                        <CircleNotch size={14} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} weight="bold" />
                        <span>Save Name</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Card: Academic & Enrollment Information */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                <Books size={18} weight="bold" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">Course Enrollments</h3>
                <p className="text-[11px] text-slate-400">Your subscribed subject courses.</p>
              </div>
            </div>

            {/* Enrolled Courses Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <GraduationCap size={14} className="text-indigo-600" />
                  <span>Enrolled Courses ({profile.enrolledCourses.length})</span>
                </h4>
                <Link
                  href="/student/courses"
                  className="text-[11px] font-bold text-sky-600 hover:text-sky-700 hover:underline"
                >
                  View All Courses
                </Link>
              </div>

              {profile.enrolledCourses.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center">
                  <p className="text-xs font-bold text-slate-500">No course enrollments found.</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Explore available courses from the My Courses hub.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {profile.enrolledCourses.slice(0, 4).map((c) => (
                    <div
                      key={c.courseId}
                      className="p-3 rounded-2xl bg-white border border-slate-100 hover:border-slate-200 transition-colors flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shrink-0 font-black text-xs">
                          <Books size={16} />
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-extrabold text-slate-900 truncate">{c.title}</h5>
                          <span className="text-[10px] font-semibold text-slate-400">{c.category || 'Academic Course'}</span>
                        </div>
                      </div>

                      <Link
                        href={`/student/courses/${c.courseId}`}
                        className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-sky-50 hover:text-sky-700 text-slate-700 font-bold text-[11px] transition-colors shrink-0"
                      >
                        Open
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Column: Account Security & Sign Out (1 Col) ────────────── */}
        <div className="space-y-6">
          {/* Card: Account Security & Password */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                <ShieldCheck size={16} weight="bold" />
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-900">Account & Security</h3>
                <p className="text-[10px] text-slate-400">Password and account status.</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</span>
                  <span className="text-xs font-black text-emerald-700 flex items-center gap-1 mt-0.5">
                    <CheckCircle size={13} weight="fill" />
                    <span>Active Account</span>
                  </span>
                </div>
                <span className="text-[10px] font-bold text-slate-400">Verified</span>
              </div>

              {/* Password Management */}
              {!showPasswordForm ? (
                <button
                  type="button"
                  onClick={() => setShowPasswordForm(true)}
                  className="w-full p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-left flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Lock size={15} className="text-slate-500" />
                    <div>
                      <span className="text-xs font-extrabold text-slate-800 block">Change Password</span>
                      <span className="text-[10px] text-slate-400">Update your login security credentials</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-sky-600">Edit</span>
                </button>
              ) : (
                <form onSubmit={handleUpdatePassword} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-900">Update Password</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPasswordForm(false);
                        setPasswordError(null);
                      }}
                      className="text-slate-400 hover:text-slate-600 text-xs"
                    >
                      <X size={14} weight="bold" />
                    </button>
                  </div>

                  {passwordError && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">
                      {passwordError}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      required
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      required
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    />
                  </div>

                  <div className="pt-1 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPasswordForm(false)}
                      className="px-3 py-1.5 rounded-xl text-slate-600 text-[11px] font-bold hover:bg-slate-200/60"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold shadow-xs flex items-center gap-1 disabled:opacity-60"
                    >
                      {savingPassword ? <CircleNotch size={12} className="animate-spin" /> : 'Save Password'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Card: Sign Out Action */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-xs font-black text-slate-900">Session Actions</h3>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Sign out of your active student session on this browser.
            </p>

            {!showSignOutConfirm ? (
              <button
                type="button"
                onClick={() => setShowSignOutConfirm(true)}
                className="w-full py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black transition-colors flex items-center justify-center gap-2 shadow-2xs"
              >
                <SignOut size={16} weight="bold" />
                <span>Sign Out Account</span>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200 space-y-3 text-center">
                <p className="text-xs font-bold text-rose-900">Are you sure you want to sign out?</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSignOutConfirm(false)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs flex items-center gap-1"
                  >
                    {signingOut ? <CircleNotch size={13} className="animate-spin" /> : 'Confirm Sign Out'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Change Mobile Modal ───────────────────────────────────────────── */}
      <ChangeMobileModal
        isOpen={isChangeMobileOpen}
        onClose={() => setIsChangeMobileOpen(false)}
        userId={profile.profileId}
        currentPhone={profile.phone}
        currentEmail={profile.email}
        onSuccess={(newPhone) => {
          setProfile((prev) => (prev ? { ...prev, phone: newPhone } : null));
          setInfoSuccess(`Mobile number successfully changed to ${newPhone}.`);
          setTimeout(() => setInfoSuccess(null), 5000);
        }}
      />
    </div>
  );
};
