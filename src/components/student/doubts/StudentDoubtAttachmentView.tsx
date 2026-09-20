'use client';

import React, { useState, useCallback } from 'react';
import { getDoubtAttachmentSignedUrl } from '@/services/doubtAttachmentService';
import type { DoubtAttachment } from '@/types/doubt';

interface StudentDoubtAttachmentViewProps {
  attachment: DoubtAttachment;
  compact?: boolean;
}

const FILE_LABEL: Record<string, string> = {
  'image/jpeg': 'Image',
  'image/png': 'Image',
  'image/webp': 'Image',
  'application/pdf': 'PDF Document',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StudentDoubtAttachmentView({ attachment, compact = false }: StudentDoubtAttachmentViewProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const isImage = attachment.mimeType.startsWith('image/');

  const open = useCallback(() => {
    if (signedUrl) {
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
      return;
    }

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
      <span className="inline-flex items-center gap-1.5 rounded-xl bg-paper px-2.5 py-1 text-caption font-medium text-ink-muted">
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
        title="View image"
        className="group relative overflow-hidden rounded-2xl border border-line shadow-xs hover:border-line transition-all"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={signedUrl}
          alt="Doubt attachment"
          className={`object-cover ${compact ? 'h-14 w-14' : 'h-24 w-24'}`}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-ink/40 text-caption font-bold text-white opacity-0 transition group-hover:opacity-100">
          View ↗
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-xl bg-paper border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sky-tint hover:text-brand-hover hover:border-line transition-all disabled:opacity-50"
    >
      <span>{label === 'PDF Document' ? '📄' : '📎'}</span>
      <span>{label}</span>
      {!compact && (
        <span className="text-caption text-ink-muted font-normal">({formatBytes(attachment.sizeBytes)})</span>
      )}
    </button>
  );
}
