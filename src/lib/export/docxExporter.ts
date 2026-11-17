import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { transformCallouts } from '@/lib/remarkCallouts';
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  AlignmentType,
  LevelFormat,
  ExternalHyperlink,
  Footer,
  Header,
  PageBreak,
  PageNumber,
  TableOfContents,
  Packer,
  type FileChild,
} from 'docx';
import {
  getExportColorPalette,
  validateExportStyle,
  type ExportStyle,
} from '@/lib/exportStyle';
import type {
  Root,
  RootContent,
  PhrasingContent,
  Heading,
  Paragraph as MdastParagraph,
  List as MdastList,
  ListItem as MdastListItem,
  Blockquote as MdastBlockquote,
  Code as MdastCode,
  Table as MdastTable,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Link,
  Image,
  Html,
} from 'mdast';

export interface InlineRunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  font?: string;
  shading?: {
    type: (typeof ShadingType)[keyof typeof ShadingType];
    fill: string;
  };
  underline?: object;
}

export const ALLOWED_DOCX_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Validates if a URL is safe for Word external hyperlinks (only http, https, mailto).
 * Case-insensitive, rejects dangerous protocols (javascript, file, data, etc.), empty, or malformed URLs.
 */
export function isValidDocxHyperlink(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }
  const trimmed = urlStr.trim();
  if (!trimmed) {
    return false;
  }

  // Reject ASCII control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return ALLOWED_DOCX_HYPERLINK_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

const LEGACY_HEADING_COLORS = [
  '0F172A',
  '1E293B',
  '334155',
  '475569',
  '475569',
  '64748B',
] as const;

interface DocxTheme {
  font: string;
  /** Body font size in half-points. */
  size: number;
  textColor: string;
  headingColors: readonly string[];
  mutedColor: string;
  linkColor: string;
  quoteColor: string;
  quoteBorderColor: string;
  borderColor: string;
  borderLightColor: string;
  panelColor: string;
  panelAltColor: string;
  codeColor: string;
  monoFont: string;
}

/** Exact current Word appearance, used whenever no style is supplied. */
const LEGACY_DOCX_THEME: DocxTheme = {
  font: 'Microsoft YaHei',
  size: 22,
  textColor: '1E293B',
  headingColors: LEGACY_HEADING_COLORS,
  mutedColor: '64748B',
  linkColor: '2563EB',
  quoteColor: '475569',
  quoteBorderColor: '3B82F6',
  borderColor: 'CBD5E1',
  borderLightColor: 'E2E8F0',
  panelColor: 'F1F5F9',
  panelAltColor: 'F8FAFC',
  codeColor: '334155',
  monoFont: 'Consolas',
};

const DOCX_FONT_BY_FAMILY: Record<ExportStyle['fontFamily'], string> = {
  system: 'Microsoft YaHei',
  serif: 'SimSun',
  mono: 'Consolas',
};

