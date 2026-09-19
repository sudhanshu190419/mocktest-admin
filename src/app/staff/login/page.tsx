import type { Metadata } from 'next';
import { StaffLoginClient } from '@/components/auth/StaffLoginClient';

export const metadata: Metadata = {
  title: 'Faculty & Admin Portal — MakeMeTopper',
  description: 'Secure authentication portal for MakeMeTopper faculty and administrators.',
};

export default function StaffLoginPage() {
  return <StaffLoginClient />;
}
