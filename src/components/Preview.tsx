import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useDeferredValue,
  createContext,
} from 'react';
import Markdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { PluggableList } from 'unified';
import { remarkCallouts } from '@/lib/remarkCallouts';
import { remarkFrontMatterAsCode } from '@/lib/frontMatter';
import remarkMath from 'remark-math';
import { remarkCjkFriendlyEmphasis } from '@/lib/remarkCjkFriendlyEmphasis';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { openExternalUrl } from '@/lib/native';
import { documentUrlTransform } from '@/lib/documentLinks';
import { findSourceLineForElement } from '@/lib/taskList';
import { Check, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { MermaidBlock } from './MermaidBlock';
import { LocalImage } from '@/components/LocalImage';
import { ImageLightbox, ImageLightboxHandle } from '@/components/ImageLightbox';
import {
  CHUNKS_PER_IDLE_BATCH,
  INITIAL_VISIBLE_CHUNKS,
  MarkdownChunk,
  getAdaptivePreviewDebounceMs,
  hasPotentialMathSyntax,
  splitLargeMarkdownIntoChunks,
} from '@/lib/largeDocument';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

/**
 * Centralized color constants for code blocks (GitHub Dark compatible).
 * Using explicit styles ensures high contrast in both light and dark UI themes
 * regardless of CSS bundle order or body inheritance.
 */
export const CODE_THEME = {
  bg: '#0d1117',
  headerBg: '#161b22',
  headerBorder: '#30363d',
  headerText: '#8b949e',
  text: '#c9d1d9',
} as const;

export { MermaidBlock } from './MermaidBlock';

/**
 * Hoisted to module scope so their references stay stable across renders.
 * Passing fresh array literals here makes react-markdown rebuild its internal
 * processor pipeline on every keystroke.
 */
const REHYPE_PLUGINS_WITH_MATH: PluggableList = [rehypeKatex, rehypeSlug, rehypeHighlight];
const REHYPE_PLUGINS_NO_MATH: PluggableList = [rehypeSlug, rehypeHighlight];

function getRehypePlugins(withMath: boolean): PluggableList {
  return withMath ? REHYPE_PLUGINS_WITH_MATH : REHYPE_PLUGINS_NO_MATH;
}

/**
 * Remark plugins cached by `(lang, withMath, allowFrontMatter)` so their array
 * references remain stable across renders while skipping `remark-math` on
 * math-free text and skipping front-matter parsing on chunks after line 1.
 */
const REMARK_PLUGINS_CACHE = new Map<string, PluggableList>();
function getRemarkPlugins(
  lang: string,
  withMath: boolean,
  allowFrontMatter = true
): PluggableList {
  const key = `${lang}|${withMath ? 'm1' : 'm0'}|${allowFrontMatter ? 'fm1' : 'fm0'}`;
  let plugins = REMARK_PLUGINS_CACHE.get(key);
  if (!plugins) {
    plugins = [remarkGfm];
    if (allowFrontMatter) {
      plugins.push([remarkFrontmatter, ['yaml', 'toml']], remarkFrontMatterAsCode);
    }
    if (withMath) {
      plugins.push(remarkMath);
    }
    plugins.push(remarkCjkFriendlyEmphasis, [remarkCallouts, { lang }]);
    REMARK_PLUGINS_CACHE.set(key, plugins);
  }
  return plugins;
}

/**
 * Provides a 0-based line offset for chunked large-document rendering so every
 * block element's `data-line` reflects its exact 1-based line in the full file.
 */
const ChunkLineOffsetContext = createContext<number>(0);

export interface PreviewHandle {
  scrollToAnchor: (slug: string, line?: number) => void;
  scrollToRatio: (ratio: number) => void;
  /** Scrolls so the content rendered from the given source line reaches the top. */
  scrollToSourceLine: (line: number, fraction?: number) => void;
  /** Returns the source line currently rendered at the top of the viewport. */
  getTopSourceLine: () => { line: number; fraction: number };
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
}

interface PreviewProps {
  content: string;
  onOpenLink?: (href: string) => Promise<void>;
  /**
   * Called with the 1-based source line of a clicked task-list checkbox.
   * The line mapping stays valid even while the rendered body lags behind the
   * editor (deferred rendering), so the caller toggles its own live content.
   */
  onToggleTask?: (line: number) => void;
  /** Whether to show source line numbers in the gutter (like the editor). */
  showLineNumbers?: boolean;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  className?: string;
  sourcePath?: string | null;
}

/** Minimal structural view of a hast node, sufficient for line extraction. */
interface HastNodeLike {
  position?: { start?: { line?: number } };
  children?: Array<{ type: string; position?: { start?: { line?: number } } }>;
}

/**
 * Extracts the 1-based source line of a block element.
 * When `skipIfChildSameLine` is true, returns undefined if the first element
 * child starts on the same line (the child renders the number instead),
 * preventing duplicated line numbers for e.g. `li > p` or `blockquote > p`.
 */
function getBlockLine(
  node: HastNodeLike | undefined,
  skipIfChildSameLine = false,
  lineOffset = 0
): number | undefined {
  const line = node?.position?.start?.line;
  if (typeof line !== 'number' || line <= 0) return undefined;
  if (skipIfChildSameLine) {
    const firstElementChild = node?.children?.find((c) => c.type === 'element');
    if (firstElementChild?.position?.start?.line === line) return undefined;
  }
  return line + lineOffset;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const createHeadingRenderer = (Tag: HeadingTag) => {
  const HeadingComponent: React.FC<
    React.ComponentPropsWithoutRef<HeadingTag> & ExtraProps
  > = ({ node, children, ...props }) => {
    const lineOffset = useContext(ChunkLineOffsetContext);
    const rawLine = node?.position?.start?.line;
    const line = typeof rawLine === 'number' && rawLine > 0 ? rawLine + lineOffset : undefined;
    return (
      <Tag data-line={line} {...props}>
        {children}
      </Tag>
    );
  };
  HeadingComponent.displayName = Tag;
  return HeadingComponent;
};

const ParagraphRenderer: React.FC<React.ComponentPropsWithoutRef<'p'> & ExtraProps> = ({
  node,
  children,
  ...props
}) => {
  const lineOffset = useContext(ChunkLineOffsetContext);
  return (
    <p data-line={getBlockLine(node as HastNodeLike | undefined, false, lineOffset)} {...props}>
      {children}
    </p>
  );
};

const ListItemRenderer: React.FC<React.ComponentPropsWithoutRef<'li'> & ExtraProps> = ({
  node,
  children,
  ...props
}) => {
  const lineOffset = useContext(ChunkLineOffsetContext);
  return (
    <li data-line={getBlockLine(node as HastNodeLike | undefined, true, lineOffset)} {...props}>
      {children}
    </li>
  );
};

const BlockquoteRenderer: React.FC<React.ComponentPropsWithoutRef<'blockquote'> & ExtraProps> = ({
  node,
  children,
  ...props
}) => {
  const lineOffset = useContext(ChunkLineOffsetContext);
  return (
    <blockquote
      data-line={getBlockLine(node as HastNodeLike | undefined, true, lineOffset)}
      {...props}
    >
      {children}
    </blockquote>
  );
};

const TableRenderer: React.FC<React.ComponentPropsWithoutRef<'table'> & ExtraProps> = ({
  node,
  children,
  ...props
}) => {
  const lineOffset = useContext(ChunkLineOffsetContext);
  return (
    <div
      className="md-table-wrap"
      data-line={getBlockLine(node as HastNodeLike | undefined, false, lineOffset)}
    >
      <table {...props}>{children}</table>
    </div>
  );
};

/**
 * Safely find an element inside the preview container by line number or slug/id
 * without risking DOMException from querySelector on special CSS characters.
 */
function findElementInContainer(
  container: HTMLElement,
  slug?: string,
  line?: number
): HTMLElement | null {
  // 1. Priority: locate by source line number
  if (typeof line === 'number' && line > 0) {
    const elByLine = container.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (elByLine) {
      return elByLine;
    }
  }

  // 2. Fallback: locate by slug / ID
  if (!slug) return null;

  const rawSlug = slug;
  let decodedSlug = slug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    // ignore decode error
  }

  // Check getElementById first (standard fast lookup)
  for (const id of [rawSlug, decodedSlug]) {
    if (!id) continue;
    const byId = document.getElementById(id);
    if (byId && container.contains(byId)) {
      return byId as HTMLElement;
    }
  }

  // Safe querySelector using CSS.escape if available
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    for (const id of [rawSlug, decodedSlug]) {
      if (!id) continue;
      try {
        const el = container.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (el) return el;
      } catch {
        // ignore selector error
      }
    }
  }

  // Linear scan fallback for any element matching id in container
  const elementsWithId = container.querySelectorAll<HTMLElement>('[id]');
  for (let i = 0; i < elementsWithId.length; i++) {
    const el = elementsWithId[i];
    if (el.id === rawSlug || el.id === decodedSlug) {
      return el;
    }
  }

  return null;
}

