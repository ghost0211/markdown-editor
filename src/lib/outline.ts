import GithubSlugger, { slug } from 'github-slugger';
import { HeadingItem } from '@/types';

/**
 * Strips markdown inline formatting (bold, italic, links, images, code, html tags, escaped characters)
 * to obtain the visible heading text as rendered by Markdown parsers.
 */
export function cleanHeadingText(text: string): string {
  if (!text) return '';
  return text
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove image syntax ![alt](url) -> ""
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove link syntax [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove inline code ticks `code` -> code
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic/strikethrough markers
    .replace(/[*_~`]/g, '')
    // Remove escaped backslashes (e.g. \* -> *)
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();
}

/**
 * Generate a slug from heading text following GitHub / rehype-slug rules.
 */
export function slugify(text: string): string {
  if (!text) return '';
  const stripped = text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '');
  const cleaned = cleanHeadingText(stripped);
  return slug(cleaned || stripped || text);
}

/**
 * Extracts H1-H6 headings from markdown text, ignoring code blocks.
 */
export function extractOutline(markdown: string): HeadingItem[] {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const lines = markdown.split(/\r?\n/);
  const headings: HeadingItem[] = [];
  const slugger = new GithubSlugger();

  let inCodeBlock = false;
  let codeBlockDelimiter = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check code fences
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const delimiter = fenceMatch[2].charAt(0);
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockDelimiter = delimiter;
      } else if (codeBlockDelimiter === delimiter) {
        inCodeBlock = false;
        codeBlockDelimiter = '';
      }
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Match ATX heading (# Heading)
    const atxMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      // Strip trailing # if any
      const rawText = atxMatch[2].replace(/\s+#+\s*$/, '').trim();
      const cleanText = cleanHeadingText(rawText);
      const visibleText = cleanText || rawText || `Heading ${level}`;
      const uniqueSlug = slugger.slug(cleanText || rawText);

      headings.push({
        id: `heading-${i + 1}-${uniqueSlug}`,
        level,
        text: visibleText,
        line: i + 1,
        slug: uniqueSlug,
      });
      continue;
    }

    // Match Setext heading (Line followed by === or ---)
    if (i + 1 < lines.length && trimmed.length > 0) {
      const nextLine = lines[i + 1].trim();
      const isH1 = /^={2,}\s*$/.test(nextLine);
      const isH2 = /^-{2,}\s*$/.test(nextLine);

      if (isH1 || isH2) {
        const level = isH1 ? 1 : 2;
        const cleanText = cleanHeadingText(trimmed);
        const visibleText = cleanText || trimmed;
        const uniqueSlug = slugger.slug(cleanText || trimmed);

        headings.push({
          id: `heading-${i + 1}-${uniqueSlug}`,
          level,
          text: visibleText,
          line: i + 1,
          slug: uniqueSlug,
        });

        // Skip next line since it was the setext underline
        i++;
      }
    }
  }

  return headings;
}
