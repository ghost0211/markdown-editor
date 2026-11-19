import type { Break, Parent, Root, RootContent } from 'mdast';

/** Promote bare HTML breaks to Markdown hard breaks without parsing other HTML. */
export function transformExportHtmlBreaks(parent: Parent): void {
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index];
    if (child.type === 'html' && /^(?:[ \t\r\n]*<br[ \t]*\/?>)+[ \t\r\n]*$/i.test(child.value)) {
      const breaks: Break[] = Array.from(child.value.matchAll(/<br[ \t]*\/?>/gi), () => ({ type: 'break' }));
      const inline = parent.type === 'paragraph' || parent.type === 'heading' || parent.type === 'tableCell' ||
        parent.type === 'strong' || parent.type === 'emphasis' || parent.type === 'delete' ||
        parent.type === 'link' || parent.type === 'linkReference';
      const replacement: RootContent[] = inline ? breaks : [{ type: 'paragraph', children: breaks }];
      parent.children.splice(index, 1, ...replacement);
      index += replacement.length - 1;
    } else if ('children' in child) {
      transformExportHtmlBreaks(child);
    }
  }
}

export function remarkExportHtmlBreaks() {
  return (tree: Root) => transformExportHtmlBreaks(tree);
}
