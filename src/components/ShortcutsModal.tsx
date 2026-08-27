import React, { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useI18n } from '@/i18n';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previouslyFocusedElementRef.current = document.activeElement;
    }

    const focusTimer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcutGroups = [
    {
      title: t('shortcutsModal.groupFile'),
      items: [
        { key: 'Ctrl + N', desc: t('shortcutsModal.newTab') },
        { key: 'Ctrl + O', desc: t('shortcutsModal.openFile') },
        { key: 'Ctrl + S', desc: t('shortcutsModal.saveFile') },
        { key: 'Ctrl + Shift + S', desc: t('shortcutsModal.saveAsFile') },
        { key: 'Ctrl + W', desc: t('shortcutsModal.closeTab') },
      ],
    },
    {
      title: t('shortcutsModal.groupView'),
      items: [
        { key: 'Ctrl + 1', desc: t('shortcutsModal.switchEdit') },
        { key: 'Ctrl + 2', desc: t('shortcutsModal.switchSplit') },
        { key: 'Ctrl + 3', desc: t('shortcutsModal.switchRead') },
        { key: 'Ctrl + Shift + O', desc: t('shortcutsModal.toggleOutline') },
        { key: 'Ctrl + ,', desc: t('shortcutsModal.openSettings') },
        { key: t('shortcutsModal.helpKey'), desc: t('shortcutsModal.openShortcuts') },
      ],
    },
    {
      title: t('shortcutsModal.groupEdit'),
      items: [
        { key: 'Ctrl + B', desc: t('shortcutsModal.bold') },
        { key: 'Ctrl + I', desc: t('shortcutsModal.italic') },
        { key: 'Ctrl + Z / Y', desc: t('shortcutsModal.undoRedo') },
        { key: 'Ctrl + F', desc: t('shortcutsModal.find') },
        { key: 'Ctrl + H', desc: t('shortcutsModal.replace') },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl bg-white dark:bg-[#182234] rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-800 dark:text-slate-100 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-2 font-medium text-sm">
            <Keyboard className="w-4 h-4 text-blue-500" />
            <span id="shortcuts-modal-title">{t('shortcutsModal.title')}</span>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {shortcutGroups.map((group) => (
            <div key={group.title} className="space-y-2">
              <h4 className="font-semibold text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
                {group.title}
              </h4>
              <div className="bg-slate-50 dark:bg-[#111927] rounded-lg p-2 border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-200/60 dark:divide-slate-800">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-1.5 px-2"
                  >
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                      {item.desc}
                    </span>
                    <kbd className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded shadow-xs">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 bg-slate-50 dark:bg-[#131b2a] border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            {t('shortcutsModal.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
};