function toDocxHex(color: string): string {
  return color.replace(/^#/, '').toUpperCase();
}

/**
 * Maps the closed export style onto Word's half-point/font/color model.
 * Light keeps the historical Word palette so saving the default theme does not
 * reshuffle existing documents; sepia/dark use the fixed palette values.
 */
function createDocxTheme(style: ExportStyle): DocxTheme {
  const palette = getExportColorPalette(style.colorScheme);
  const isLight = style.colorScheme === 'light';
  const heading = toDocxHex(palette.heading);
  const muted = toDocxHex(palette.muted);

  return {
    font: DOCX_FONT_BY_FAMILY[style.fontFamily],
    size: Math.max(2, Math.floor(style.fontSize * 1.5)),
    textColor: isLight ? '1E293B' : toDocxHex(palette.text),
    headingColors: isLight
      ? LEGACY_HEADING_COLORS
      : [heading, heading, heading, heading, heading, muted],
    mutedColor: isLight ? '64748B' : muted,
    linkColor: isLight ? '2563EB' : toDocxHex(palette.link),
    quoteColor: isLight ? '475569' : muted,
    quoteBorderColor: isLight ? '3B82F6' : toDocxHex(palette.link),
    borderColor: isLight ? 'CBD5E1' : toDocxHex(palette.border),
    borderLightColor: isLight ? 'E2E8F0' : toDocxHex(palette.border),
    panelColor: isLight ? 'F1F5F9' : toDocxHex(palette.panel),
    panelAltColor: isLight ? 'F8FAFC' : toDocxHex(palette.background),
    codeColor: isLight ? '334155' : toDocxHex(palette.text),
    monoFont: 'Consolas',
  };
}

function getDocxTocLabel(lang?: string): string {
  return lang && lang.toLowerCase().startsWith('en') ? 'Contents' : '目录';
}

const NUMBERING_CONFIG = [
  {
    reference: 'bullet-points',
    levels: [
      {
        level: 0,
        format: LevelFormat.BULLET,
        text: '\u2022',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      },
      {
        level: 1,
        format: LevelFormat.BULLET,
        text: 'o',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
      },
      {
        level: 2,
        format: LevelFormat.BULLET,
        text: '\u25AA',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 2160, hanging: 360 } } },
      },
      {
        level: 3,
        format: LevelFormat.BULLET,
        text: '\u2022',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 2880, hanging: 360 } } },
      },
      {
        level: 4,
        format: LevelFormat.BULLET,
        text: 'o',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 3600, hanging: 360 } } },
      },
      {
        level: 5,
        format: LevelFormat.BULLET,
        text: '\u25AA',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 4320, hanging: 360 } } },
      },
    ],
  },
  {
    reference: 'numbered-points',
    levels: [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: '%1.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      },
      {
        level: 1,
        format: LevelFormat.LOWER_LETTER,
        text: '%2.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
      },
      {
        level: 2,
        format: LevelFormat.LOWER_ROMAN,
        text: '%3.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 2160, hanging: 360 } } },
      },
      {
        level: 3,
        format: LevelFormat.DECIMAL,
        text: '%4.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 2880, hanging: 360 } } },
      },
      {
        level: 4,
        format: LevelFormat.LOWER_LETTER,
        text: '%5.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 3600, hanging: 360 } } },
      },
      {
        level: 5,
        format: LevelFormat.LOWER_ROMAN,
        text: '%6.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 4320, hanging: 360 } } },
      },
    ],
  },
];

function getHeadingConfig(
  depth: number,
  theme: DocxTheme = LEGACY_DOCX_THEME
): {
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  size: number;
  color: string;
  spacingBefore: number;
  spacingAfter: number;
} {
  const color = theme.headingColors[Math.min(Math.max(depth - 1, 0), 5)];
  switch (depth) {
    case 1:
      return {
        level: HeadingLevel.HEADING_1,
        size: 36, // 18pt
        color,
        spacingBefore: 360,
        spacingAfter: 160,
      };
    case 2:
      return {
        level: HeadingLevel.HEADING_2,
        size: 30, // 15pt
        color,
        spacingBefore: 280,
        spacingAfter: 120,
      };
    case 3:
      return {
        level: HeadingLevel.HEADING_3,
        size: 26, // 13pt
        color,
        spacingBefore: 240,
        spacingAfter: 100,
      };
    case 4:
      return {
        level: HeadingLevel.HEADING_4,
        size: 22, // 11pt
        color,
        spacingBefore: 200,
        spacingAfter: 80,
      };
    case 5:
      return {
        level: HeadingLevel.HEADING_5,
        size: 20, // 10pt
        color,
        spacingBefore: 160,
        spacingAfter: 60,
      };
    case 6:
    default:
      return {
        level: HeadingLevel.HEADING_6,
        size: 18, // 9pt
        color,
        spacingBefore: 120,
        spacingAfter: 40,
      };
  }
}

/**
 * Converts mdast phrasing children into docx runs / hyperlinks
 */
