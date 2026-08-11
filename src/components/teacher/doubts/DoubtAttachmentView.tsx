'use client';

import { useState, useCallback } from 'react';
import { getDoubtAttachmentSignedUrl } from '@/services/doubtAttachmentService';
import type { DoubtAttachment } from '@/types/doubt';

/**
 * Renders one doubt attachment with on-demand signed-URL access.
 *
 * The `doubt-attachments` bucket is private — URLs are short-lived signed
 * URLs generated at the moment of viewing (never cached publicly, never
 * `getPublicUrl`). If generation fails (deleted/unauthorized), the item
 * degrades to "Attachment unavailable" instead of breaking the page.
 */
interface DoubtAttachmentViewProps {
  attachment: DoubtAttachment;
  compact?: boolean;
}

const FILE_LABEL: Record<string, string> = {
  'image/jpeg': 'Image',
  'image/png': 'Image',
  'image/webp': 'Image',
  'application/pdf': 'PDF',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DoubtAttachmentView({ attachment, compact = false }: DoubtAttachmentViewProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const isImage = attachment.mimeType.startsWith('image/');

  const open = useCallback(() => {
    if (signedUrl) {
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // Open a blank window synchronously in the click handler so browsers do
    // NOT treat the (async) navigation as a popup. Its location is set once
    // the signed URL resolves; closed if generation fails.
    // NOTE: the 'noopener' feature string would sever the reference and
    // return null — instead we open a plain blank window and null the
    // opener immediately (equivalent protection).
    const win = window.open('', '_blank');
    if (!win) return;
    win.opener = null;

    setLoading(true);
    setUnavailable(false);
    getDoubtAttachmentSignedUrl(attachment.bucket, attachment.storagePath)
      .then((url) => {
        if (!url) {
          win.close();
          setUnavailable(true);
          return;
        }
        setSignedUrl(url);
        if (!isImage) {
          // PDFs navigate the pre-opened window once the URL resolves.
          win.location.href = url;
        }
      })
      .catch(() => {
        win.close();
        setUnavailable(true);
      })
      .finally(() => setLoading(false));
  }, [attachment.bucket, attachment.storagePath, isImage, signedUrl]);

  if (unavailable) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500">
        Attachment unavailable
      </span>
    );
  }

  const label = FILE_LABEL[attachment.mimeType] ?? 'File';

  if (isImage && signedUrl) {
    return (
      <button
        type="button"
        onClick={open}
        title={`Open ${attachment.storagePath.split('/').pop()}`}
        className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={signedUrl}
          alt="Doubt attachment"
          className={`object-cover ${compact ? 'h-14 w-14' : 'h-24 w-24'}`}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-medium text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
          Open
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
      title={`${attachment.storagePath.split('/').pop()} (${formatBytes(attachment.sizeBytes)})`}
    >
      {label === 'PDF' ? '📄' : '🖼️'} {label}
      {!compact && (
        <span className="text-gray-400 dark:text-gray-500">{formatBytes(attachment.sizeBytes)}</span>
      )}
    </button>
  );
}
