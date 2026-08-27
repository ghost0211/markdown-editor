import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import clsx from 'clsx';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'primary',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const btnColor = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-[#182234] rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700/80">
          <div className="flex items-center space-x-2 font-medium text-sm">
            {variant === 'danger' || variant === 'warning' ? (
              <AlertTriangle
                className={clsx(
                  'w-4 h-4',
                  variant === 'danger' ? 'text-red-500' : 'text-amber-500'
                )}
              />
            ) : null}
            <span>{title}</span>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {message}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-4 py-3 bg-slate-50 dark:bg-[#131b2a] border-t border-slate-200 dark:border-slate-700/80">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-colors shadow-xs', btnColor)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