export function convertPhrasingChildren(
  children: PhrasingContent[],
  currentStyle: InlineRunStyle = {},
  theme: DocxTheme = LEGACY_DOCX_THEME
): (TextRun | ExternalHyperlink)[] {
  const result: (TextRun | ExternalHyperlink)[] = [];

  for (const node of children) {
    switch (node.type) {
      case 'text': {
        const textNode = node as Text;
        result.push(
          new TextRun({
            text: textNode.value,
            bold: currentStyle.bold,
            italics: currentStyle.italics,
            strike: currentStyle.strike,
            color: currentStyle.color,
            size: currentStyle.size,
            font: currentStyle.font,
            shading: currentStyle.shading,
            underline: currentStyle.underline,
          })
        );
        break;
      }
      case 'strong': {
        const strongNode = node as Strong;
        result.push(
          ...convertPhrasingChildren(strongNode.children, {
            ...currentStyle,
            bold: true,
          }, theme)
        );
        break;
      }
      case 'emphasis': {
        const emphasisNode = node as Emphasis;
        result.push(
          ...convertPhrasingChildren(emphasisNode.children, {
            ...currentStyle,
            italics: true,
          }, theme)
        );
        break;
      }
      case 'delete': {
        const deleteNode = node as Delete;
        result.push(
          ...convertPhrasingChildren(deleteNode.children, {
            ...currentStyle,
            strike: true,
          }, theme)
        );
        break;
      }
      case 'inlineCode': {
        const codeNode = node as InlineCode;
        result.push(
          new TextRun({
            text: codeNode.value,
            font: theme.monoFont,
            size: currentStyle.size ? currentStyle.size - 2 : 20,
            color: theme.headingColors[0],
            shading: {
              type: ShadingType.CLEAR,
              fill: theme.panelColor,
            },
            bold: currentStyle.bold,
            italics: currentStyle.italics,
          })
        );
        break;
      }
      case 'link': {
        const linkNode = node as Link;
        const rawUrl = linkNode.url;
        if (isValidDocxHyperlink(rawUrl)) {
          const linkRuns = convertPhrasingChildren(linkNode.children, {
            ...currentStyle,
            color: theme.linkColor,
            underline: {},
          }, theme);
          result.push(
            new ExternalHyperlink({
              link: rawUrl.trim(),
              children: linkRuns,
            })
          );
        } else {
          // Unsafe, empty, or invalid URL: export as regular readable text without losing link text
          result.push(
            ...convertPhrasingChildren(linkNode.children, currentStyle, theme)
          );
        }
        break;
      }
      case 'image': {
        const imageNode = node as Image;
        const alt = imageNode.alt || '图片';
        result.push(
          new TextRun({
            text: `[${alt}: ${imageNode.url}]`,
            italics: true,
            color: theme.mutedColor,
            size: currentStyle.size ? currentStyle.size - 2 : 20,
          })
        );
        break;
      }
      case 'break': {
        result.push(
          new TextRun({
            break: 1,
          })
        );
        break;
      }
      case 'html': {
        const htmlNode = node as Html;
        // Strip raw HTML tags to plain text
        const plainText = htmlNode.value.replace(/<[^>]*>/g, '');
        if (plainText) {
          result.push(
            new TextRun({
              text: plainText,
              bold: currentStyle.bold,
              italics: currentStyle.italics,
              strike: currentStyle.strike,
              color: currentStyle.color,
            })
          );
        }
        break;
      }
      default:
        break;
    }
  }

  return result;
}

/**
 * Converts a list AST node (ordered / unordered / nested / task lists) into docx elements
 */
