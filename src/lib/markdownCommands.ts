import { EditorView } from '@codemirror/view';
import { Language, TranslationKey } from '@/i18n';

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'code-block'
  | 'quote'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'ul'
  | 'ol'
  | 'task'
  | 'link'
  | 'image'
  | 'table'
  | 'hr';

export interface FormatResult {
  newText: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface MarkdownPlaceholders {
  codeSnippet: string;
  quoteText: string;
  heading: string;
  listItem: string;
  orderedItem: string;
  taskItem: string;
  linkText: string;
  imageAlt: string;
  tableCol1: string;
  tableCol2: string;
  tableCol3: string;
  tableCell1: string;
  tableCell2: string;
  tableCell3: string;
  tableCell4: string;
  tableCell5: string;
  tableCell6: string;
}

export const DEFAULT_ZH_PLACEHOLDERS: MarkdownPlaceholders = {
  codeSnippet: '代码片段',
  quoteText: '引用文本',
  heading: '标题内容',
  listItem: '列表项',
  orderedItem: '有序列表项',
  taskItem: '待办任务',
  linkText: '链接文本',
  imageAlt: '图片描述',
  tableCol1: '列 1',
  tableCol2: '列 2',
  tableCol3: '列 3',
  tableCell1: '单元格 1',
  tableCell2: '单元格 2',
  tableCell3: '单元格 3',
  tableCell4: '单元格 4',
  tableCell5: '单元格 5',
  tableCell6: '单元格 6',
};

export const DEFAULT_EN_PLACEHOLDERS: MarkdownPlaceholders = {
  codeSnippet: 'Code Snippet',
  quoteText: 'Quote text',
  heading: 'Heading',
  listItem: 'List item',
  orderedItem: 'Ordered item',
  taskItem: 'Task item',
  linkText: 'Link text',
  imageAlt: 'Image description',
  tableCol1: 'Column 1',
  tableCol2: 'Column 2',
  tableCol3: 'Column 3',
  tableCell1: 'Cell 1',
  tableCell2: 'Cell 2',
  tableCell3: 'Cell 3',
  tableCell4: 'Cell 4',
  tableCell5: 'Cell 5',
  tableCell6: 'Cell 6',
};

export type MarkdownTranslator = (key: TranslationKey) => string;

export type MarkdownLocaleInput =
  | Language
  | MarkdownTranslator
  | Partial<MarkdownPlaceholders>
  | { t?: MarkdownTranslator; language?: Language };

/**
 * Resolves Markdown placeholder strings from locale, translator function, or explicit overrides.
 */
export function resolveMarkdownPlaceholders(
  localeInput?: MarkdownLocaleInput
): MarkdownPlaceholders {
  if (!localeInput) {
    return DEFAULT_ZH_PLACEHOLDERS;
  }
  if (typeof localeInput === 'string') {
    return localeInput === 'en-US' ? DEFAULT_EN_PLACEHOLDERS : DEFAULT_ZH_PLACEHOLDERS;
  }
  if (typeof localeInput === 'function') {
    const t = localeInput;
    return {
      codeSnippet: t('markdown.codeSnippet'),
      quoteText: t('markdown.quoteText'),
      heading: t('markdown.heading'),
      listItem: t('markdown.listItem'),
      orderedItem: t('markdown.orderedItem'),
      taskItem: t('markdown.taskItem'),
      linkText: t('markdown.linkText'),
      imageAlt: t('markdown.imageAlt'),
      tableCol1: t('markdown.tableCol1'),
      tableCol2: t('markdown.tableCol2'),
      tableCol3: t('markdown.tableCol3'),
      tableCell1: t('markdown.tableCell1'),
      tableCell2: t('markdown.tableCell2'),
      tableCell3: t('markdown.tableCell3'),
      tableCell4: t('markdown.tableCell4'),
      tableCell5: t('markdown.tableCell5'),
      tableCell6: t('markdown.tableCell6'),
    };
  }
  if (typeof localeInput === 'object') {
    if ('t' in localeInput && typeof localeInput.t === 'function') {
      const t = localeInput.t;
      return {
        codeSnippet: t('markdown.codeSnippet'),
        quoteText: t('markdown.quoteText'),
        heading: t('markdown.heading'),
        listItem: t('markdown.listItem'),
        orderedItem: t('markdown.orderedItem'),
        taskItem: t('markdown.taskItem'),
        linkText: t('markdown.linkText'),
        imageAlt: t('markdown.imageAlt'),
        tableCol1: t('markdown.tableCol1'),
        tableCol2: t('markdown.tableCol2'),
        tableCol3: t('markdown.tableCol3'),
        tableCell1: t('markdown.tableCell1'),
        tableCell2: t('markdown.tableCell2'),
        tableCell3: t('markdown.tableCell3'),
        tableCell4: t('markdown.tableCell4'),
        tableCell5: t('markdown.tableCell5'),
        tableCell6: t('markdown.tableCell6'),
      };
    }
    if ('language' in localeInput && typeof localeInput.language === 'string') {
      return localeInput.language === 'en-US' ? DEFAULT_EN_PLACEHOLDERS : DEFAULT_ZH_PLACEHOLDERS;
    }
    return {
      ...DEFAULT_ZH_PLACEHOLDERS,
      ...(localeInput as Partial<MarkdownPlaceholders>),
    };
  }
  return DEFAULT_ZH_PLACEHOLDERS;
}

/**
 * Pure string transformation for markdown formatting actions.
 * Localizes placeholders for empty selections while preserving explicitly selected user text without alteration.
 */
export function formatMarkdownString(
  fullText: string,
  start: number,
  end: number,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): FormatResult {
  const placeholders = resolveMarkdownPlaceholders(localeInput);
  const before = fullText.slice(0, start);
  const selected = fullText.slice(start, end);
  const after = fullText.slice(end);

  switch (action) {
    case 'bold': {
      if (!selected) {
        return {
          newText: `${before}****${after}`,
          selectionStart: start + 2,
          selectionEnd: start + 2,
        };
      }
      return {
        newText: `${before}**${selected}**${after}`,
        selectionStart: start + 2,
        selectionEnd: end + 2,
      };
    }

    case 'italic': {
      if (!selected) {
        return {
          newText: `${before}**${after}`,
          selectionStart: start + 1,
          selectionEnd: start + 1,
        };
      }
      return {
        newText: `${before}*${selected}*${after}`,
        selectionStart: start + 1,
        selectionEnd: end + 1,
      };
    }

    case 'strike': {
      if (!selected) {
        return {
          newText: `${before}~~~~${after}`,
          selectionStart: start + 2,
          selectionEnd: start + 2,
        };
      }
      return {
        newText: `${before}~~${selected}~~${after}`,
        selectionStart: start + 2,
        selectionEnd: end + 2,
      };
    }

    case 'inline-code': {
      if (!selected) {
        return {
          newText: `${before}\`\`${after}`,
          selectionStart: start + 1,
          selectionEnd: start + 1,
        };
      }
      return {
        newText: `${before}\`${selected}\`${after}`,
        selectionStart: start + 1,
        selectionEnd: end + 1,
      };
    }

    case 'code-block': {
      const code = selected || placeholders.codeSnippet;
      const insert = `\`\`\`javascript\n${code}\n\`\`\`\n`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + 3,
        selectionEnd: start + 13, // highlight "javascript" language tag for quick edit
      };
    }

    case 'quote': {
      const content = selected || placeholders.quoteText;
      const quoted = content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return {
        newText: `${before}${quoted}${after}`,
        selectionStart: start + 2,
        selectionEnd: start + quoted.length,
      };
    }

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4': {
      const levelMap: Record<string, string> = {
        h1: '# ',
        h2: '## ',
        h3: '### ',
        h4: '#### ',
      };
      const prefix = levelMap[action];
      const headingText = selected || placeholders.heading;
      return {
        newText: `${before}${prefix}${headingText}${after}`,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + headingText.length,
      };
    }

