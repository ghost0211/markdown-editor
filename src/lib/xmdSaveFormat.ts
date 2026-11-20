import { documentStructureParser } from './documentStructure';
import { remarkCjkFriendlyEmphasis } from './remarkCjkFriendlyEmphasis';
import { transformXmdTypography } from './remarkXmdTypography';
import { scanXmdReferences } from './xmdPackage';
import { hasXmdPageBreak, readXmdDocumentTheme } from './xmdLayout';

const typographyParser = documentStructureParser().use(remarkCjkFriendlyEmphasis).freeze();

/** Detect features handled by XMD, after Markdown parsing excludes code and examples. */
export function documentRequiresXmd(content: string): boolean {
  if (readXmdDocumentTheme(content) || hasXmdPageBreak(content)) return true;
  if (content.includes('<xmd-style ') && transformXmdTypography(typographyParser.parse(content))) {
    return true;
  }
  // Ordinary local links and embedded images also belong in plain Markdown.
  // A non-image data link is the editor's representation of a bundled attachment.
  return /data:[^,\r\n]*;base64,/i.test(content) && scanXmdReferences(content).references.some(
    (reference) => !reference.image && /^data:[^,]*;base64,/i.test(reference.source),
  );
}
