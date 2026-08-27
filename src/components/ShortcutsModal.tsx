import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: '文件操作',
    items: [
      { key: 'Ctrl + N', desc: '新建空白文档标签' },
      { key: 'Ctrl + O', desc: '打开本地 Markdown/文本文件' },
      { key: 'Ctrl + S', desc: '保存当前文件' },
      { key: 'Ctrl + Shift + S', desc: '另存为新文件' },
      { key: 'Ctrl + W', desc: '关闭当前活动标签页' },
    ],
  },
  {
    title: '视图与窗口',
    items: [
      { key: 'Ctrl + 1', desc: '切换到 纯编辑模式' },
      { key: 'Ctrl + 2', desc: '切换到 双栏分屏模式' },
      { key: 'Ctrl + 3', desc: '切换到 纯阅读模式' },
      { key: 'Ctrl + Shift + O', desc: '展开 / 收起左侧大纲' },
      { key: 'Ctrl + ,', desc: '打开偏好设置' },
      { key: 'F1 或 Ctrl + /', desc: '打开快捷键帮助指南' },
    ],
  },
  {
    title: '格式与编辑',
    items: [
      { key: 'Ctrl + B', desc: '粗体 (**文本**)' },
      { key: 'Ctrl + I', desc: '斜体 (*文本*)' },
      { key: 'Ctrl + Z / Y', desc: '撤销 / 重做' },
      { key: 'Ctrl + F', desc: '在文档中查找' },
      { key: 'Ctrl + H', desc: '在文档中替换' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-white dark:bg-[#182234] rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-800 dark:text-slate-100 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-2 font-medium text-sm">
            <Keyboard className="w-4 h-4 text-blue-500" />
            <span>键盘快捷键一览</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h4 className="font-semibold text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
                {group.title}
              </h4>
              <div className="bg-slate-50 dark:bg-[#111927] rounded-lg p-2 border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-200/60 dark:divide-slate-800">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-1.5 px-2"
                  >
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                      {item.desc}
                    </span>
                    <kbd className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded shadow-xs">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 bg-slate-50 dark:bg-[#131b2a] border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
};