function convertList(
  listNode: MdastList,
  listLevel: number,
  theme: DocxTheme = LEGACY_DOCX_THEME
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  const isOrdered = Boolean(listNode.ordered);
  const refName = isOrdered ? 'numbered-points' : 'bullet-points';

  for (const item of listNode.children as MdastListItem[]) {
    const isTask = typeof item.checked === 'boolean';
    let isFirstParagraphInItem = true;

    for (const child of item.children) {
      if (child.type === 'paragraph') {
        const pNode = child as MdastParagraph;
        const runs = convertPhrasingChildren(pNode.children, {}, theme);

        if (isTask) {
          // Task list item: render checkbox symbol with indent
          const checkSymbol = item.checked ? '\u2611 ' : '\u2610 ';
          const checkRun = new TextRun({
            text: checkSymbol,
            font: 'Segoe UI Symbol',
            bold: true,
            color: item.checked ? theme.linkColor : theme.mutedColor,
          });

          result.push(
            new Paragraph({
              indent: {
                left: (listLevel + 1) * 720,
                hanging: 360,
              },
              spacing: { line: 276, after: 80 },
              children: isFirstParagraphInItem ? [checkRun, ...runs] : runs,
            })
          );
        } else {
          // Standard numbered or bulleted list item
          if (isFirstParagraphInItem) {
            result.push(
              new Paragraph({
                numbering: {
                  reference: refName,
                  level: Math.min(listLevel, 5),
                },
                spacing: { line: 276, after: 80 },
                children: runs.length > 0 ? runs : [new TextRun('')],
              })
            );
          } else {
            result.push(
              new Paragraph({
                indent: { left: (listLevel + 1) * 720 },
                spacing: { line: 276, after: 80 },
                children: runs,
              })
            );
          }
        }
        isFirstParagraphInItem = false;
      } else if (child.type === 'list') {
        const subList = child as MdastList;
        result.push(...convertList(subList, listLevel + 1, theme));
      } else {
        // Other blocks inside list item
        const converted = convertBlockNode(child, listLevel + 1, theme);
        result.push(...converted);
      }
    }
  }

  return result;
}

/**
 * Converts a GFM Table node into a docx Table with dual widths & borders
 */
function convertTable(
  tableNode: MdastTable,
  theme: DocxTheme = LEGACY_DOCX_THEME
): Table {
  const TOTAL_WIDTH_DXA = 9000;
  const rows = tableNode.children;
  if (rows.length === 0) {
    return new Table({ rows: [] });
  }

  const colsCount = Math.max(...rows.map((r) => r.children.length), 1);
  const baseColWidth = Math.floor(TOTAL_WIDTH_DXA / colsCount);
  const columnWidths = Array.from({ length: colsCount }, (_, i) =>
    i === colsCount - 1 ? TOTAL_WIDTH_DXA - baseColWidth * (colsCount - 1) : baseColWidth
  );

  const aligns = tableNode.align || [];

  const tableRows = rows.map((rowNode, rowIndex) => {
    const isHeader = rowIndex === 0;
    const cells = rowNode.children.map((cellNode, colIndex) => {
      const colWidth = columnWidths[colIndex] || baseColWidth;
      const alignType = aligns[colIndex];
      let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
      if (alignType === 'center') alignment = AlignmentType.CENTER;
      if (alignType === 'right') alignment = AlignmentType.RIGHT;

      const phrasingRuns = convertPhrasingChildren(cellNode.children, {
        bold: isHeader,
      }, theme);

      return new TableCell({
        width: {
          size: colWidth,
          type: WidthType.DXA,
        },
        shading: isHeader
          ? {
              type: ShadingType.CLEAR,
              fill: theme.panelColor,
            }
          : rowIndex % 2 === 0
          ? {
              type: ShadingType.CLEAR,
              fill: theme.panelAltColor,
            }
          : undefined,
        margins: {
          top: 120,
          bottom: 120,
          left: 160,
          right: 160,
        },
        children: [
          new Paragraph({
            alignment,
            spacing: { line: 240, after: 40 },
            children: phrasingRuns.length > 0 ? phrasingRuns : [new TextRun('')],
          }),
        ],
      });
    });

    return new TableRow({
      tableHeader: isHeader,
      children: cells,
    });
  });

  return new Table({
    width: {
      size: TOTAL_WIDTH_DXA,
      type: WidthType.DXA,
    },
    columnWidths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: theme.borderColor },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.borderColor },
      left: { style: BorderStyle.SINGLE, size: 4, color: theme.borderColor },
      right: { style: BorderStyle.SINGLE, size: 4, color: theme.borderColor },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: theme.borderLightColor },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: theme.borderLightColor },
    },
    rows: tableRows,
  });
}

