import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options } from 'rehype-sanitize';
import type { PluggableList } from 'unified';
import { XMD_TYPOGRAPHY_PROPERTIES } from '@/lib/remarkXmdTypography';
import { XMD_PAGE_BREAK_CLASS } from '@/lib/xmdLayout';

const schema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': (defaultSchema.attributes?.['*'] ?? []).filter(
      (attr) => !['accessKey', 'id', 'name', 'tabIndex'].includes(String(attr))
    ),
    a: [...(defaultSchema.attributes?.a ?? []), ['id', /^user-content-fnref-/]],
    h2: [...(defaultSchema.attributes?.h2 ?? []), ['id', 'footnote-label']],
    li: [...(defaultSchema.attributes?.li ?? []), ['id', /^user-content-fn-/]],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      ['className', /^md-callout(?:-(?:note|tip|important|warning|caution))?$/],
      ['dataCallout', /^(?:note|tip|important|warning|caution)$/],
    ],
    p: [['className', 'md-callout-title']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', XMD_PAGE_BREAK_CLASS]],
    span: [...(defaultSchema.attributes?.span ?? []), ...XMD_TYPOGRAPHY_PROPERTIES],
    source: [],
  },
  // Keep the IDs and references that remark generates for GFM footnotes.
  clobberPrefix: '',
  // React Markdown applies documentUrlTransform to href and src, including
  // local Markdown destinations and bundled images/attachments.
  protocols: { cite: ['http', 'https'], longDesc: ['http', 'https'] },
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'template'],
};

export const previewHtmlPlugins: PluggableList = [
  [rehypeRaw, { tagfilter: true }],
  [rehypeSanitize, schema],
];
