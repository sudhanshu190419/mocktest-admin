import Link from 'next/link';

interface DevModuleCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
}

export default function DevModuleCard({ title, description, href, icon }: DevModuleCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
        </div>
      </div>
    </Link>
  );
}
