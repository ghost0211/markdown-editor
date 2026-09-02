import React, { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import { DocumentTab } from '@/types';
import { useI18n } from '@/i18n';

interface CompareModalProps {
  isOpen: boolean;
  /** Candidate document tabs (diff tabs are excluded by the caller). */
  docTabs: DocumentTab[];
  defaultLeftId?: string;
  onConfirm: (leftId: string, rightId: string) => void;
  onCancel: () => void;
}

/**
 * Lets the user pick two open documents to compare side by side.
 */
export const CompareModal: React.FC<CompareModalProps> = ({
  isOpen,
  docTabs,
  defaultLeftId,
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  const canCompare = docTabs.length >= 2;

  // Initialize selection whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    const fallbackLeft =
      defaultLeftId && docTabs.some((tab) => tab.id === defaultLeftId)
        ? defaultLeftId
        : docTabs[0]?.id || '';
    const fallbackRight = docTabs.find((tab) => tab.id !== fallbackLeft)?.id || '';
    setLeftId(fallbackLeft);
    setRightId(fallbackRight);
  }, [isOpen, docTabs, defaultLeftId]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  const isValid = useMemo(
    () =>
      canCompare &&
      leftId !== '' &&
      rightId !== '' &&
      leftId !== rightId &&
      docTabs.some((tab) => tab.id === leftId) &&
      docTabs.some((tab) => tab.id === rightId),
    [canCompare, leftId, rightId, docTabs]
  );

  if (!isOpen) return null;

  const renderSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void
  ) => (
    <label htmlFor={id} className="block mb-4">
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {docTabs.map((tab) => (
          <option key={tab.id} value={tab.id}>
            {tab.title}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('diff.modalTitle')}
        className="w-[400px] max-w-[90vw] bg-white dark:bg-slate-900 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center space-x-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <GitCompareArrows className="w-4 h-4 text-blue-500" />
            <span>{t('diff.modalTitle')}</span>
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.cancel')}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {canCompare ? (
          <>
            {renderSelect('compare-left', t('diff.leftDocument'), leftId, setLeftId)}
            {renderSelect('compare-right', t('diff.rightDocument'), rightId, setRightId)}
            {leftId === rightId && leftId !== '' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2 mb-4">
                {t('diff.sameDocumentHint')}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('diff.needTwoDocs')}
          </p>
        )}

        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={() => onConfirm(leftId, rightId)}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('diff.startCompare')}
          </button>
        </div>
      </div>
    </div>
  );
};
