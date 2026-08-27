import { EditorView } from '@codemirror/view';

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

/**
 * Pure string transformation for markdown formatting actions
 */
export function formatMarkdownString(
  fullText: string,
  start: number,
  end: number,
  action: MarkdownAction
): FormatResult {
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
      const code = selected || '代码片段';
      const insert = `\`\`\`javascript\n${code}\n\`\`\`\n`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + 3,
        selectionEnd: start + 13, // highlight "javascript" language tag for quick edit
      };
    }

    case 'quote': {
      const content = selected || '引用文本';
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
      const headingText = selected || '标题内容';
      return {
        newText: `${before}${prefix}${headingText}${after}`,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + headingText.length,
      };
    }

    case 'ul': {
      const content = selected || '列表项';
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
      const content = selected || '有序列表项';
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
      const content = selected || '待办任务';
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
      const text = selected || '链接文本';
      const insert = `[${text}](https://example.com)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + text.length + 3,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'image': {
      const alt = selected || '图片描述';
      const insert = `![${alt}](https://example.com/image.png)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + alt.length + 4,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'table': {
      const table = `\n| 列 1 | 列 2 | 列 3 |\n| :--- | :---: | ---: |\n| 单元格 1 | 单元格 2 | 单元格 3 |\n| 单元格 4 | 单元格 5 | 单元格 6 |\n`;
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
export function executeCodeMirrorAction(view: EditorView, action: MarkdownAction): void {
  const state = view.state;
  const mainSelection = state.selection.main;
  const from = mainSelection.from;
  const to = mainSelection.to;
  const fullText = state.doc.toString();

  const res = formatMarkdownString(fullText, from, to, action);

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
