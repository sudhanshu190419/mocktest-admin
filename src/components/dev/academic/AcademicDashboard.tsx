'use client';

interface AcademicDashboardProps {
  onSelectEntity: (entity: string) => void;
}

const ENTITY_CARDS = [
  { id: 'streams', label: 'Streams', description: 'Exam streams (NEET, JEE, etc.)', icon: '🎓', count: 5 },
  { id: 'subjects', label: 'Subjects', description: 'Subjects within streams (Physics, Chemistry, etc.)', icon: '📖', count: 5 },
  { id: 'chapters', label: 'Chapters', description: 'Chapters within subjects', icon: '📑', count: 5 },
  { id: 'topics', label: 'Topics', description: 'Topics within chapters', icon: '🔖', count: 5 },
  { id: 'batches', label: 'Batches', description: 'Student delivery batches', icon: '👥', count: 5 },
];

export default function AcademicDashboard({ onSelectEntity }: AcademicDashboardProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Academic Module</h1>
        <p className="text-xs text-gray-500 mt-1">
          Select an entity below to test CRUD operations, filters, and cache invalidation.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ENTITY_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectEntity(card.id)}
            className="block rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{card.icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-100">{card.label}</h3>
                <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{card.description}</p>
                <p className="mt-2 text-[10px] text-gray-600">
                  Hooks: use{card.label.slice(0, -1)}s, useCreate{card.label.slice(0, -1)}, useUpdate{card.label.slice(0, -1)}, useDelete{card.label.slice(0, -1)}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
