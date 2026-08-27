import { useState, useCallback } from 'react';
import { ToastMessage, ToastType } from '@/types';

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = 3000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast: ToastMessage = { id, message, type, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
      return id;
    },
    [removeToast]
  );

  const toast = {
    info: (msg: string, dur?: number) => showToast(msg, 'info', dur),
    success: (msg: string, dur?: number) => showToast(msg, 'success', dur),
    warning: (msg: string, dur?: number) => showToast(msg, 'warning', dur),
    error: (msg: string, dur?: number) => showToast(msg, 'error', dur || 4500),
  };

  return {
    toasts,
    showToast,
    removeToast,
    toast,
  };
}
