import type { Element, Root as HtmlRoot } from 'hast';
import type { Parent, PhrasingContent, Root } from 'mdast';
import { pairXmdTypography, parseXmdTypography, xmdTypographyCss, type XmdTypography } from './xmdTypography';

interface XmdTypographyNode extends Parent {
  type: 'xmdTypography';
  children: PhrasingContent[];
  style: XmdTypography;
}

declare module 'mdast' {
  interface PhrasingContentMap {
    xmdTypography: XmdTypographyNode;
  }
  interface RootContentMap {
    xmdTypography: XmdTypographyNode;
  }
}

export const XMD_TYPOGRAPHY_PROPERTIES = ['dataXmdFont', 'dataXmdSize', 'dataXmdColor'] as const;

export function transformXmdTypography(root: Root): boolean {
  let found = false;
  function visit(node: Parent): void {
    for (const child of node.children) {
      if ('children' in child) visit(child);
    }
    // HTML blocks and code are never interpreted as inline typography.
    if (!['paragraph', 'heading', 'strong', 'emphasis', 'delete', 'link', 'linkReference', 'tableCell'].includes(node.type)) return;
    const parent = node as Parent & { children: PhrasingContent[] };
    const children = parent.children;
    const pairs = pairXmdTypography(children, (child) => child.type === 'html' ? child.value : '')
      .filter(({ open, close }) => children[open].position?.start.line === children[close].position?.end.line);
    if (!pairs.length) return;
    found = true;
    const opening = new Map(pairs.map((pair) => [pair.open, pair]));
    const stack: { end: number; children: PhrasingContent[] }[] = [{ end: children.length, children: [] }];
    for (let index = 0; index < children.length; index++) {
      const frame = stack[stack.length - 1];
      const pair = opening.get(index);
      if (pair) {
        const { font, size, color } = pair.style;
        const span: XmdTypographyNode = {
          type: 'xmdTypography',
          style: pair.style,
          children: [],
          position: children[index].position && children[pair.close].position
            ? { start: children[index].position!.start, end: children[pair.close].position!.end }
            : undefined,
          data: {
            hName: 'span',
            hProperties: {
              ...(font && { dataXmdFont: font }),
              ...(size && { dataXmdSize: String(size) }),
              ...(color && { dataXmdColor: color }),
            },
          },
        };
        frame.children.push(span);
        stack.push({ end: pair.close, children: span.children });
      } else if (index === frame.end) {
        stack.pop();
      } else {
        frame.children.push(children[index]);
      }
    }
    parent.children = stack[0].children;
  }
  visit(root);
  return found;
}

export function remarkXmdTypography() {
  return (root: Root) => { transformXmdTypography(root); };
}

/** Build restricted CSS after sanitization, leaving generic style attributes filtered. */
export function rehypeXmdTypography() {
  return (root: HtmlRoot) => {
    function visit(node: HtmlRoot | Element): void {
      for (const child of node.children) {
        if (child.type !== 'element') continue;
        if (child.tagName === 'span') {
          const props = child.properties;
          const values = XMD_TYPOGRAPHY_PROPERTIES.map((property) => {
            const value = props[property];
            delete props[property];
            return typeof value === 'string' ? value : '';
          });
          const style = parseXmdTypography(values[0], values[1], values[2]);
          const css = style && xmdTypographyCss(style);
          if (css) props.style = css;
        }
        visit(child);
      }
    }
    visit(root);
  };
}
