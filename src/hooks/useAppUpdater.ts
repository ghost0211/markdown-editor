import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createNativeUpdater } from '@/lib/appUpdater';
import { useI18n } from '@/i18n';
import type { ToastType } from '@/types';

export function useAppUpdater(showToast: (message: string, type: ToastType, duration?: number) => unknown) {
  const [controller] = useState(createNativeUpdater);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const checkedOnLaunch = useRef(false);
  const { t } = useI18n();

  useEffect(() => {
    if (checkedOnLaunch.current || state.status === 'unsupported') return;
    const timer = setTimeout(() => {
      checkedOnLaunch.current = true;
      // A manual check may already have run while startup was settling.
      if (controller.getSnapshot().status !== 'idle') return;
      void controller.check().then(available => {
        if (available) showToast(t('updates.availableToast', { version: controller.getSnapshot().version || '' }), 'info', 8000);
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [controller, showToast, t, state.status]);

  return { controller, state };
}
