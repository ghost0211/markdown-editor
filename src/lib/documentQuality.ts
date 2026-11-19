import type { Language } from '@/i18n/types';
import type { AnchorRepair } from '@/lib/documentAnchors';
import { documentStructureParser } from '@/lib/documentStructure';
import { scanDocumentResources } from '@/lib/documentResources';
import { getFileSize } from '@/lib/native';

export type QualitySeverity = 'error' | 'warning' | 'info';
export type QualityLanguage = Language;

/** Stable identifiers for the checks implemented by this module. */
export type QualityRule =
  | 'heading-level-jump'
  | 'empty-heading'
  | 'image-empty-alt'
  | 'empty-link-address'
  | 'empty-image-address'
  | 'unclosed-code-fence'
  | 'unclosed-frontmatter'
  | 'duplicate-heading'
  | 'resource-missing'
  | 'resource-unresolved'
  | 'link-anchor-missing';

export interface QualityIssue {
  id: string;
  rule: string;
  severity: QualitySeverity;
  line: number;
  column: number;
  message: string;
  repair?: AnchorRepair;
}

/** Reads a local file's size. Injected in tests so no native runtime is needed. */
export type ResourceSizeReader = (path: string) => Promise<number>;

type IssueDraft = Omit<QualityIssue, 'id'>;

interface AstNode {
  type: string;
  value?: unknown;
  alt?: unknown;
  url?: unknown;
  depth?: unknown;
  children?: AstNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
  };
}

const SEVERITY_RANK: Record<QualitySeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Locale-independent ordering shared by the analyzer and the panel. */
export function compareQualityIssues(
  left: QualityIssue,
  right: QualityIssue
): number {
  if (left.line !== right.line) return left.line - right.line;
  if (left.column !== right.column) return left.column - right.column;
  if (left.severity !== right.severity) {
    return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  }
  if (left.rule !== right.rule) return left.rule.localeCompare(right.rule);
  return left.message.localeCompare(right.message);
}

function stripBom(markdown: string): string {
  return markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown;
}

function normalizeLanguage(language?: string): QualityLanguage {
  return language === 'en-US' ? 'en-US' : 'zh-CN';
}

function bilingual(
  language: QualityLanguage,
  chinese: string,
  english: string
): string {
  return language === 'en-US' ? english : chinese;
}

function compactText(value: string, maxLength = 60): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function startPosition(node: AstNode): { line: number; column: number } {
  const start = node.position?.start;
  return {
    line:
      start && Number.isFinite(start.line) && start.line > 0 ? start.line : 1,
    column:
      start && Number.isFinite(start.column) && start.column > 0
        ? start.column
        : 1,
  };
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  if (node.children) {
    for (const child of node.children) walk(child, visit);
  }
}

function nodeText(node: AstNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'math':
    case 'inlineMath':
      return typeof node.value === 'string' ? node.value : '';
    case 'image':
    case 'imageReference':
      return typeof node.alt === 'string' ? node.alt : '';
    case 'break':
      return ' ';
    case 'html':
      // Raw HTML (including comments) is not visible heading text.
      return '';
    default:
      break;
  }
  if (node.children) return node.children.map(nodeText).join('');
  return '';
}

function columnAt(markdown: string, offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 1;
  const bounded = Math.min(Math.floor(offset), markdown.length);
  const newline = markdown.lastIndexOf('\n', bounded - 1);
  return newline < 0 ? bounded + 1 : bounded - newline;
}

/**
 * A leading `---` / `+++` that has no closing fence would be parsed by
 * remark-frontmatter as, respectively, a thematic break or a paragraph. To
 * avoid turning every document that starts with a horizontal rule into an
 * error, require the first meaningful line to look like YAML/TOML metadata.
 * Code, math and HTML comments cannot be mistaken for an opener because the
 * opener must be the very first line of the document.
 */
function detectUnclosedFrontMatter(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const first = (lines[0] ?? '').trimEnd();
  const opener = first === '---' ? '---' : first === '+++' ? '+++' : null;
  if (!opener) return false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (opener === '---' ? line === '---' || line === '...' : line === '+++') {
      return false;
    }
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith('#')) continue; // YAML/TOML comment line
    const looksLikeYaml = /^[A-Za-z0-9_][\w .\-/]*\s*:(?:\s|$)/.test(line);
    const looksLikeToml = /^[A-Za-z0-9_][\w .\-/]*\s*=/.test(line);
    return opener === '---' ? looksLikeYaml : looksLikeToml;
  }
  return false;
}

