import type { Root } from 'mdast';

function isFrontMatterNode(type: string): type is 'yaml' | 'toml' {
  return type === 'yaml' || type === 'toml';
}

/**
 * Locates a leading YAML (`---` ... `---` / `...`) or TOML (`+++` ... `+++`)
 * front matter block and returns the 1-based line of its closing fence, or 0
 * when the document has none. Mirrors what remark-frontmatter treats as front
 * matter so the outline, the preview and the exporters agree.
 */
export function getFrontMatterEndLine(markdown: string): number {
  if (!markdown) return 0;
  const lines = markdown.split(/\r?\n/);
  // A BOM can precede the opening fence when a file is read verbatim.
  const first = lines[0].replace(/^\uFEFF/, '').trimEnd();
  if (first !== '---' && first !== '+++') return 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (first === '---' && (line === '---' || line === '...')) return i + 1;
    if (first === '+++' && line === '+++') return i + 1;
  }
  return 0;
}

/**
 * remark plugin: in the preview a front matter node is shown as a highlighted
 * YAML / TOML code block (same source position, so scroll sync keeps working).
 */
export function remarkFrontMatterAsCode() {
  return (tree: Root) => {
    tree.children = tree.children.map((node) => {
      const nodeType = node.type as string;
      if (!isFrontMatterNode(nodeType)) return node;
      const metaNode = node as unknown as { value: string; position?: Root['position'] };
      const lang = nodeType === 'toml' ? 'toml' : 'yaml';
      return {
        type: 'code',
        lang,
        meta: null,
        value: metaNode.value,
        position: metaNode.position,
        data: { hProperties: { className: [`language-${lang}`, 'md-frontmatter'] } },
      };
    });
  };
}

/** remark plugin: exports leave the metadata block out of the document body. */
export function remarkDropFrontMatter() {
  return (tree: Root) => {
    tree.children = tree.children.filter((node) => !isFrontMatterNode(node.type as string));
  };
}
