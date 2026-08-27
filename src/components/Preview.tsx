import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import Markdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { openExternalUrl } from '@/lib/native';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

export interface PreviewHandle {
  scrollToAnchor: (slug: string, line?: number) => void;
  scrollToRatio: (ratio: number) => void;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
}

interface PreviewProps {
  content: string;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  className?: string;
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

export const Preview = forwardRef<PreviewHandle, PreviewProps>(
  ({ content, onScroll, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

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

        getScrollTop: () => {
          return containerRef.current ? containerRef.current.scrollTop : 0;
        },

        setScrollTop: (top: number) => {
          if (containerRef.current) {
            containerRef.current.scrollTop = top;
          }
        },
      }),
      [scrollToTarget]
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
        code: ({ className: codeClassName, children, ...props }) => {
          const [copied, setCopied] = useState(false);
          const match = /language-(\w+)/.exec(codeClassName || '');
          const language = match ? match[1] : '';
          const rawCode = String(children).replace(/\n$/, '');

          const handleCopy = useCallback(async () => {
            try {
              await navigator.clipboard.writeText(rawCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // ignore
            }
          }, [rawCode]);

          const isInline = !match && !String(children).includes('\n');

          if (isInline) {
            return (
              <code
                className="bg-slate-200/80 dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-mono text-xs px-1.5 py-0.5 rounded"
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <div className="relative group my-4 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0d1117]">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-slate-800 text-xs text-slate-400 font-mono select-none">
                <span className="text-[11px] uppercase tracking-wider">{language || 'text'}</span>
                <button
                  onClick={handleCopy}
                  title="复制代码"
                  className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-[11px]"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-3 overflow-x-auto text-[13px] font-mono leading-relaxed">
                <pre className="!bg-transparent !p-0 !m-0">
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            </div>
          );
        },
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
      [scrollToTarget]
    );

    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`h-full w-full overflow-y-auto px-6 py-6 select-text ${className || ''}`}
      >
        <div className="max-w-3xl mx-auto markdown-body">
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