function hasClosingFence(
  lines: readonly string[],
  fromLineIndex: number,
  character: string,
  minimumLength: number
): boolean {
  for (let index = fromLineIndex; index < lines.length; index += 1) {
    const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[index]);
    if (
      match &&
      match[1][0] === character &&
      match[1].length >= minimumLength
    ) {
      return true;
    }
  }
  return false;
}

function finalizeIssues(
  drafts: readonly IssueDraft[],
  namespace: string
): QualityIssue[] {
  return [...drafts]
    .sort((left, right) => {
      if (left.line !== right.line) return left.line - right.line;
      if (left.column !== right.column) return left.column - right.column;
      if (left.severity !== right.severity) {
        return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      }
      if (left.rule !== right.rule) return left.rule.localeCompare(right.rule);
      return left.message.localeCompare(right.message);
    })
    .map((draft, index) => ({
      ...draft,
      id: `${namespace}-${index}-${draft.rule}-${draft.line}-${draft.column}`,
    }));
}

/**
 * Syntax-only quality analysis over a real Markdown AST.
 *
 * The AST guarantees that fenced/indented code, math, escaped punctuation and
 * HTML comments are never parsed as headings, images or links, so the checks
 * cannot be fooled by those constructs. Local file checks are deliberately
 * asynchronous and live in {@link checkLocalDocumentResources}.
 */
export function analyzeDocumentQuality(
  markdown: string,
  sourcePath?: string | null,
  language: QualityLanguage = 'zh-CN'
): QualityIssue[] {
  // Syntax checks do not need the source path; it is accepted for a stable
  // public API and for callers that run the resource check alongside this one.
  void sourcePath;

  const lang = normalizeLanguage(language);
  const body = stripBom(markdown ?? '');
  if (!body.trim()) return [];

  let tree: AstNode;
  try {
    tree = documentStructureParser.parse(body) as unknown as AstNode;
  } catch {
    // A parser failure is not a document defect we can describe; return no
    // syntax findings instead of leaking parser internals to the UI.
    return [];
  }

  const drafts: IssueDraft[] = [];
  const headings: AstNode[] = [];
  const codeBlocks: AstNode[] = [];
  const sourceLines = body.split(/\r?\n/);

  walk(tree, (node) => {
    switch (node.type) {
      case 'heading': {
        headings.push(node);
        break;
      }
      case 'code': {
        codeBlocks.push(node);
        break;
      }
      case 'image': {
        if (!String(node.alt ?? '').trim()) {
          drafts.push({
            rule: 'image-empty-alt',
            severity: 'warning',
            ...startPosition(node),
            message: bilingual(
              lang,
              '图片缺少替代文本（alt）',
              'Image is missing alternative text (alt)'
            ),
          });
        }
        if (String(node.url ?? '').trim() === '') {
          drafts.push({
            rule: 'empty-image-address',
            severity: 'warning',
            ...startPosition(node),
            message: bilingual(lang, '图片地址为空', 'Image address is empty'),
          });
        }
        break;
      }
      case 'imageReference': {
        if (!String(node.alt ?? '').trim()) {
          drafts.push({
            rule: 'image-empty-alt',
            severity: 'warning',
            ...startPosition(node),
            message: bilingual(
              lang,
              '图片缺少替代文本（alt）',
              'Image is missing alternative text (alt)'
            ),
          });
        }
        break;
      }
      case 'link': {
        if (String(node.url ?? '').trim() === '') {
          drafts.push({
            rule: 'empty-link-address',
            severity: 'warning',
            ...startPosition(node),
            message: bilingual(lang, '链接地址为空', 'Link address is empty'),
          });
        }
        break;
      }
      default:
        break;
    }
  });

  let previousDepth = 0;
  const firstSeenHeading = new Map<string, number>();

  for (const heading of headings) {
    const depth =
      typeof heading.depth === 'number' && heading.depth > 0 ? heading.depth : 0;
    const position = startPosition(heading);
    const text = nodeText(heading).trim();

    if (!text) {
      drafts.push({
        rule: 'empty-heading',
        severity: 'warning',
        ...position,
        message: bilingual(
          lang,
          `标题内容为空（H${depth || '?'}）`,
          `Empty heading (H${depth || '?'})`
        ),
      });
    }

    if (previousDepth > 0 && depth > previousDepth + 1) {
      drafts.push({
        rule: 'heading-level-jump',
        severity: 'warning',
        ...position,
        message: bilingual(
          lang,
          `标题层级跳跃：H${previousDepth} 之后直接出现 H${depth}`,
          `Heading level jumps from H${previousDepth} to H${depth}`
        ),
      });
    }
    if (depth > 0) previousDepth = depth;

    if (text) {
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      const firstLine = firstSeenHeading.get(key);
      if (firstLine !== undefined) {
        drafts.push({
          rule: 'duplicate-heading',
          severity: 'info',
          ...position,
          message: bilingual(
            lang,
            `标题重复：“${compactText(text)}”（首次出现于第 ${firstLine} 行）`,
            `Duplicate heading “${compactText(text)}” (first seen on line ${firstLine})`
          ),
        });
      } else {
        firstSeenHeading.set(key, position.line);
      }
    }
  }

  for (const block of codeBlocks) {
    const line = startPosition(block).line;
    const openLine = sourceLines[line - 1];
    if (openLine === undefined) continue;
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(openLine);
    // Indented code and fences nested in lists/blockquotes do not expose a
    // top-level fence line here; they are skipped rather than misreported.
    if (!match) continue;
    const fence = match[2];
    if (hasClosingFence(sourceLines, line, fence[0], fence.length)) continue;
    drafts.push({
      rule: 'unclosed-code-fence',
      severity: 'error',
      ...startPosition(block),
      message: bilingual(lang, '代码块围栏未闭合', 'Unclosed code fence'),
    });
  }

  if (detectUnclosedFrontMatter(body)) {
    drafts.push({
      rule: 'unclosed-frontmatter',
      severity: 'error',
      line: 1,
      column: 1,
      message: bilingual(
        lang,
        '前置元数据（front matter）未闭合',
        'Unclosed front matter'
      ),
    });
  }

  return finalizeIssues(drafts, 'syntax');
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code.toUpperCase();
  }
  return '';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** Distinguishes "the file is gone" from "we could not check the file". */
