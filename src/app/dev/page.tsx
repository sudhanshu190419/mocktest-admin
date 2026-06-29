import DevModuleCard from '@/components/dev/DevModuleCard';
import DebugPanel from '@/components/dev/DebugPanel';
import SessionInfo from '@/components/dev/SessionInfo';

const MODULES = [
  {
    title: 'Authentication',
    description: 'Sign up, sign in, session management, role-based access',
    href: '/dev/authentication',
    icon: '🔐',
  },
  {
    title: 'Academic',
    description: 'Streams, subjects, chapters, topics, batches CRUD',
    href: '/dev/academic',
    icon: '📚',
  },
  {
    title: 'Content',
    description: 'Content CRUD, tags, approval workflow, lifecycle management',
    href: '/dev/content',
    icon: '📄',
  },
  {
    title: 'Storage',
    description: 'File upload, signed URLs, resource validation, thumbnail management',
    href: '/dev/storage',
    icon: '💾',
  },
  {
    title: 'Question Bank',
    description: 'Question CRUD, options, explanations, images, status transitions',
    href: '/dev/question-bank',
    icon: '❓',
  },
  {
    title: 'Mock Tests',
    description: 'Test CRUD, question assignment, publish/unpublish workflow',
    href: '/dev/mock-tests',
    icon: '📝',
  },
  {
    title: 'Attempts',
    description: 'Mock attempt management, answer records, auto-save, time tracking',
    href: '/dev/attempts',
    icon: '🔄',
  },
  {
    title: 'Results',
    description: 'Result computation, scoring, rank/percentile, breakdowns',
    href: '/dev/results',
    icon: '📊',
  },
  {
    title: 'Settings',
    description: 'Institute configuration, environment info, console preferences',
    href: '/dev/settings',
    icon: '⚙️',
  },
];

export default function DevDashboardPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Developer Console</h1>
        <p className="text-xs text-gray-500 mt-1">
          Internal QA tool for testing backend modules independently.
          Select a module below to begin.
        </p>
      </div>

      {/* Module Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => (
          <DevModuleCard key={mod.href} {...mod} />
        ))}
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Modules</div>
          <div className="text-2xl font-bold text-gray-100 mt-1">{MODULES.length}</div>
        </div>
        <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Status</div>
          <div className="text-sm font-semibold text-amber-400 mt-1">Development</div>
        </div>
        <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Version</div>
          <div className="text-sm font-semibold text-gray-100 mt-1">v0.1.0-dev</div>
        </div>
      </div>

      {/* Debug Panel */}
      <DebugPanel
        lastOperation="Dashboard loaded"
        info={[
          { label: 'Module Count', value: String(MODULES.length) },
          { label: 'Build Date', value: new Date().toISOString() },
        ]}
      />
    </div>
  );
}
