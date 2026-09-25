'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';

export interface StudentPyqPurchaseItem {
  purchaseId: string;
  packageId: string;
  purchasedAt: string;
  packageName?: string;
}

export const studentPyqKeys = {
  all: ['student-pyq-purchases'] as const,
  byStudent: (studentId: string | null) => ['student-pyq-purchases', studentId] as const,
};

export async function fetchStudentPyqPurchases(studentId: string | null): Promise<StudentPyqPurchaseItem[]> {
  if (!studentId) return [];

  const { data, error } = await supabase
    .from('student_pyq_purchases')
    .select(`
      purchase_id,
      package_id,
      purchased_at,
      pyq_packages (
        package_id,
        name
      )
    `)
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (error) {
    console.warn('[useStudentPyqPurchases] Failed to fetch PYQ purchases:', error.message);
    return [];
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row: any) => {
    const pkg = Array.isArray(row.pyq_packages) ? row.pyq_packages[0] : row.pyq_packages;
    return {
      purchaseId: row.purchase_id,
      packageId: row.package_id,
      purchasedAt: row.purchased_at,
      packageName: pkg?.name || undefined,
    };
  });
}

export function useStudentPyqPurchases(studentId: string | null) {
  const query = useQuery({
    queryKey: studentPyqKeys.byStudent(studentId),
    queryFn: () => fetchStudentPyqPurchases(studentId),
    enabled: !!studentId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const purchases = query.data ?? [];
  const purchasedPackageIds = purchases.map((p) => p.packageId);
  const hasPurchasedPyq = purchasedPackageIds.length > 0;

  return {
    ...query,
    purchases,
    purchasedPackageIds,
    hasPurchasedPyq,
  };
}
