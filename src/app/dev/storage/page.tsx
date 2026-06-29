import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Storage — Dev Console' };

export default function StoragePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Storage</h1>
        <p className="text-xs text-gray-500 mt-1">File upload, signed URLs, resource validation, thumbnail management</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard title="Upload" description="Content-type and resource-type uploads">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>uploadFile — Content-type-based upload</li>
            <li>uploadResource — Resource-type-based upload</li>
            <li>replaceFile — Replace existing file</li>
            <li>uploadThumbnail — Thumbnail upload</li>
          </ul>
        </SectionCard>
        <SectionCard title="Management" description="Read, delete, and URL generation">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>deleteFile — Remove file from storage</li>
            <li>deleteThumbnail — Remove thumbnail</li>
            <li>generateSignedUrl — Create signed download URL</li>
            <li>fileExists — Check file existence</li>
          </ul>
        </SectionCard>
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'storage' }]} />
    </div>
  );
}
