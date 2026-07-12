'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getFullTeacherProfile, updateTeacherProfile, uploadProfileAvatar } from '@/services/profileService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { FormSkeleton } from '@/components/ui/LoadingSkeleton';
import type { TeacherProfileData } from '@/types/profile';

export default function EditProfilePage() {
  const router = useRouter();
  const { teacherProfile, instituteId, user } = useAuth();
  const teacherId = teacherProfile?.id ?? user?.id;
  const [profileData, setProfileData] = useState<TeacherProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [form, setForm] = useState({
    fullName: '',
    displayName: '',
    phone: '',
    bio: '',
    qualification: '',
    experience: '',
    specialization: '',
    department: '',
    designation: '',
    linkedIn: '',
    website: '',
    portfolio: '',
  });

  const fetchProfile = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    const result = await getFullTeacherProfile(teacherId, instituteId);
    if (result.success && result.data) {
      setProfileData(result.data);
      const { basicInfo, professionalInfo, contactInfo, bio } = result.data;
      setForm({
        fullName: basicInfo.fullName,
        displayName: basicInfo.displayName ?? '',
        phone: contactInfo.mobile,
        bio: bio ?? '',
        qualification: professionalInfo.qualification === 'Not specified' ? '' : professionalInfo.qualification,
        experience: professionalInfo.experience === 'Not specified' ? '' : professionalInfo.experience,
        specialization: professionalInfo.specialization === 'General' ? '' : professionalInfo.specialization,
        department: professionalInfo.department === 'Not specified' ? '' : professionalInfo.department,
        designation: professionalInfo.designation === 'Faculty' ? '' : professionalInfo.designation,
        linkedIn: contactInfo.linkedIn ?? '',
        website: contactInfo.website ?? '',
        portfolio: contactInfo.portfolio ?? '',
      });
    } else {
      setError(result.error ?? 'Failed to load profile.');
    }
    setLoading(false);
  }, [teacherId, instituteId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherId) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    const result = await updateTeacherProfile(teacherId, {
      fullName: form.fullName,
      displayName: form.displayName || undefined,

      bio: form.bio || undefined,
      qualification: form.qualification || undefined,
      experience: form.experience || undefined,
      specialization: form.specialization || undefined,
      department: form.department || undefined,
      designation: form.designation || undefined,
    });

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        router.push('/teacher/profile');
      }, 1500);
    } else {
      setError(result.error ?? 'Failed to save profile.');
    }
    setSaving(false);
  };

  const handleAvatarChange = async (file: File) => {
    if (!teacherId) return;
    const result = await uploadProfileAvatar(teacherId, file);
    if (result.success) {
      await fetchProfile();
    } else {
      setError(result.error ?? 'Failed to upload avatar.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Profile" description="Update your personal and professional information" />
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <FormSkeleton />
        </div>
      </div>
    );
  }

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600';
  const labelClass = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400';
  const sectionClass = 'space-y-4';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Profile"
        description="Update your personal and professional information"
      />

      {profileData && (
        <ProfileHeader
          basicInfo={profileData.basicInfo}
          completionPercentage={profileData.completionPercentage}
          onAvatarChange={handleAvatarChange}
        />
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
          Profile saved successfully! Redirecting...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Information */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-5 text-sm font-semibold text-gray-900 dark:text-gray-100">Personal Information</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="fullName">Full Name *</label>
              <input id="fullName" type="text" required value={form.fullName} onChange={(e) => handleChange('fullName', e.target.value)} className={inputClass} placeholder="Your full name" />
            </div>
            <div>
              <label className={labelClass} htmlFor="displayName">Display Name</label>
              <input id="displayName" type="text" value={form.displayName} onChange={(e) => handleChange('displayName', e.target.value)} className={inputClass} placeholder="How you'd like to be addressed" />
            </div>
            <div>
              <label className={labelClass} htmlFor="phone">Mobile Number</label>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                readOnly
                tabIndex={-1}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 cursor-not-allowed"
              />
              <p className="mt-1 text-[10px] text-gray-400">Mobile number cannot be changed. Contact admin to update.</p>
            </div>
          </div>
        </div>

        {/* Professional Information */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-5 text-sm font-semibold text-gray-900 dark:text-gray-100">Professional Information</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="department">Department</label>
              <input id="department" type="text" value={form.department} onChange={(e) => handleChange('department', e.target.value)} className={inputClass} placeholder="e.g. Science" />
            </div>
            <div>
              <label className={labelClass} htmlFor="designation">Designation</label>
              <input id="designation" type="text" value={form.designation} onChange={(e) => handleChange('designation', e.target.value)} className={inputClass} placeholder="e.g. Senior Faculty" />
            </div>
            <div>
              <label className={labelClass} htmlFor="specialization">Specialization</label>
              <input id="specialization" type="text" value={form.specialization} onChange={(e) => handleChange('specialization', e.target.value)} className={inputClass} placeholder="e.g. Physics" />
            </div>
            <div>
              <label className={labelClass} htmlFor="qualification">Qualification</label>
              <input id="qualification" type="text" value={form.qualification} onChange={(e) => handleChange('qualification', e.target.value)} className={inputClass} placeholder="e.g. M.Sc, PhD" />
            </div>
            <div>
              <label className={labelClass} htmlFor="experience">Experience</label>
              <input id="experience" type="text" value={form.experience} onChange={(e) => handleChange('experience', e.target.value)} className={inputClass} placeholder="e.g. 8 years of teaching experience" />
            </div>
          </div>
        </div>

        {/* Biography */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-5 text-sm font-semibold text-gray-900 dark:text-gray-100">Biography</h3>
          <div>
            <label className={labelClass} htmlFor="bio">Bio</label>
            <textarea
              id="bio"
              rows={4}
              value={form.bio}
              onChange={(e) => handleChange('bio', e.target.value)}
              className={inputClass}
              placeholder="Tell your students about yourself, your teaching philosophy, and areas of expertise..."
            />
          </div>
        </div>

        {/* Social Links (Future-ready) */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Social Links</h3>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">Future Ready</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="linkedIn">LinkedIn Profile</label>
              <input id="linkedIn" type="url" value={form.linkedIn} onChange={(e) => handleChange('linkedIn', e.target.value)} className={inputClass} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
              <label className={labelClass} htmlFor="website">Website</label>
              <input id="website" type="url" value={form.website} onChange={(e) => handleChange('website', e.target.value)} className={inputClass} placeholder="https://..." />
            </div>
            <div>
              <label className={labelClass} htmlFor="portfolio">Portfolio</label>
              <input id="portfolio" type="url" value={form.portfolio} onChange={(e) => handleChange('portfolio', e.target.value)} className={inputClass} placeholder="https://..." />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