function isMissingFileError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'OS ERR 2') {
    return true;
  }
  return /enoent|enotdir|no such file|not found|cannot find the (?:file|path)|does not exist|系统找不到/i.test(
    errorText(error)
  );
}

/**
 * Checks every local image/attachment reference found by the shared resource
 * scanner. Only `stat`-style size reads are performed: remote resources are
 * never requested, embedded Base64 is never decoded, and no file contents are
 * loaded. A missing file and an unreadable/unresolved path stay distinguishable
 * through their rule ids.
 */
export async function checkLocalDocumentResources(
  markdown: string,
  sourcePath?: string | null,
  readSize: ResourceSizeReader = getFileSize,
  language: QualityLanguage = 'zh-CN'
): Promise<QualityIssue[]> {
  const lang = normalizeLanguage(language);
  const body = stripBom(markdown ?? '');
  if (!body.trim()) return [];

  const resources = scanDocumentResources(body, sourcePath || undefined);
  const checked = new Set<string>();
  const drafts: IssueDraft[] = [];

  for (const resource of resources) {
    if (resource.location !== 'local') continue;

    const reference = resource.references[0];
    const line = reference?.line && reference.line > 0 ? reference.line : 1;
    const column = reference
      ? columnAt(body, reference.target.from)
      : 1;
    const key = resource.localPath || `unresolved:${resource.source}`;
    if (checked.has(key)) continue;
    checked.add(key);

    const name = compactText(resource.name || 'resource', 64);

    if (!resource.localPath) {
      drafts.push({
        rule: 'resource-unresolved',
        severity: 'error',
        line,
        column,
        message: bilingual(
          lang,
          `无法解析或读取本地资源：${name}`,
          `Local resource could not be resolved or read: ${name}`
        ),
      });
      continue;
    }

    try {
      const size = await readSize(resource.localPath);
      if (!Number.isFinite(size) || size < 0) {
        throw new Error('invalid-size');
      }
    } catch (error) {
      const missing = isMissingFileError(error);
      drafts.push({
        rule: missing ? 'resource-missing' : 'resource-unresolved',
        severity: 'error',
        line,
        column,
        message: missing
          ? bilingual(
              lang,
              `本地资源不存在：${name}`,
              `Local resource is missing: ${name}`
            )
          : bilingual(
              lang,
              `无法解析或读取本地资源：${name}`,
              `Local resource could not be resolved or read: ${name}`
            ),
      });
    }
  }

  return finalizeIssues(drafts, 'resource');
}