/**
 * Converts a code block node into multiple styled paragraphs
 */
function convertCodeBlock(
  codeNode: MdastCode,
  theme: DocxTheme = LEGACY_DOCX_THEME
): Paragraph[] {
  const codeText = codeNode.value || '';
  const lines = codeText.split(/\r?\n/);

  return lines.map((line, idx) => {
    return new Paragraph({
      shading: {
        type: ShadingType.CLEAR,
        fill: theme.panelAltColor,
      },
      indent: {
        left: 360,
        right: 360,
      },
      spacing: {
        line: 240,
        before: idx === 0 ? 120 : 0,
        after: idx === lines.length - 1 ? 120 : 0,
      },
      children: [
        new TextRun({
          text: line.length > 0 ? line : ' ',
          font: theme.monoFont,
          size: 19,
          color: theme.codeColor,
        }),
      ],
    });
  });
}

/**
 * Converts a single mdast block node into docx elements
 */
function convertBlockNode(
  node: RootContent,
  indentContext = 0,
  theme: DocxTheme = LEGACY_DOCX_THEME
): (Paragraph | Table)[] {
  switch (node.type) {
    case 'heading': {
      const headingNode = node as Heading;
      const cfg = getHeadingConfig(headingNode.depth, theme);
      const runs = convertPhrasingChildren(headingNode.children, {
        bold: true,
        color: cfg.color,
        size: cfg.size,
      }, theme);
      return [
        new Paragraph({
          heading: cfg.level,
          spacing: {
            before: cfg.spacingBefore,
            after: cfg.spacingAfter,
          },
          children: runs.length > 0 ? runs : [new TextRun('')],
        }),
      ];
    }
    case 'paragraph': {
      const pNode = node as MdastParagraph;
      const runs = convertPhrasingChildren(pNode.children, {}, theme);
      return [
        new Paragraph({
          spacing: { line: 276, after: 120 },
          children: runs.length > 0 ? runs : [new TextRun('')],
        }),
      ];
    }
    case 'list': {
      return convertList(node as MdastList, indentContext, theme);
    }
    case 'blockquote': {
      const bqNode = node as MdastBlockquote;
      const result: (Paragraph | Table)[] = [];
      for (const child of bqNode.children) {
        if (child.type === 'paragraph') {
          const pNode = child as MdastParagraph;
          const runs = convertPhrasingChildren(pNode.children, {
            color: theme.quoteColor,
            italics: true,
          }, theme);
          result.push(
            new Paragraph({
              indent: { left: 720, right: 360 },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 24,
                  color: theme.quoteBorderColor,
                  space: 16,
                },
              },
              shading: {
                type: ShadingType.CLEAR,
                fill: theme.panelAltColor,
              },
              spacing: { before: 80, after: 80, line: 260 },
              children: runs,
            })
          );
        } else {
          result.push(...convertBlockNode(child, indentContext + 1, theme));
        }
      }
      return result;
    }
    case 'code': {
      return convertCodeBlock(node as MdastCode, theme);
    }
    case 'table': {
      return [convertTable(node as MdastTable, theme)];
    }
    case 'thematicBreak': {
      return [
        new Paragraph({
          spacing: { before: 200, after: 200 },
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 6,
              color: theme.borderColor,
              space: 1,
            },
          },
        }),
      ];
    }
    case 'html': {
      const htmlNode = node as Html;
      const plainText = htmlNode.value.replace(/<[^>]*>/g, '').trim();
      if (plainText) {
        return [
          new Paragraph({
            spacing: { line: 276, after: 120 },
            children: [new TextRun(plainText)],
          }),
        ];
      }
      return [];
    }
    default:
      return [];
  }
}

