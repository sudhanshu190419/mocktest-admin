'use client';

interface ContentDashboardProps {
  activePanel: string | null;
  onSelect: (panel: string) => void;
}

const PANELS = [
  { id: 'content', label: '📄 Content', desc: 'Create, read, update, delete content with file upload and lifecycle transitions' },
  { id: 'tags', label: '🏷 Tags', desc: 'Tag CRUD, attach/detach/replace tags, view content-tag relations' },
  { id: 'approvals', label: '✅ Approval Requests', desc: 'Approval workflow — submit, assign, approve, reject, reopen, cancel' },
  { id: 'storage', label: '📂 Storage Inspector', desc: 'File upload, thumbnail, signed URLs, file exists check, delete' },
];

export default function ContentDashboard({ activePanel, onSelect }: ContentDashboardProps) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-3">Content Module</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`text-left rounded border p-4 transition-colors ${
              activePanel === p.id
                ? 'border-blue-500 bg-blue-950/30'
                : 'border-gray-700 bg-gray-900 hover:border-gray-600'
            }`}
          >
            <div className="text-sm font-medium text-gray-100">{p.label}</div>
            <div className="text-[11px] text-gray-500 mt-1">{p.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
