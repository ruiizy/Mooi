import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '@/shared/components/IconButton';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';
import { cn } from '@/shared/utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

export const Modal = ({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLockBodyScroll(open);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    // The sheet itself takes focus, not its first button: no stray focus ring, no keyboard popping up.
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-x-0 top-(--app-offset) m-0 h-app max-h-none w-screen max-w-none bg-transparent px-0 outline-none pt-[calc(var(--safe-top)+0.75rem)] pb-0 text-ink open:flex open:items-end open:justify-center backdrop:bg-black/55 backdrop:backdrop-blur-sm sm:p-6 sm:open:items-center"
    >
      {/* A bottom sheet on phones (thumb reach, room for the keyboard), a centered card from `sm`. */}
      {/* On phones and tablets the entire card scrolls, so the keyboard leaves room for inputs. */}
      <div className={cn('flex max-h-full w-full animate-sheet-in flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-3xl border-t border-line bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] sm:animate-menu-in sm:rounded-2xl sm:border lg:overflow-hidden', { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size])}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line py-4 pr-3 pl-5 sm:px-7 sm:py-6">
          <div className="min-w-0 pt-1 sm:pt-0">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-[-0.03em] sm:text-[22px]">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1.5 break-words text-[13px] leading-relaxed text-ink-muted sm:mt-2 sm:text-sm">{description}</p> : null}
          </div>
          <IconButton icon={X} label="Close dialog" onClick={onClose} className="sm:-mt-2 sm:-mr-2" />
        </header>
        <div className={cn('shrink-0 px-5 pt-5 sm:px-7 sm:py-6 lg:min-h-0 lg:shrink lg:overflow-y-auto lg:overscroll-contain', footer ? 'pb-5' : 'pb-[calc(1.5rem+var(--safe-bottom))]')}>{children}</div>
        {footer ? <footer className="flex shrink-0 gap-2 border-t border-line bg-surface-2 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))] *:min-w-0 *:flex-1 sm:justify-end sm:px-7 sm:py-4 sm:*:flex-none">{footer}</footer> : null}
      </div>
    </dialog>, document.body,
  );
};
