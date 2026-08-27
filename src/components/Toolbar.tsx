import React from 'react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  FileCode,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Link2,
  Image as ImageIcon,
  Table as TableIcon,
  Minus,
} from 'lucide-react';
import { MarkdownAction } from '@/lib/markdownCommands';

interface ToolbarProps {
  onAction: (action: MarkdownAction) => void;
  disabled?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onAction, disabled = false }) => {
  const btnClass =
    'p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div className="h-9 bg-slate-50 dark:bg-[#111927] border-b border-slate-200 dark:border-slate-800 px-3 flex items-center space-x-1 select-none overflow-x-auto no-scrollbar shrink-0 text-xs">
      {/* Headings */}
      <div className="flex items-center space-x-0.5">
        <button
          onClick={() => onAction('h1')}
          disabled={disabled}
          title="一级标题 (# )"
          className={btnClass}
        >
          <Heading1 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('h2')}
          disabled={disabled}
          title="二级标题 (## )"
          className={btnClass}
        >
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('h3')}
          disabled={disabled}
          title="三级标题 (### )"
          className={btnClass}
        >
          <Heading3 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Inline styles */}
      <div className="flex items-center space-x-0.5">
        <button
          onClick={() => onAction('bold')}
          disabled={disabled}
          title="粗体 (**文本**)"
          className={btnClass}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('italic')}
          disabled={disabled}
          title="斜体 (*文本*)"
          className={btnClass}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('strike')}
          disabled={disabled}
          title="删除线 (~~文本~~)"
          className={btnClass}
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('quote')}
          disabled={disabled}
          title="引用块 (> 文本)"
          className={btnClass}
        >
          <Quote className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Code */}
      <div className="flex items-center space-x-0.5">
        <button
          onClick={() => onAction('inline-code')}
          disabled={disabled}
          title="行内代码 (`code`)"
          className={btnClass}
        >
          <Code className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('code-block')}
          disabled={disabled}
          title="多行代码块 (```lang ... ```)"
          className={btnClass}
        >
          <FileCode className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Lists */}
      <div className="flex items-center space-x-0.5">
        <button
          onClick={() => onAction('ul')}
          disabled={disabled}
          title="无序列表 (- 列表项)"
          className={btnClass}
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('ol')}
          disabled={disabled}
          title="有序列表 (1. 列表项)"
          className={btnClass}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('task')}
          disabled={disabled}
          title="任务清单 (- [ ] 任务)"
          className={btnClass}
        >
          <ListTodo className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Links, Media & Structure */}
      <div className="flex items-center space-x-0.5">
        <button
          onClick={() => onAction('link')}
          disabled={disabled}
          title="插入链接 ([标题](url))"
          className={btnClass}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('image')}
          disabled={disabled}
          title="插入图片 (![描述](url))"
          className={btnClass}
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('table')}
          disabled={disabled}
          title="插入表格"
          className={btnClass}
        >
          <TableIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAction('hr')}
          disabled={disabled}
          title="插入分割线 (---)"
          className={btnClass}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