/**
 * Exports a markdown string to OOXML .docx binary format (Uint8Array).
 *
 * Passing no `style` preserves the legacy document exactly (Microsoft YaHei,
 * 11pt, page-number footer, no cover/TOC/header). An explicit style controls
 * the document font/size/colors and the optional cover, TOC, header, and
 * footer; `pageNumbers: false` removes the footer instead of leaving it on.
 */
export async function exportMarkdownToDocx(
  markdown: string,
  title: string,
  lang?: string,
  style?: ExportStyle
): Promise<Uint8Array> {
  const normalizedStyle = style ? validateExportStyle(style) : undefined;
  const theme = normalizedStyle ? createDocxTheme(normalizedStyle) : LEGACY_DOCX_THEME;

  // Front matter parses to a `yaml` node, which convertBlockNode ignores, so
  // the metadata block never reaches the document body.
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .parse(markdown) as Root;
  transformCallouts(tree, lang);

  const content: FileChild[] = [];
  for (const node of tree.children) {
    const elements = convertBlockNode(node, 0, theme);
    content.push(...elements);
  }

  const bodyChildren: FileChild[] = [];
  const documentTitle = title || 'Markdown Document';

  if (normalizedStyle?.cover) {
    const coverDate = new Date().toISOString().slice(0, 10);
    bodyChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 240 },
        children: [
          new TextRun({
            text: documentTitle,
            bold: true,
            font: theme.font,
            size: 56,
            color: theme.headingColors[0],
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: coverDate,
            font: theme.font,
            size: 22,
            color: theme.mutedColor,
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  if (normalizedStyle?.toc) {
    const tocLabel = getDocxTocLabel(lang);
    bodyChildren.push(
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [
          new TextRun({
            text: tocLabel,
            bold: true,
            font: theme.font,
            size: 30,
            color: theme.headingColors[0],
          }),
        ],
      }),
      new TableOfContents(tocLabel, {
        hyperlink: true,
        headingStyleRange: '1-3',
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  bodyChildren.push(...content);

  // If document was completely empty, include at least one empty paragraph.
  if (bodyChildren.length === 0) {
    bodyChildren.push(new Paragraph({ children: [new TextRun('')] }));
  }

  const showPageNumbers = normalizedStyle ? normalizedStyle.pageNumbers : true;
  const header = normalizedStyle?.headerText
    ? {
        default: new Header({
          children: [
            new Paragraph({
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 4,
                  color: theme.borderColor,
                  space: 4,
                },
              },
              children: [
                new TextRun({
                  text: normalizedStyle.headerText,
                  font: theme.font,
                  size: 18,
                  color: theme.mutedColor,
                }),
              ],
            }),
          ],
        }),
      }
    : undefined;
  const footer = showPageNumbers
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                  size: 18,
                  color: '94A3B8',
                }),
              ],
            }),
          ],
        }),
      }
    : undefined;

  const doc = new Document({
    creator: 'Markdown Editor',
    title: documentTitle,
    ...(normalizedStyle?.toc ? { features: { updateFields: true } } : {}),
    numbering: {
      config: NUMBERING_CONFIG,
    },
    styles: {
      default: {
        document: {
          run: {
            font: theme.font,
            size: theme.size,
            color: theme.textColor,
          },
          paragraph: {
            spacing: {
              line: 276, // 1.15
              after: 120, // 6pt
            },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 Width in DXA
              height: 16838, // A4 Height in DXA
            },
            margin: {
              top: 1440, // 1 inch (25.4mm)
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        ...(header ? { headers: header } : {}),
        ...(footer ? { footers: footer } : {}),
        children: bodyChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
