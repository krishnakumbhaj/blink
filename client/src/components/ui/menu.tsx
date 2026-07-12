'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Renders in the destructive style and, by convention, asks for confirmation. */
  destructive?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  label: string;
  align?: 'left' | 'right';
  /** Hidden until the row is hovered, on pointer devices only. */
  subtle?: boolean;
  className?: string;
}

/**
 * A small dropdown. Deliberately hand-rolled rather than pulling in another
 * Radix package for ~40 lines of behaviour: open, close on outside click, close
 * on Escape, close on select.
 */
export default function Menu({ items, label, align = 'right', subtle, className }: MenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground',
          // On touch there is no hover, so a subtle button would be invisible.
          // Reveal on hover only where hover actually exists.
          subtle && !isOpen && 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
        )}
      >
        <Icon name="more" size={16} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                item.destructive
                  ? 'text-destructive hover:bg-secondary'
                  : 'text-foreground hover:bg-secondary'
              )}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              <span className={cn(item.destructive && 'font-medium')}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
