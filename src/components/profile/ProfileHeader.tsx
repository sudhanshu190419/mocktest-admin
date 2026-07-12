'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { BasicInfo } from '@/types/profile';

interface ProfileHeaderProps {
  basicInfo: BasicInfo;
  completionPercentage: number;
  onAvatarChange?: (file: File) => void;
  className?: string;
}

export function ProfileHeader({
  basicInfo,
  completionPercentage,
  onAvatarChange,
  className,
}: ProfileHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    if (onAvatarChange) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onAvatarChange) {
      onAvatarChange(file);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900', className)}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div
            className={cn(
              'relative h-20 w-20 overflow-hidden rounded-full',
              onAvatarChange && 'cursor-pointer ring-2 ring-gray-200 ring-offset-2 transition-all hover:ring-blue-400 dark:ring-gray-600',
            )}
            onClick={handleAvatarClick}
            role={onAvatarChange ? 'button' : undefined}
            tabIndex={onAvatarChange ? 0 : undefined}
            onKeyDown={(e) => {
              if (onAvatarChange && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleAvatarClick();
              }
            }}
            aria-label={onAvatarChange ? 'Change profile photo' : 'Profile photo'}
          >
            {basicInfo.avatarUrl ? (
              <Image
                src={basicInfo.avatarUrl}
                alt={basicInfo.fullName}
                fill
                className="object-cover"
                sizes="80px"
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-blue-600 text-xl font-bold text-white">
                {getInitials(basicInfo.fullName)}
              </div>
            )}
          </div>
          {onAvatarChange && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700"
                aria-label="Upload profile photo"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {basicInfo.fullName}
            </h1>
            {basicInfo.emailVerified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm font-medium text-gray-600 dark:text-gray-400">
            {basicInfo.employeeCode && (
              <span className="mr-2 font-mono text-[11px] uppercase tracking-wider text-gray-400">
                {basicInfo.employeeCode}
              </span>
            )}
            {basicInfo.role === 'teacher' ? 'Faculty' : basicInfo.role}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            {basicInfo.instituteName ?? 'Institute not specified'}
          </p>
        </div>

        {/* Completion */}
        <div className="flex flex-shrink-0 flex-col items-center">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="15.5"
                fill="none"
                stroke="#E5E7EB"
                strokeWidth="3"
                className="dark:stroke-gray-700"
              />
              <circle
                cx="18" cy="18" r="15.5"
                fill="none"
                stroke={completionPercentage >= 80 ? '#10B981' : completionPercentage >= 50 ? '#F59E0B' : '#EF4444'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(completionPercentage / 100) * 97.4} 97.4`}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <span className="absolute text-xs font-bold text-gray-900 dark:text-gray-100">
              {completionPercentage}%
            </span>
          </div>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Complete
          </span>
        </div>
      </div>
    </div>
  );
}
