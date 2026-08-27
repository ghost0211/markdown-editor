import { Language } from '@/i18n';

export const WELCOME_DOCUMENT_ZH = `# 欢迎使用 Markdown Editor 🚀

一款精致、现代、高性能的 Windows 桌面级 Markdown 编辑与阅读器。基于 **Tauri 2 + React + TypeScript + CodeMirror 6** 构建。

---

## 📑 核心功能特性

- ⚡ **原生级体验**：Rust 底层驱动，秒级启动，极低内存占用。
- 📝 **专业编辑**：基于 CodeMirror 6，支持 Markdown 语法高亮、行号、自动换行与光标定位。
- 📑 **多标签页**：支持同时打开和管理多个文档，未保存脏状态实时提醒。
- 🌲 **智能大纲**：实时从 Markdown 提取 H1-H6 目录树，点击即可瞬间定位行与锚点。
- 🌓 **深色/浅色模式**：支持浅色、深色以及跟随系统主题，全界面深度适配。
- 📊 **三视图模式**：提供「纯编辑模式」、「双栏分屏预览」与「纯享阅读模式」。
- 🧮 **实时字数统计**：精准识别中文字符与英文单词，实时统计字符数、行数与预估阅读时间。

---

## 💻 代码高亮展示

### Rust 高性能文件读取示例

\`\`\`rust
use std::fs;
use std::path::Path;

pub fn read_text_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}
\`\`\`

### TypeScript / React Hook 示例

\`\`\`typescript
import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  useEffect(() => {
    const isDark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  }, [theme]);

  return { theme, setTheme };
}
\`\`\`

---

## 📊 GFM 表格支持

| 快捷键 | 功能描述 | 适用视图 |
| :--- | :--- | :---: |
| \`Ctrl + N\` | 新建空白文档标签 | 全局 |
| \`Ctrl + O\` | 打开本地 Markdown 文档 | 全局 |
| \`Ctrl + S\` | 快速保存当前文档 | 全局 |
| \`Ctrl + Shift + S\` | 另存为新文件 | 全局 |
| \`Ctrl + W\` | 关闭当前文档标签 | 全局 |
| \`Ctrl + 1 / 2 / 3\` | 切换 编辑 / 分屏 / 阅读 视图 | 全局 |
| \`Ctrl + Shift + O\` | 展开 / 收起文档大纲侧栏 | 全局 |

---

## ✅ GFM 待办任务清单

- [x] 完成 Tauri 2 与 React 基础骨架搭建
- [x] 集成 CodeMirror 6 语法高亮与行号显示
- [x] 实现 H1-H6 智能文档大纲与双向锚点跳转
- [x] 支持中英文精准统计与底部状态栏
- [x] 支持导出 Word (.docx)、PDF (.pdf) 与 HTML (.html) 格式

---

## 💬 引用与提示块

> **💡 编写小贴士**
> 您可以直接使用顶部工具栏的快捷按钮插入粗体、斜体、列表、表格和代码块，也可以使用快捷键快速操作。
> 尝试在左侧点击大纲目录，即可快速定位到对应的章节位置！

---

## 🔗 外部链接测试

您可以点击访问安全链接：[Markdown Guide 中文文档](https://www.markdownguide.org) 或 [Tauri 官方主页](https://tauri.app)。外部链接会在系统默认浏览器中安全打开。

*祝您编写愉快！*
`;

export const WELCOME_DOCUMENT_EN = `# Welcome to Markdown Editor 🚀

A modern, elegant, and high-performance Windows desktop Markdown editor and reader built with **Tauri 2 + React + TypeScript + CodeMirror 6**.

---

## 📑 Key Features

- ⚡ **Native Performance**: Powered by a Rust backend for instant startup and minimal memory footprint.
- 📝 **Professional Editing**: Built on CodeMirror 6 with syntax highlighting, line numbers, word wrap, and cursor tracking.
- 📑 **Multi-Tab Workspace**: Open and manage multiple documents simultaneously with real-time dirty status indicators.
- 🌲 **Smart Outline**: Automatically extracts H1-H6 headings with two-way anchor navigation.
- 🌓 **Dark & Light Themes**: Full support for Light, Dark, and System appearance themes.
- 📊 **Three View Modes**: Seamlessly switch between Editor Only, Split View, and Preview Only modes.
- 🧮 **Accurate Statistics**: Precise character, word, and line count with estimated reading time.

---

## 💻 Code Highlighting Example

### Rust Fast File Reader

\`\`\`rust
use std::fs;
use std::path::Path;

pub fn read_text_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("Failed to read: {}", e))
}
\`\`\`

### TypeScript / React Hook Example

\`\`\`typescript
import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  useEffect(() => {
    const isDark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  }, [theme]);

  return { theme, setTheme };
}
\`\`\`

---

## 📊 GFM Table Support

| Shortcut | Description | Scope |
| :--- | :--- | :---: |
| \`Ctrl + N\` | New blank document tab | Global |
| \`Ctrl + O\` | Open local Markdown file | Global |
| \`Ctrl + S\` | Save current document | Global |
| \`Ctrl + Shift + S\` | Save As new file | Global |
| \`Ctrl + W\` | Close current document tab | Global |
| \`Ctrl + 1 / 2 / 3\` | Switch Edit / Split / Preview View | Global |
| \`Ctrl + Shift + O\` | Toggle Outline sidebar | Global |

---

## ✅ GFM Task List

- [x] Complete Tauri 2 and React architecture setup
- [x] Integrate CodeMirror 6 syntax highlighting and line numbers
- [x] Implement H1-H6 document outline with anchor navigation
- [x] Multi-language support (English & Chinese)
- [x] Export to Word (.docx), PDF (.pdf), and HTML (.html) formats

---

## 💬 Blockquote & Tips

> **💡 Writing Tip**
> You can use the top toolbar buttons to quickly insert bold, italic, lists, tables, and code blocks, or use keyboard shortcuts for rapid editing.
> Click headings in the left outline to instantly jump to sections!

---

## 🔗 External Links

Visit [Markdown Guide](https://www.markdownguide.org) or [Tauri Official Website](https://tauri.app). Links open safely in your system default browser.

*Happy writing!*
`;

export const WELCOME_DOCUMENT = WELCOME_DOCUMENT_ZH;

/**
 * Returns localized welcome document title and content for fresh startup sessions.
 */
export function getWelcomeDocument(language: Language): { title: string; content: string } {
  if (language === 'en-US') {
    return {
      title: 'Welcome.md',
      content: WELCOME_DOCUMENT_EN,
    };
  }
  return {
    title: '欢迎使用.md',
    content: WELCOME_DOCUMENT_ZH,
  };
}