const TOP_SCROLL_OFFSET = 16;

/**
 * Recursively extracts plain text content from React nodes / AST children.
 */
export function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('');
  }
  if (React.isValidElement(node) && node.props && 'children' in (node.props as Record<string, unknown>)) {
    return extractTextContent((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

/**
 * Context to distinguish block code (inside <pre>) from inline code (`...`).
 */
export const PreContext = createContext<boolean>(false);

export const PreRenderer: React.FC<React.ComponentPropsWithoutRef<'pre'> & ExtraProps> = ({
  node,
  children,
}) => {
  const lineOffset = useContext(ChunkLineOffsetContext);
  const rawLine = (node as HastNodeLike | undefined)?.position?.start?.line;
  const line = typeof rawLine === 'number' && rawLine > 0 ? rawLine + lineOffset : undefined;
  const child =
    React.isValidElement(children) && typeof line === 'number' && line > 0
      ? React.cloneElement(children as React.ReactElement<{ dataLine?: number }>, {
          dataLine: line,
        })
      : children;
  return <PreContext.Provider value={true}>{child}</PreContext.Provider>;
};

export interface CodeProps extends React.ComponentPropsWithoutRef<'code'> {
  className?: string;
  children?: React.ReactNode;
  /** Source line of the fenced code block, forwarded by PreRenderer. */
  dataLine?: number;
}

/**
 * Pure inline code renderer with no internal hooks or state.
 */
export const InlineCode: React.FC<CodeProps> = ({ className, style, children, ...props }) => {
  const combinedClassName = className
    ? `bg-slate-200/80 dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-mono text-xs px-1.5 py-0.5 rounded ${className}`
    : 'bg-slate-200/80 dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-mono text-xs px-1.5 py-0.5 rounded';

  return (
    <code className={combinedClassName} style={style} {...props}>
      {children}
    </code>
  );
};

/**
 * Fenced / indented block code component with unconditional hook execution,
 * copy-to-clipboard state, and explicit high-contrast theme styling.
 */
export const BlockCode: React.FC<CodeProps> = ({
  className: codeClassName,
  style,
  children,
  dataLine,
  ...props
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isFrontMatter = Boolean(codeClassName && /\bmd-frontmatter\b/.test(codeClassName));
  const [collapsed, setCollapsed] = useState(false);

  const match = /language-([a-zA-Z0-9_-]+)/.exec(codeClassName || '');
  const language = match ? match[1] : '';
  const rawCode = extractTextContent(children).replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(rawCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore
    }
  }, [rawCode]);

  const headerLabel = isFrontMatter
    ? `${t('preview.frontMatter')} · ${(language || 'yaml').toUpperCase()}`
    : language || 'text';

  return (
    <div
      className="relative group my-4 rounded-lg overflow-hidden border shadow-sm md-code-block"
      data-line={dataLine}
      data-frontmatter={isFrontMatter ? 'true' : undefined}
      style={{
        backgroundColor: CODE_THEME.bg,
        borderColor: CODE_THEME.headerBorder,
      }}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 text-xs font-mono select-none ${
          collapsed ? '' : 'border-b'
        }`}
        style={{
          backgroundColor: CODE_THEME.headerBg,
          color: CODE_THEME.headerText,
          borderColor: CODE_THEME.headerBorder,
        }}
      >
        {isFrontMatter ? (
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? t('preview.expandFrontMatter') : t('preview.collapseFrontMatter')
            }
            title={collapsed ? t('preview.expandFrontMatter') : t('preview.collapseFrontMatter')}
            className="flex items-center space-x-1 text-[11px] uppercase tracking-wider font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            style={{ color: CODE_THEME.headerText }}
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            <span>{headerLabel}</span>
          </button>
        ) : (
          <span
            className="text-[11px] uppercase tracking-wider font-semibold"
            style={{ color: CODE_THEME.headerText }}
          >
            {headerLabel}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          title={t('common.copyCode')}
          aria-label={t('common.copyCode')}
          className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-[11px]"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>
      </div>
      {!collapsed && (
        <div
          className="p-3 overflow-x-auto text-[13px] font-mono leading-relaxed"
          style={{ backgroundColor: CODE_THEME.bg, color: CODE_THEME.text }}
        >
          <pre className="!bg-transparent !p-0 !m-0" style={{ color: 'inherit', margin: 0, padding: 0 }}>
            <code
              className={codeClassName}
              style={{
                ...style,
                color: CODE_THEME.text,
                backgroundColor: 'transparent',
              }}
              {...props}
            >
              {children}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
};

/**
 * Dispatcher component mapped to markdown `code` tag.
 * Reads PreContext to route to InlineCode, MermaidBlock, or BlockCode cleanly,
 * ensuring React hook order is never conditionally altered.
 */
export const CodeBlock: React.FC<CodeProps> = (props) => {
  const isInsidePre = useContext(PreContext);
  if (!isInsidePre) {
    return <InlineCode {...props} />;
  }

  const match = /language-([a-zA-Z0-9_-]+)/.exec(props.className || '');
  const language = match ? match[1] : '';

  if (language === 'mermaid') {
    return <MermaidBlock {...props} />;
  }

  return <BlockCode {...props} />;
};

interface LineAnchor {
  line: number;
  /** Element top in content coordinates (i.e. the scrollTop that puts it at the very top). */
  top: number;
}

/**
 * Binary search for the last anchor satisfying `predicate`, assuming the array
 * is ordered so that the predicate is monotonically false→true.
 *
 * Anchor arrays hold one entry per rendered block, so a 5k-line document can
 * easily contain thousands of them. Both scroll directions used to scan the
 * whole array on every scroll event; this makes the lookup O(log n) instead.
 *
 * @returns index of the best match, or -1 when no entry matches.
 */
export function findLastIndexWhere<T>(
  items: readonly T[],
  predicate: (item: T) => boolean
): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (predicate(items[mid])) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

interface MarkdownChunkBlockProps {
  chunk: MarkdownChunk;
  language: string;
  components: Components;
}

const MarkdownChunkBlock: React.FC<MarkdownChunkBlockProps> = ({
  chunk,
  language,
  components,
}) => {
  const withMath = hasPotentialMathSyntax(chunk.text);
  const allowFrontMatter = chunk.startLine === 1;
  const lineOffset = chunk.startLine - 1;

  const body = (
    <Markdown
      urlTransform={documentUrlTransform}
      remarkPlugins={getRemarkPlugins(language, withMath, allowFrontMatter)}
      rehypePlugins={getRehypePlugins(withMath)}
      components={components}
    >
      {chunk.text}
    </Markdown>
  );

  if (lineOffset === 0) {
    return body;
  }

  return (
    <ChunkLineOffsetContext.Provider value={lineOffset}>
      {body}
    </ChunkLineOffsetContext.Provider>
  );
};

const MemoizedMarkdownChunk = React.memo(
  MarkdownChunkBlock,
  (prev, next) =>
    prev.chunk.text === next.chunk.text &&
    prev.chunk.startLine === next.chunk.startLine &&
    prev.language === next.language &&
    prev.components === next.components
);

const PreviewComponent = forwardRef<PreviewHandle, PreviewProps>(
  (
    {
      content,
      onOpenLink,
      onToggleTask,
      showLineNumbers = false,
      onScroll,
      className,
      sourcePath,
    },
    ref
  ) => {
    const { language } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);

    /**
     * Normal documents follow `useDeferredValue(content)` with zero artificial
     * delay; multi-hundred-KB / multi-MB documents add an adaptive debounce so
     * continuous typing never stalls on full-AST parses.
     */
    const deferredContent = useDeferredValue(content);
    const debounceMs = getAdaptivePreviewDebounceMs(content.length);
    const [debouncedLargeContent, setDebouncedLargeContent] = useState<string>(content);
    const prevSourcePathRef = useRef(sourcePath);

    useEffect(() => {
      // Switching to another file updates immediately without debounce lag
      if (prevSourcePathRef.current !== sourcePath) {
        prevSourcePathRef.current = sourcePath;
        setDebouncedLargeContent(content);
        return;
      }
      if (debounceMs === 0) {
        setDebouncedLargeContent(content);
        return;
      }
      const timer = setTimeout(() => {
        setDebouncedLargeContent(content);
      }, debounceMs);
      return () => clearTimeout(timer);
    }, [content, debounceMs, sourcePath]);

    const renderedContent = debounceMs === 0 ? deferredContent : debouncedLargeContent;

    const chunks = useMemo(
      () => splitLargeMarkdownIntoChunks(renderedContent),
      [renderedContent]
    );

    const isSSR = typeof window === 'undefined';
    const [visibleChunkCount, setVisibleChunkCount] = useState<number>(() =>
      isSSR ? chunks.length : Math.min(chunks.length, INITIAL_VISIBLE_CHUNKS)
    );
    const hydratedDocKeyRef = useRef<string | null | undefined>(sourcePath);

    useEffect(() => {
      if (isSSR) return;
      if (hydratedDocKeyRef.current !== sourcePath) {
        hydratedDocKeyRef.current = sourcePath;
        setVisibleChunkCount(Math.min(chunks.length, INITIAL_VISIBLE_CHUNKS));
        return;
      }
      if (chunks.length <= INITIAL_VISIBLE_CHUNKS) {
        setVisibleChunkCount(chunks.length);
        return;
      }
      // Once progressively hydrated, keep new chunks visible during edits
      setVisibleChunkCount((prev) =>
        prev >= chunks.length ? chunks.length : Math.max(prev, INITIAL_VISIBLE_CHUNKS)
      );
    }, [chunks.length, isSSR, sourcePath]);

    useEffect(() => {
      if (isSSR || visibleChunkCount >= chunks.length) return;

      const revealNextBatch = () => {
        setVisibleChunkCount((prev) => Math.min(chunks.length, prev + CHUNKS_PER_IDLE_BATCH));
      };

      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };

      if (typeof win.requestIdleCallback === 'function') {
        const idleId = win.requestIdleCallback(revealNextBatch, { timeout: 60 });
        return () => win.cancelIdleCallback?.(idleId);
      }

      const timerId = window.setTimeout(revealNextBatch, 16);
      return () => window.clearTimeout(timerId);
    }, [chunks.length, isSSR, visibleChunkCount]);

    const visibleChunks = isSSR ? chunks : chunks.slice(0, visibleChunkCount);

    // Cache of block-element positions keyed by source line. It is validated
    // against the container's current layout size on every access and rebuilt
    // lazily when stale, so width changes (read/split switches, sidebar
    // toggles, window resizes) and async content growth (e.g. image loading)
    // never reuse outdated measurements — otherwise mode switches would scroll
    // to positions computed for a different layout and the scrollbar jumps.
    const lineAnchorsRef = useRef<{
      width: number;
      height: number;
      anchors: LineAnchor[];
    } | null>(null);
    const totalLines = useMemo(() => content.split(/\r?\n/).length, [content]);

    useEffect(() => {
      lineAnchorsRef.current = null;
    }, [content, visibleChunkCount]);

    const getLineAnchors = useCallback((): LineAnchor[] => {
      const container = containerRef.current;
      if (!container) return [];
      const width = container.clientWidth;
      const height = container.scrollHeight;
      const cached = lineAnchorsRef.current;
      if (cached && cached.width === width && cached.height === height) {
        return cached.anchors;
      }
      const containerRect = container.getBoundingClientRect();
      const elements = container.querySelectorAll<HTMLElement>('[data-line]');
      const anchors: LineAnchor[] = [];
      elements.forEach((el) => {
        const line = Number(el.getAttribute('data-line'));
        if (!Number.isFinite(line) || line <= 0) return;
        const top = el.getBoundingClientRect().top - containerRect.top + container.scrollTop;
        anchors.push({ line, top });
      });
      anchors.sort((a, b) => a.line - b.line || a.top - b.top);
      // Dedupe identical lines, keeping the visually first element
      const deduped: LineAnchor[] = [];
      for (const anchor of anchors) {
        if (deduped.length === 0 || deduped[deduped.length - 1].line !== anchor.line) {
          deduped.push(anchor);
        }
      }
      lineAnchorsRef.current = { width, height, anchors: deduped };
      return deduped;
    }, []);

    const scrollToSourceLine = useCallback(
      (line: number, fraction = 0) => {
        const container = containerRef.current;
        if (!container) return;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;

        const anchors = getLineAnchors();
        if (anchors.length === 0) {
          // Fallback for documents without any locatable blocks: line ratio
          const ratio = totalLines > 1 ? (line - 1) / (totalLines - 1) : 0;
          container.scrollTop = Math.max(0, Math.min(maxScroll, ratio * maxScroll));
          return;
        }

        // Bracket the target line between the nearest known block anchors,
        // with sentinels at the document start and the bottom scroll limit.
        // Anchors are sorted by line, so binary search finds the last one at or
        // before the target without scanning the whole document.
        const idx = findLastIndexWhere(anchors, (anchor) => anchor.line <= line);
        const lo: LineAnchor = idx >= 0 ? anchors[idx] : { line: 1, top: 0 };
        const hi: LineAnchor =
          idx + 1 < anchors.length ? anchors[idx + 1] : { line: totalLines + 1, top: maxScroll };

        const span = hi.line - lo.line;
        const ratio = span > 0 ? Math.min(1, Math.max(0, (line + fraction - lo.line) / span)) : 0;
        const target = lo.top + ratio * (hi.top - lo.top);
        container.scrollTop = Math.max(0, Math.min(maxScroll, target));
      },
      [getLineAnchors, totalLines]
    );

    const scrollToElement = useCallback((container: HTMLElement, targetElement: HTMLElement) => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const targetRelativeTop = targetRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = Math.max(0, targetRelativeTop - TOP_SCROLL_OFFSET);
      container.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });
    }, []);

    const scrollToTarget = useCallback(
      (slug: string, line?: number) => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const targetElement = findElementInContainer(container, slug, line);
        if (targetElement) {
          scrollToElement(container, targetElement);
        }
      },
      [scrollToElement]
    );

    const ensureAllChunksMounted = useCallback(() => {
      if (!isSSR && visibleChunkCount < chunks.length) {
        setVisibleChunkCount(chunks.length);
      }
    }, [chunks.length, isSSR, visibleChunkCount]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToAnchor: (slug: string, line?: number) => {
          ensureAllChunksMounted();
          scrollToTarget(slug, line);
        },

        scrollToRatio: (ratio: number) => {
          ensureAllChunksMounted();
          if (!containerRef.current) return;
          const { scrollHeight, clientHeight } = containerRef.current;
          const maxScroll = scrollHeight - clientHeight;
          if (maxScroll > 0) {
            containerRef.current.scrollTop = ratio * maxScroll;
          }
        },

        scrollToSourceLine: (line: number, fraction?: number) => {
          ensureAllChunksMounted();
          scrollToSourceLine(line, fraction);
        },

        getTopSourceLine: () => {
          const container = containerRef.current;
          if (!container) return { line: 1, fraction: 0 };
          const scrollTop = container.scrollTop;
          const maxScroll = container.scrollHeight - container.clientHeight;
          const anchors = getLineAnchors();

          if (anchors.length === 0 || maxScroll <= 0) {
            const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
            const line = Math.max(1, Math.round(ratio * (totalLines - 1)) + 1);
            return { line, fraction: 0 };
          }

          // Inverse of scrollToSourceLine: bracket scrollTop between anchors.
          // Anchors are ordered by top for a monotonically increasing scroll
          // position, so binary search replaces the previous linear scan.
          const idx = findLastIndexWhere(anchors, (anchor) => anchor.top <= scrollTop);
          const lo: LineAnchor = idx >= 0 ? anchors[idx] : { line: 1, top: 0 };
          const hi: LineAnchor =
            idx + 1 < anchors.length
              ? anchors[idx + 1]
              : { line: totalLines + 1, top: maxScroll };

          const span = hi.top - lo.top;
          const ratio = span > 0 ? Math.min(1, Math.max(0, (scrollTop - lo.top) / span)) : 0;
          const lineFloat = lo.line + ratio * (hi.line - lo.line);
          const line = Math.max(1, Math.min(Math.floor(lineFloat), totalLines));
          const fraction = Math.min(1, Math.max(0, lineFloat - line));
          return { line, fraction };
        },

        getScrollTop: () => {
          return containerRef.current ? containerRef.current.scrollTop : 0;
        },

        setScrollTop: (top: number) => {
          if (containerRef.current) {
            containerRef.current.scrollTop = top;
          }
        },
      }),
      [ensureAllChunksMounted, getLineAnchors, scrollToTarget, scrollToSourceLine, totalLines]
    );

    const lightboxRef = useRef<ImageLightboxHandle>(null);

    // Clicking a rendered image (outside of a link) opens it enlarged.
    const handleContainerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'IMG' || target.closest('a')) return;
      const image = target as HTMLImageElement;
      if (!image.currentSrc && !image.src) return;
      lightboxRef.current?.open(image.currentSrc || image.src, image.alt || '');
    }, []);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (onScroll) {
        const target = e.currentTarget;
        onScroll(target.scrollTop, target.scrollHeight, target.clientHeight);
      }
    };

    const components: Components = useMemo(
      () => ({
        h1: createHeadingRenderer('h1'),
        h2: createHeadingRenderer('h2'),
        h3: createHeadingRenderer('h3'),
        h4: createHeadingRenderer('h4'),
        h5: createHeadingRenderer('h5'),
        h6: createHeadingRenderer('h6'),
        /**
         * GFM task-list checkboxes. remark-gfm emits them `disabled`, so the
         * box is made interactive and clicking it flips the matching `- [ ]`
         * marker in the source document.
         */
        input: ({ node: _node, type, checked, disabled: _disabled, ...props }) => {
          if (type !== 'checkbox') {
            return <input type={type} checked={checked} disabled={_disabled} {...props} />;
          }

          // remark-gfm marks task checkboxes `disabled`; the attribute must be
          // dropped (props are spread first) or the box stays unclickable.
          return (
            <input
              {...props}
              type="checkbox"
              checked={Boolean(checked)}
              disabled={!onToggleTask}
              onChange={(event) => {
                if (!onToggleTask) return;
                const line = findSourceLineForElement(event.currentTarget);
                if (line !== null) onToggleTask(line);
              }}
              className="cursor-pointer accent-blue-600"
            />
          );
        },
        p: ParagraphRenderer,
        li: ListItemRenderer,
        blockquote: BlockquoteRenderer,
        table: TableRenderer,
        pre: PreRenderer,
        code: CodeBlock,
        img: ({ node: _node, ...props }) => (
          <LocalImage {...props} sourcePath={sourcePath} />
        ),
        a: ({ href, children, node: _node, ...props }) => {
          const isAnchor = href?.startsWith('#');

          const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (isAnchor && href) {
              e.preventDefault();
              const targetId = href.slice(1);
              if (targetId) {
                scrollToTarget(targetId);
              }
            } else if (href) {
              e.preventDefault();
              (onOpenLink ? onOpenLink(href) : openExternalUrl(href)).catch((err) => {
                console.warn('无法打开外部链接:', err);
              });
            }
          };

          return (
            <a
              href={href}
              onClick={handleClick}
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors cursor-pointer"
              {...props}
            >
              {children}
            </a>
          );
        },
      }),
      [scrollToTarget, onOpenLink, onToggleTask, sourcePath]
    );

    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClick={handleContainerClick}
        className={`h-full w-full overflow-y-auto px-6 py-6 select-text ${className || ''}`}
      >
        <ImageLightbox ref={lightboxRef} />
        <div
          className={`max-w-3xl mx-auto markdown-body ${
            showLineNumbers ? 'md-show-line-numbers' : ''
          }`}
        >
          {visibleChunks.map((chunk) => (
            <MemoizedMarkdownChunk
              key={chunk.index}
              chunk={chunk}
              language={language}
              components={components}
            />
          ))}
        </div>
      </div>
    );
  }
);

PreviewComponent.displayName = 'Preview';

/**
 * Memoized so unrelated App state (toasts, cursor moves, settings dialogs)
 * does not re-run the Markdown → HAST → HTML pipeline for an unchanged body.
 */
export const Preview = React.memo(PreviewComponent);
