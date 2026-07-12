'use client';

import dayjs from 'dayjs';
import { Icon } from '@/components/ui/icon';
import Menu, { type MenuItem } from '@/components/ui/menu';
import { useToast } from '@/components/ui/use-toast';
import Attachments from './Attachments';
import { type DeleteScope } from '@/lib/chat-api';
import { getMessageStatus, type ChatMessage } from '@/types/chat';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onDelete: (scope: DeleteScope) => void;
  onForward: () => void;
}

/**
 * Your bubbles are black, so the ticks sit on black and are drawn in white.
 * Sent → one tick. Delivered → two, dimmed. Read → two, full strength.
 */
function ReadReceipt({ message }: { message: ChatMessage }) {
  const status = getMessageStatus(message);

  return (
    <Icon
      name={status === 'sent' ? 'tick' : 'tickDouble'}
      size={14}
      className={status === 'read' ? 'text-primary-foreground' : 'text-primary-foreground/50'}
      aria-label={status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent'}
    />
  );
}

export default function MessageBubble({
  message,
  isOwn,
  onDelete,
  onForward,
}: MessageBubbleProps) {
  const { toast } = useToast();
  const hasText = message.text.trim().length > 0;
  const hasAttachments = message.attachments.length > 0;

  /**
   * A retracted message. Deliberately still occupies a row: a message that
   * simply vanished would look like a bug, and would leave the other person
   * wondering whether they imagined it.
   */
  if (message.deletedForEveryone) {
    return (
      <div className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'flex max-w-[80%] items-center gap-1.5 rounded-2xl border border-dashed border-border px-3.5 py-2 sm:max-w-[65%]',
            isOwn ? 'rounded-br-md' : 'rounded-bl-md'
          )}
        >
          <Icon name="delete" size={14} className="text-muted-foreground" />
          <p className="text-sm italic text-muted-foreground">
            {isOwn ? 'You deleted this message' : 'This message was deleted'}
          </p>
          <time
            dateTime={message.createdAt}
            className="ml-1 text-[10px] tabular-nums text-muted-foreground"
          >
            {dayjs(message.createdAt).format('HH:mm')}
          </time>
        </div>
      </div>
    );
  }

  /**
   * The clipboard API needs a secure context — https, or localhost. It also
   * rejects if the document is not focused. Either way the user gets told,
   * rather than pressing Copy and being met with silence.
   */
  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      toast({ title: 'Copied' });
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  }

  // Anyone may hide a message from themselves or pass it on. Only the sender may
  // retract one for both — otherwise a recipient could erase what you said.
  const menuItems: MenuItem[] = [
    // Nothing to copy on a photo-only message, so do not offer it.
    ...(hasText
      ? [{ label: 'Copy text', icon: 'copy' as const, onSelect: () => void copyText() }]
      : []),
    { label: 'Forward', icon: 'forward', onSelect: onForward },
    { label: 'Delete for me', icon: 'delete', onSelect: () => onDelete('me'), destructive: true },
    ...(isOwn
      ? [
          {
            label: 'Delete for everyone',
            icon: 'delete' as const,
            onSelect: () => onDelete('everyone'),
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn('group flex w-full items-center gap-1', isOwn ? 'justify-end' : 'justify-start')}
    >
      {/* The menu sits on the outside edge, so it never covers the message it
          acts on. */}
      {isOwn && <Menu items={menuItems} label="Message options" align="right" subtle />}

      <div
        className={cn(
          'max-w-[80%] rounded-2xl p-1 sm:max-w-[65%]',
          isOwn
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-secondary text-foreground'
        )}
      >
        {/* A forward is a quotation, not something you wrote. Say so. */}
        {message.forwarded && (
          <p
            className={cn(
              'flex items-center gap-1 px-2.5 pt-1 text-[11px] italic',
              isOwn ? 'text-primary-foreground/60' : 'text-muted-foreground'
            )}
          >
            <Icon name="forward" size={12} />
            Forwarded
          </p>
        )}

        {hasAttachments && <Attachments attachments={message.attachments} isOwn={isOwn} />}

        {hasText && (
          <p
            className={cn(
              'whitespace-pre-wrap break-words px-2.5 text-sm leading-relaxed',
              hasAttachments ? 'pt-1.5' : 'pt-1.5'
            )}
          >
            {message.text}
          </p>
        )}

        <div
          className={cn(
            'flex items-center justify-end gap-1 px-2.5 pb-0.5 pt-1',
            isOwn ? 'text-primary-foreground/60' : 'text-muted-foreground'
          )}
        >
          <time dateTime={message.createdAt} className="text-[10px] tabular-nums">
            {dayjs(message.createdAt).format('HH:mm')}
          </time>
          {isOwn && <ReadReceipt message={message} />}
        </div>
      </div>

      {/* Mirrored to the other outside edge for incoming messages. */}
      {!isOwn && <Menu items={menuItems} label="Message options" align="left" subtle />}
    </div>
  );
}
