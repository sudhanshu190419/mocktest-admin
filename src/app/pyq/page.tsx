import type { Metadata } from 'next';
import { PYQCatalog } from '@/components/marketing/PYQCatalog';
import { getPYQPackages } from '@/services/pyqCatalogService';

export const metadata: Metadata = {
  title: 'Previous Year Question Packages — MakeMeTopper',
  description:
    'Browse solved previous-year question packages for NEET, JEE, CUET, and Foundation. Practice official exam papers under timed exam conditions.',
};

export default async function PYQPage() {
  const packages = await getPYQPackages();
  return <PYQCatalog packages={packages} />;
}
