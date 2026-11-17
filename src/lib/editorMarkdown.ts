import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Opaque source fallbacks shared by the editor parser and visual decorations.
 * These constructs already render in Preview; phase one intentionally leaves
 * their exact source editable instead of interpreting inner stars/headings.
 */
export const editorMarkdownFallbacks: MarkdownConfig = {
  defineNodes: [{ name: 'FrontMatter', block: true }, { name: 'MathBlock', block: true }, 'InlineMath'],
  parseBlock: [
    {
      name: 'FrontMatter', before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0) return false;
        const fence = line.text.replace(/^\uFEFF/, '').trimEnd();
        if (fence !== '---' && fence !== '+++') return false;
        const from = cx.lineStart;
        let to = from + line.text.length;
        // Keep even unclosed metadata opaque; never render its inner syntax.
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          const text = line.text.trimEnd();
          if (text === fence || (fence === '---' && text === '...')) { cx.nextLine(); break; }
        }
        cx.addElement(cx.elt('FrontMatter', from, to));
        return true;
      },
    },
    {
      name: 'MathBlock', before: 'FencedCode',
      parse(cx, line) {
        const content = line.text.slice(line.pos);
        const opening = /^(\${2,})(?!\$)/.exec(content);
        if (!opening || line.indent - line.baseIndent >= 4) return false;
        const from = cx.lineStart + line.pos;
        const baseIndent = line.baseIndent;
        let to = cx.lineStart + line.text.length;
        const fence = opening[1];
        if (content.slice(opening[0].length).includes(fence)) cx.nextLine();
        else {
          while (cx.nextLine()) {
            // nextLine recalculates container markers/indentation. Do not eat
            // an outdented paragraph after an unclosed quote/list math block.
            if (line.baseIndent < baseIndent) break;
            to = cx.lineStart + line.text.length;
            if (line.text.slice(line.pos).trimEnd() === fence) { cx.nextLine(); break; }
          }
        }
        cx.addElement(cx.elt('MathBlock', from, to));
        return true;
      },
    },
  ],
  parseInline: [{
    name: 'InlineMath', before: 'Emphasis',
    parse(cx, next, pos) {
      if (next !== 36) return -1;
      let size = 1;
      while (cx.char(pos + size) === 36) size++;
      const end = Math.min(cx.end, pos + 16_384);
      for (let at = pos + size; at < end; at++) {
        const char = cx.char(at);
        if (char === 10 || char === 13) break;
        if (char === 92) { at++; continue; }
        if (char !== 36) continue;
        let closing = 1;
        while (cx.char(at + closing) === 36) closing++;
        if (closing === size && at > pos + size) return cx.addElement(cx.elt('InlineMath', pos, at + size));
        at += closing - 1;
      }
      return -1;
    },
  }],
};
