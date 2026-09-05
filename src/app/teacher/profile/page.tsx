'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getFullTeacherProfile, uploadProfileAvatar } from '@/services/profileService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileSection, ProfileField, ProfileDivider } from '@/components/profile/ProfileSection';
import { ProfileCompletionCard } from '@/components/profile/ProfileCompletionCard';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { cn } from '@/lib/utils';
import type { TeacherProfileData } from '@/types/profile';

export default function ProfilePage() {
  const router = useRouter();
  const { teacherProfile, instituteId, user } = useAuth();
  const teacherId = teacherProfile?.id ?? user?.id;
  const [profileData, setProfileData] = useState<TeacherProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError(null);
    const result = await getFullTeacherProfile(teacherId, instituteId);
    if (result.success && result.data) {
      setProfileData(result.data);
    } else {
      setError(result.error ?? 'Failed to load profile.');
    }
    setLoading(false);
  }, [teacherId, instituteId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleAvatarChange = useCallback(async (file: File) => {
    if (!teacherId) return;
    setUploading(true);
    const result = await uploadProfileAvatar(teacherId, file);
    if (result.success) {
      await fetchProfile();
    } else {
      setError(result.error ?? 'Failed to upload avatar.');
    }
    setUploading(false);
  }, [teacherId, fetchProfile]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" description="View and manage your teacher profile" />
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Skeleton className="h-80 rounded-xl lg:col-span-2" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !profileData) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" description="View and manage your teacher profile" />
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={fetchProfile}
            className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" description="View and manage your teacher profile" />
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <p className="text-sm text-gray-500">Profile data not available. Please ensure you are logged in as a teacher.</p>
        </div>
      </div>
    );
  }

  const { basicInfo, professionalInfo, teachingInfo, contactInfo, bio, completionPercentage, completionChecklist } = profileData;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="View and manage your teacher profile"
        actions={
          <button
            type="button"
            onClick={() => router.push('/teacher/profile/edit')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit Profile
          </button>
        }
      />

      {/* Profile Header */}
      <ProfileHeader
        basicInfo={basicInfo}
        completionPercentage={completionPercentage}
        onAvatarChange={handleAvatarChange}
      />

      {/* Error toast */}
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Personal Information */}
          <ProfileSection title="Personal Information" onEdit={() => router.push('/teacher/profile/edit')}>
            <dl className="divide-y divide-gray-100 dark:divide-gray-800">
              <ProfileField label="Full Name" value={basicInfo.fullName} />
              <ProfileDivider />
              <ProfileField label="Display Name" value={basicInfo.displayName} />
              <ProfileDivider />
              <ProfileField label="Email" value={contactInfo.email} />
              <ProfileDivider />
              <ProfileField label="Phone" value={contactInfo.mobile} />
              <ProfileDivider />
              <ProfileField label="Qualification" value={professionalInfo.qualification} />
            </dl>
          </ProfileSection>

          {/* Professional Information */}
          <ProfileSection title="Professional Information" onEdit={() => router.push('/teacher/profile/edit')}>
            <dl className="divide-y divide-gray-100 dark:divide-gray-800">
              <ProfileField label="Department" value={professionalInfo.department} />
              <ProfileDivider />
              <ProfileField label="Designation" value={professionalInfo.designation} />
              <ProfileDivider />
              <ProfileField label="Specialization" value={professionalInfo.specialization} />
              <ProfileDivider />
              <ProfileField label="Experience" value={professionalInfo.experience} />
            </dl>
          </ProfileSection>

          {/* Biography */}
          {bio && (
            <ProfileSection title="Biography" onEdit={() => router.push('/teacher/profile/edit')}>
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{bio}</p>
            </ProfileSection>
          )}

          {/* Teaching Information */}
          <ProfileSection title="Teaching Information">
            <dl className="divide-y divide-gray-100 dark:divide-gray-800">
              <ProfileField
                label="Assigned Subjects"
                value={teachingInfo.assignedSubjects.length > 0 ? teachingInfo.assignedSubjects.join(', ') : 'None assigned'}
              />
              <ProfileDivider />
              <ProfileField
                label="Assigned Batches"
                value={teachingInfo.assignedBatches.length > 0 ? teachingInfo.assignedBatches.map((b) => b.batchName).join(', ') : 'None assigned'}
              />
              <ProfileDivider />
              <ProfileField
                label="Employee Code"
                value={basicInfo.employeeCode}
                mono
              />
              <ProfileDivider />
              <ProfileField
                label="Joining Date"
                value={basicInfo.joiningDate ? new Date(basicInfo.joiningDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined}
              />
            </dl>
          </ProfileSection>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <ProfileCompletionCard items={completionChecklist} percentage={completionPercentage} />

          {/* Quick Stats */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Stats</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Assigned Subjects</span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{teachingInfo.assignedSubjects.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Assigned Batches</span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{teachingInfo.assignedBatches.length}</span>
              </div>
              <div className="h-px bg-gray-100 dark:bg-gray-700" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Account Type</span>
                <span className="text-xs font-semibold capitalize text-gray-900 dark:text-gray-100">{basicInfo.role}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Institute ID</span>
                <span className="font-mono text-[10px] text-gray-500">{basicInfo.instituteId?.slice(0, 12) ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Navigation Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Links</h3>
            <div className="space-y-1">
              {[
                { label: 'Activity Log', href: '/teacher/profile/activity', icon: '📋' },
                { label: 'Security Settings', href: '/teacher/profile/security', icon: '🔒' },
              ].map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => router.push(link.href)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <span className="text-xs">{link.icon}</span>
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
