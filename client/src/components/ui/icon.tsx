'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert01Icon,
  ArrowLeft01Icon,
  Attachment01Icon,
  Camera01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  File01Icon,
  Forward02Icon,
  Image02Icon,
  Loading03Icon,
  Logout01Icon,
  Message01Icon,
  MessageAdd01Icon,
  MoreHorizontalIcon,
  Search01Icon,
  Sent02Icon,
  Tick02Icon,
  TickDouble02Icon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserGroupIcon,
  UserRemove01Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

/**
 * Every icon in the app comes from here.
 *
 * HugeIcons ships ~5,500 icons as data, rendered through one <HugeiconsIcon>
 * component rather than one component per icon. Funnelling them through a single
 * named map means a component imports `<Icon name="send" />` and never touches
 * the library directly — so swapping icon sets, or changing the default stroke,
 * is a one-file change instead of a sweep through thirty files.
 */
export const ICONS = {
  search: Search01Icon,
  send: Sent02Icon,
  back: ArrowLeft01Icon,
  close: Cancel01Icon,
  logout: Logout01Icon,
  message: Message01Icon,
  newMessage: MessageAdd01Icon,
  people: UserGroupIcon,
  follow: UserAdd01Icon,
  following: UserCheck01Icon,
  unfollow: UserRemove01Icon,
  pending: Clock01Icon,
  accept: Tick02Icon,
  tick: Tick02Icon,
  tickDouble: TickDouble02Icon,
  alert: Alert01Icon,
  spinner: Loading03Icon,
  show: ViewIcon,
  hide: ViewOffSlashIcon,
  image: Image02Icon,
  camera: Camera01Icon,
  delete: Delete02Icon,
  more: MoreHorizontalIcon,
  attach: Attachment01Icon,
  file: File01Icon,
  download: Download01Icon,
  forward: Forward02Icon,
  copy: Copy01Icon,
  /** The rail: Chats and Community. */
  chats: Message01Icon,
  community: UserGroupIcon,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  className?: string;
  /** Pixel size. Defaults to 20 — the size most of this UI wants. */
  size?: number;
  strokeWidth?: number;
  'aria-label'?: string;
}

export function Icon({ name, className, size = 20, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      size={size}
      strokeWidth={strokeWidth}
      className={cn('shrink-0', className)}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    />
  );
}

/** The spinner is used everywhere; spare every caller the animate-spin class. */
export function Spinner({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <Icon name="spinner" size={size} className={cn('animate-spin', className)} />
  );
}