    case 'ul': {
      const content = selected || placeholders.listItem;
      const formatted = content
        .split('\n')
        .map((line) => `- ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 2,
        selectionEnd: start + formatted.length,
      };
    }

    case 'ol': {
      const content = selected || placeholders.orderedItem;
      const formatted = content
        .split('\n')
        .map((line, idx) => `${idx + 1}. ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 3,
        selectionEnd: start + formatted.length,
      };
    }

    case 'task': {
      const content = selected || placeholders.taskItem;
      const formatted = content
        .split('\n')
        .map((line) => `- [ ] ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 6,
        selectionEnd: start + formatted.length,
      };
    }

    case 'link': {
      const text = selected || placeholders.linkText;
      const insert = `[${text}](https://example.com)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + text.length + 3,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'image': {
      const alt = selected || placeholders.imageAlt;
      const insert = `![${alt}](https://example.com/image.png)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + alt.length + 4,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'table': {
      const c1 = placeholders.tableCol1;
      const c2 = placeholders.tableCol2;
      const c3 = placeholders.tableCol3;
      const r1 = placeholders.tableCell1;
      const r2 = placeholders.tableCell2;
      const r3 = placeholders.tableCell3;
      const r4 = placeholders.tableCell4;
      const r5 = placeholders.tableCell5;
      const r6 = placeholders.tableCell6;
      const table = `\n| ${c1} | ${c2} | ${c3} |\n| :--- | :---: | ---: |\n| ${r1} | ${r2} | ${r3} |\n| ${r4} | ${r5} | ${r6} |\n`;
      return {
        newText: `${before}${table}${after}`,
        selectionStart: start + table.length,
        selectionEnd: start + table.length,
      };
    }

    case 'hr': {
      const hr = '\n\n---\n\n';
      return {
        newText: `${before}${hr}${after}`,
        selectionStart: start + hr.length,
        selectionEnd: start + hr.length,
      };
    }

    default:
      return {
        newText: fullText,
        selectionStart: start,
        selectionEnd: end,
      };
  }
}

/**
 * Executes a formatting action directly on a CodeMirror 6 EditorView instance.
 */
export function executeCodeMirrorAction(
  view: EditorView,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): void {
  const state = view.state;
  const mainSelection = state.selection.main;
  const from = mainSelection.from;
  const to = mainSelection.to;
  const fullText = state.doc.toString();

  const res = formatMarkdownString(fullText, from, to, action, localeInput);

  view.dispatch({
    changes: {
      from: 0,
      to: fullText.length,
      insert: res.newText,
    },
    selection: {
      anchor: res.selectionStart,
      head: res.selectionEnd,
    },
    scrollIntoView: true,
  });

  view.focus();
}
