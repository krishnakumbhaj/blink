'use client';

import { useEffect } from 'react';
import { Spinner } from '@/components/ui/icon';

export interface ConfirmSpec {
  title: string;
  /** Say exactly who this affects. "Delete" alone is not informed consent. */
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  spec: ConfirmSpec | null;
  isBusy?: boolean;
  onCancel: () => void;
}

/**
 * Every destructive action goes through here.
 *
 * The body text is required, not optional, because the whole difficulty with
 * these actions is that "delete" is ambiguous — for me, or for both of us? The
 * dialog exists to answer that before the click, not after.
 */
export default function ConfirmDialog({ spec, isBusy, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!spec) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [spec, isBusy, onCancel]);

  if (!spec) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={() => !isBusy && onCancel()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-foreground">
          {spec.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{spec.body}</p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="h-10 flex-1 rounded-xl border border-input text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void spec.onConfirm()}
            disabled={isBusy}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {isBusy ? <Spinner size={16} /> : spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
