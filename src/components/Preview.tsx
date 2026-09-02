import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  createContext,
} from 'react';
import Markdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { openExternalUrl } from '@/lib/native';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/i18n';
import 'highlight.js/styles/github-dark.css';

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
  /** Whether to show source line numbers in the gutter (like the editor). */
  showLineNumbers?: boolean;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  className?: string;
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
function getBlockLine(node: HastNodeLike | undefined, skipIfChildSameLine = false): number | undefined {
  const line = node?.position?.start?.line;
  if (typeof line !== 'number' || line <= 0) return undefined;
  if (skipIfChildSameLine) {
    const firstElementChild = node?.children?.find((c) => c.type === 'element');
    if (firstElementChild?.position?.start?.line === line) return undefined;
  }
  return line;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const createHeadingRenderer = (Tag: HeadingTag) => {
  const HeadingComponent: React.FC<
    React.ComponentPropsWithoutRef<HeadingTag> & ExtraProps
  > = ({ node, children, ...props }) => {
    const line = node?.position?.start?.line;
    return (
      <Tag data-line={line} {...props}>
        {children}
      </Tag>
    );
  };
  HeadingComponent.displayName = Tag;
  return HeadingComponent;
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
  // Forward the source line to the inner code block so its wrapper can carry
  // data-line (the wrapper is the visible block container with the header bar).
  const line = (node as HastNodeLike | undefined)?.position?.start?.line;
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

  return (
    <div
      className="relative group my-4 rounded-lg overflow-hidden border shadow-sm md-code-block"
      data-line={dataLine}
      style={{
        backgroundColor: CODE_THEME.bg,
        borderColor: CODE_THEME.headerBorder,
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b text-xs font-mono select-none"
        style={{
          backgroundColor: CODE_THEME.headerBg,
          color: CODE_THEME.headerText,
          borderColor: CODE_THEME.headerBorder,
        }}
      >
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: CODE_THEME.headerText }}
        >
          {language || 'text'}
        </span>
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
    </div>
  );
};

/**
 * Dispatcher component mapped to markdown `code` tag.
 * Reads PreContext to route to either InlineCode or BlockCode cleanly,
 * ensuring React hook order is never conditionally altered.
 */
export const CodeBlock: React.FC<CodeProps> = (props) => {
  const isInsidePre = useContext(PreContext);
  if (isInsidePre) {
    return <BlockCode {...props} />;
  }
  return <InlineCode {...props} />;
};

interface LineAnchor {
  line: number;
  /** Element top in content coordinates (i.e. the scrollTop that puts it at the very top). */
  top: number;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(
  ({ content, showLineNumbers = false, onScroll, className }, ref) => {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);

    // Cache of block-element positions keyed by source line, invalidated on
    // content change / window resize and rebuilt lazily on first use.
    const lineAnchorsRef = useRef<LineAnchor[] | null>(null);
    const totalLines = useMemo(() => content.split(/\r?\n/).length, [content]);

    useEffect(() => {
      lineAnchorsRef.current = null;
    }, [content]);

    useEffect(() => {
      const invalidate = () => {
        lineAnchorsRef.current = null;
      };
      window.addEventListener('resize', invalidate);
      return () => window.removeEventListener('resize', invalidate);
    }, []);

    const getLineAnchors = useCallback((): LineAnchor[] => {
      if (lineAnchorsRef.current) return lineAnchorsRef.current;
      const container = containerRef.current;
      if (!container) return [];
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
      lineAnchorsRef.current = deduped;
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
        let lo: LineAnchor = { line: 1, top: 0 };
        let hi: LineAnchor = { line: totalLines + 1, top: maxScroll };
        for (const anchor of anchors) {
          if (anchor.line <= line) {
            lo = anchor;
          } else {
            hi = anchor;
            break;
          }
        }

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

    useImperativeHandle(
      ref,
      () => ({
        scrollToAnchor: (slug: string, line?: number) => {
          scrollToTarget(slug, line);
        },

        scrollToRatio: (ratio: number) => {
          if (!containerRef.current) return;
          const { scrollHeight, clientHeight } = containerRef.current;
          const maxScroll = scrollHeight - clientHeight;
          if (maxScroll > 0) {
            containerRef.current.scrollTop = ratio * maxScroll;
          }
        },

        scrollToSourceLine,

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

          // Inverse of scrollToSourceLine: bracket scrollTop between anchors
          let lo: LineAnchor = { line: 1, top: 0 };
          let hi: LineAnchor = { line: totalLines + 1, top: maxScroll };
          for (const anchor of anchors) {
            if (anchor.top <= scrollTop) {
              lo = anchor;
            } else {
              hi = anchor;
              break;
            }
          }

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
      [scrollToTarget, scrollToSourceLine]
    );

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
        p: ({ node, children, ...props }) => (
          <p data-line={getBlockLine(node as HastNodeLike | undefined)} {...props}>
            {children}
          </p>
        ),
        li: ({ node, children, ...props }) => (
          <li data-line={getBlockLine(node as HastNodeLike | undefined, true)} {...props}>
            {children}
          </li>
        ),
        blockquote: ({ node, children, ...props }) => (
          <blockquote
            data-line={getBlockLine(node as HastNodeLike | undefined, true)}
            {...props}
          >
            {children}
          </blockquote>
        ),
        table: ({ node, children, ...props }) => (
          <div
            className="md-table-wrap"
            data-line={getBlockLine(node as HastNodeLike | undefined)}
          >
            <table {...props}>{children}</table>
          </div>
        ),
        pre: PreRenderer,
        code: CodeBlock,
        a: ({ href, children, ...props }) => {
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
              openExternalUrl(href).catch((err) => {
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
      [scrollToTarget, t]
    );

    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`h-full w-full overflow-y-auto px-6 py-6 select-text ${className || ''}`}
      >
        <div
          className={`max-w-3xl mx-auto markdown-body ${
            showLineNumbers ? 'md-show-line-numbers' : ''
          }`}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeHighlight]}
            components={components}
          >
            {content}
          </Markdown>
        </div>
      </div>
    );
  }
);

Preview.displayName = 'Preview';
