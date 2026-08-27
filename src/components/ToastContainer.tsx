import React from 'react';
import { ToastMessage } from '@/types';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-6 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full select-none">
      {toasts.map((toast) => {
        const icon = {
          success: <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />,
          error: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
          warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
          info: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
        }[toast.type];

        const bgBorder = {
          success: 'border-emerald-500/30 bg-white dark:bg-[#182234] text-slate-800 dark:text-slate-100',
          error: 'border-red-500/30 bg-white dark:bg-[#182234] text-slate-800 dark:text-slate-100',
          warning: 'border-amber-500/30 bg-white dark:bg-[#182234] text-slate-800 dark:text-slate-100',
          info: 'border-blue-500/30 bg-white dark:bg-[#182234] text-slate-800 dark:text-slate-100',
        }[toast.type];

        return (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-start space-x-2.5 p-3 rounded-lg shadow-lg border text-xs animate-in slide-in-from-bottom-2 duration-200 backdrop-blur-md',
              bgBorder
            )}
          >
            <div className="pt-0.5">{icon}</div>
            <div className="flex-1 font-medium leading-relaxed break-words">{toast.message}</div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
