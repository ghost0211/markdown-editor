import { documentStructureParser } from '@/lib/documentStructure';

interface Section {
  line: number;
  level: number;
  parent: Section | null;
  from: number;
  to: number;
  heading: string;
  number?: { parts: number[]; widths: number[]; from: number; to: number };
}

export type OutlinePlacement = 'before' | 'after';

function collectSections(source: string): Section[] {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const tree = documentStructureParser.parse(source.slice(bom));
  const stack: Section[] = [];
  const sections: Section[] = [];
  for (const node of tree.children) {
    if (node.type !== 'heading' || node.position?.start.offset === undefined) continue;
    const at = node.position.start;
    const from = at.offset! - at.column + 1 + bom;
    while (stack.length && stack[stack.length - 1].level >= node.depth) {
      stack.pop()!.to = from;
    }
    const section: Section = {
      line: at.line,
      level: node.depth,
      parent: stack[stack.length - 1] ?? null,
      from,
      to: source.length,
      heading: source.slice(from, (node.position.end.offset ?? at.offset!) + bom),
    };
    const first = node.children[0];
    if (first?.type === 'text' && first.position?.start.offset !== undefined) {
      const start = first.position.start.offset + bom;
      const end = source.indexOf('\n', start);
      const match = /^(\d+(?:\.\d+)*)([.)、．]?)[ \t]+/.exec(source.slice(start, end < 0 ? undefined : end));
      if (match && (match[2] || match[1].includes('.'))) {
        const tokens = match[1].split('.');
        const parts = tokens.map(Number);
        if (parts.every((part) => Number.isSafeInteger(part) && part < 1_000_000)) {
          section.number = { parts, widths: tokens.map((value) => value.length), from: start, to: start + match[1].length };
        }
      }
    }
    stack.push(section);
    sections.push(section);
  }
  return sections;
}

function siblingsOf(sections: readonly Section[], section: Section): Section[] {
  return sections.filter((item) => item.parent === section.parent && item.level === section.level);
}

export function moveOutlineSection(
  markdown: string,
  sourceLine: number,
  target: { line: number; placement: OutlinePlacement } | { direction: -1 | 1 }
): string | null {
  const sections = collectSections(markdown);
  const source = sections.find((item) => item.line === sourceLine);
  if (!source) return null;
  const siblings = siblingsOf(sections, source);
  const sourceIndex = siblings.indexOf(source);
  const targetIndex = 'direction' in target
    ? sourceIndex + target.direction
    : siblings.findIndex((item) => item.line === target.line);
  if (targetIndex < 0 || targetIndex >= siblings.length || sourceIndex === targetIndex) return null;
  const placement = 'direction' in target ? (target.direction < 0 ? 'before' : 'after') : target.placement;
  const destination = targetIndex + (placement === 'after' ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  if (destination === sourceIndex) return null;

  const first = Math.min(sourceIndex, destination);
  const last = Math.max(sourceIndex, destination);
  const affected = siblings.slice(first, last + 1);
  // A change in level between siblings may leave an intervening section at
  // the same parent outside this move. Keep that section in place.
  if (affected.some((item, index) => index > 0 && affected[index - 1].to !== item.from)) return null;

  const blocks: string[] = [];
  const gaps: string[] = [];
  for (const item of affected) {
    const raw = markdown.slice(item.from, item.to);
    const gap = /(?:\r?\n[ \t]*)+$/.exec(raw)?.[0] ?? '';
    blocks.push(raw.slice(0, raw.length - gap.length));
    gaps.push(gap);
  }
  const start = affected[0].from;
  const end = affected[affected.length - 1].to;
  const sectionStart = sections.indexOf(source);
  const sectionEnd = sections.findIndex((section) => section.from >= source.to);
  const ordered = [...sections];
  const moved = ordered.splice(sectionStart, (sectionEnd === -1 ? sections.length : sectionEnd) - sectionStart);
  const following = sourceIndex > destination ? start : end;
  const insertion = ordered.findIndex((section) => section.from >= following);
  const insertionAt = insertion === -1 ? ordered.length : insertion;
  const expected = [...ordered.slice(0, insertionAt), ...moved, ...ordered.slice(insertionAt)];
  const preservesHeadings = (content: string) => {
    const next = collectSections(content);
    return next.length === expected.length && next.every((section, index) =>
      section.heading === expected[index].heading && section.parent?.heading === expected[index].parent?.heading
    );
  };
  blocks.splice(destination - first, 0, blocks.splice(sourceIndex - first, 1)[0]);
  const render = () => markdown.slice(0, start) +
    blocks.map((block, index) => block + gaps[index]).join('') + markdown.slice(end);
  let result = render();
  if (!preservesHeadings(result)) {
    const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
    for (let i = 0; i < gaps.length - (end === markdown.length ? 1 : 0); i++) {
      if ((gaps[i].match(/\n/g)?.length ?? 0) < 2) gaps[i] += gaps[i] ? newline : newline.repeat(2);
    }
    result = render();
    if (!preservesHeadings(result)) return null;
  }
  return result;
}

export interface OutlineNumberingChange { line: number; before: string; after: string }

export function renumberOutline(markdown: string): { content: string; changes: OutlineNumberingChange[] } {
  const sections = collectSections(markdown);
  const items: { section: Section; number: NonNullable<Section['number']>; ancestor: Section | null; middle: number[]; key: string }[] = [];
  const nextByGroup = new Map<string, number>();
  for (const section of sections) {
    const number = section.number;
    if (!number) continue;
    let ancestor = section.parent;
    while (ancestor && (!ancestor.number || ancestor.number.parts.length >= number.parts.length)) ancestor = ancestor.parent;
    const middle = number.parts.slice(ancestor?.number?.parts.length ?? 0, -1);
    const key = JSON.stringify([section.parent?.line, section.level, ancestor?.line, middle]);
    const last = number.parts[number.parts.length - 1];
    nextByGroup.set(key, Math.min(nextByGroup.get(key) ?? last, last));
    items.push({ section, number, ancestor, middle, key });
  }

  const numbers = new Map<Section, number[]>();
  const edits: { from: number; to: number; insert: string }[] = [];
  const changes: OutlineNumberingChange[] = [];
  for (const { section, number, ancestor, middle, key } of items) {
    const next = nextByGroup.get(key)!;
    nextByGroup.set(key, next + 1);
    const parts = [...(ancestor ? numbers.get(ancestor)! : []), ...middle, next];
    numbers.set(section, parts);
    const before = markdown.slice(number.from, number.to);
    const after = parts.map((part, index) => String(part).padStart(number.widths[index] ?? 1, '0')).join('.');
    if (before === after) continue;
    const lineEnd = markdown.indexOf('\n', number.to);
    const suffix = markdown.slice(number.to, lineEnd < 0 ? undefined : lineEnd).trimEnd();
    edits.push({ from: number.from, to: number.to, insert: after });
    changes.push({ line: section.line, before: before + suffix, after: after + suffix });
  }

  let content = markdown;
  if (edits.length) {
    const parts: string[] = [];
    let cursor = 0;
    for (const edit of edits) {
      parts.push(markdown.slice(cursor, edit.from), edit.insert);
      cursor = edit.to;
    }
    content = parts.join('') + markdown.slice(cursor);
  }
  return { content, changes };
}
