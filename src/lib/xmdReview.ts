import type { Root } from 'mdast';
import { documentStructureParser } from './documentStructure';
import { readXmdComment, writeXmdComment } from './xmdComment';
import { isXmdDocumentThemeMarker } from './xmdLayout';
import { generateDocId } from './documentUtils';

export const XMD_REVIEW_PREFIX = '<!-- xmd:review ';
export const XMD_REVIEW_LIMIT = 16_384;
export const REVIEW_QUOTE_LIMIT = 300;
export const REVIEW_NOTE_LIMIT = 1000;
const CONTEXT_LENGTH = 24;

export interface XmdReviewNote {
  id: string;
  quote: string;
  before: string;
  after: string;
  at: number;
  note: string;
  resolved: boolean;
}

function parseXmdReview(value: string): XmdReviewNote | undefined {
  const raw = readXmdComment(value, XMD_REVIEW_PREFIX, XMD_REVIEW_LIMIT);
  if (!raw || typeof raw.id !== 'string' || !/^(?:doc-)?[\da-z-]{10,64}$/i.test(raw.id) ||
    typeof raw.quote !== 'string' || !raw.quote.trim() || raw.quote.length > REVIEW_QUOTE_LIMIT ||
    typeof raw.before !== 'string' || raw.before.length > CONTEXT_LENGTH ||
    typeof raw.after !== 'string' || raw.after.length > CONTEXT_LENGTH ||
    typeof raw.note !== 'string' || !raw.note.trim() || raw.note.length > REVIEW_NOTE_LIMIT ||
    typeof raw.at !== 'number' || !Number.isSafeInteger(raw.at) || raw.at < 0 ||
    typeof raw.resolved !== 'boolean') return;
  return { id: raw.id, quote: raw.quote, before: raw.before, after: raw.after, at: raw.at, note: raw.note, resolved: raw.resolved };
}

export function isXmdReviewMarker(value: string): boolean {
  return Boolean(parseXmdReview(value));
}

function reviewEntries(markdown: string, tree = documentStructureParser.parse(markdown)) {
  return tree.children.flatMap((node) => {
    if (node.type !== 'html') return [];
    const note = parseXmdReview(node.value);
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return note && from !== undefined && to !== undefined ? [{ note, from, to, removeTo: removalEnd(markdown, to) }] : [];
  });
}

export function readXmdReviews(markdown: string): XmdReviewNote[] {
  if (!markdown.includes(XMD_REVIEW_PREFIX)) return [];
  const byId = new Map(reviewEntries(markdown).map(({ note }) => [note.id, note]));
  return [...byId.values()];
}

export function makeXmdReview(markdown: string, from: number, to: number, note: string): XmdReviewNote | undefined {
  const quote = markdown.slice(from, to);
  if (!quote.trim() || quote.length > REVIEW_QUOTE_LIMIT || !note.trim() || note.length > REVIEW_NOTE_LIMIT) return;
  const entries = markdown.includes(XMD_REVIEW_PREFIX) ? reviewEntries(markdown) : [];
  if (entries.some((entry) => entry.from < to && entry.removeTo > from)) return;
  const offset = entries.filter((entry) => entry.to <= from)
    .reduce((sum, entry) => sum + entry.removeTo - entry.from, 0);
  const body = removeEntries(markdown, entries);
  const at = from - offset;
  const end = to - offset;
  return { id: generateDocId(), quote, at, note: note.trim(), resolved: false,
    before: body.slice(Math.max(0, at - CONTEXT_LENGTH), at),
    after: body.slice(end, end + CONTEXT_LENGTH) };
}

export function locateXmdReview(markdown: string, note: XmdReviewNote): { from: number; to: number } | undefined {
  const entries = reviewEntries(markdown);
  const body = removeEntries(markdown, entries);
  let best: { from: number; to: number } | undefined;
  let score = -1;
  const quote = note.quote;
  let metadata = 0;
  let offset = 0;
  for (let from = markdown.indexOf(quote); from >= 0; from = markdown.indexOf(quote, from + 1)) {
    const to = from + quote.length;
    while (metadata < entries.length && entries[metadata].removeTo <= from) {
      offset += entries[metadata].removeTo - entries[metadata].from;
      metadata++;
    }
    if (metadata < entries.length && entries[metadata].from < to) continue;
    const at = from - offset;
    const end = to - offset;
    const beforeMatches = note.before ? body.slice(Math.max(0, at - note.before.length), at) === note.before : at === 0;
    const afterMatches = note.after ? body.slice(end, end + note.after.length) === note.after : end === body.length;
    const points = Number(Boolean(beforeMatches)) + Number(Boolean(afterMatches));
    if (points > score) { best = { from, to }; score = points; }
    else if (points === score) best = undefined;
    if (points === 2 && at === note.at) return { from, to };
  }
  return best;
}

function afterLine(markdown: string, offset: number) {
  const end = markdown.indexOf('\n', offset);
  return end < 0 ? markdown.length : end + 1;
}

function removalEnd(markdown: string, to: number): number {
  const end = afterLine(markdown, to);
  return end + (/^\r?\n/.exec(markdown.slice(end, end + 2))?.[0].length ?? 0);
}

function removeEntries(markdown: string, entries: { from: number; removeTo: number }[]): string {
  let result = markdown;
  for (const { from, removeTo } of [...entries].reverse()) {
    result = result.slice(0, from) + result.slice(removeTo);
  }
  return result;
}

/** Store metadata ahead of the first body block, including documents with an unclosed fence. */
export function writeXmdReview(markdown: string, id: string, note?: XmdReviewNote): string {
  const tree = documentStructureParser.parse(markdown);
  const entries = reviewEntries(markdown, tree).filter((entry) => entry.note.id === id);
  const replacement = note ? writeXmdComment(XMD_REVIEW_PREFIX, note) : '';
  if (replacement && !parseXmdReview(replacement)) return markdown;
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  if (entries.length) {
    let result = markdown;
    for (const [index, entry] of Array.from(entries.entries()).reverse()) {
      const insert = index === entries.length - 1 ? replacement : '';
      const to = insert ? entry.to : entry.removeTo;
      result = result.slice(0, entry.from) + insert + result.slice(to);
    }
    return result;
  }
  if (!replacement) return markdown;
  const bom = markdown.startsWith('\uFEFF') ? 1 : 0;
  let offset = bom;
  for (const node of tree.children) {
    const type: string = node.type;
    if (type !== 'yaml' && type !== 'toml' && !(node.type === 'html' && isXmdDocumentThemeMarker(node.value))) break;
    offset = afterLine(markdown, node.position?.end.offset ?? offset);
  }
  const padding = offset > bom && !markdown.slice(0, offset).endsWith('\n') ? newline + newline : '';
  return markdown.slice(0, offset) + padding + replacement + newline + newline + markdown.slice(offset);
}

export function remarkXmdReview() {
  return (root: Root) => {
    root.children = root.children.filter((node) => node.type !== 'html' || !isXmdReviewMarker(node.value));
  };
}

export function stripXmdReviews(markdown: string): string {
  return markdown.includes(XMD_REVIEW_PREFIX) ? removeEntries(markdown, reviewEntries(markdown)) : markdown;
}
