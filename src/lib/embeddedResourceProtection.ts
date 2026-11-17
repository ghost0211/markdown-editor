import { EditorState, type Extension } from '@codemirror/state';
import { scanXmdReferences } from '@/lib/xmdPackage';

/** The ordinary CodeMirror replace panel must never silently corrupt hidden data URLs. */
export function createEmbeddedResourceProtection(onBlocked?: () => void): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || !transaction.isUserEvent('input.replace')) return transaction;
    let ranges: { from: number; to: number }[];
    try {
      ranges = scanXmdReferences(transaction.startState.doc.toString()).references
        .filter((reference) => /^data:/i.test(reference.source))
        .map((reference) => reference.target);
    } catch {
      // An unparseable document is not safe for a blind replace-all either.
      if (onBlocked) queueMicrotask(onBlocked);
      return [];
    }
    let blocked = false;
    transaction.changes.iterChangedRanges((from, to) => {
      if (ranges.some((range) => from === to
        ? from >= range.from && from <= range.to
        : from < range.to && to > range.from)) blocked = true;
    });
    if (!blocked) return transaction;
    // Do not synchronously update React while CodeMirror is dispatching.
    if (onBlocked) queueMicrotask(onBlocked);
    return [];
  });
}
