# Markdown Editor 🚀

English | [简体中文](README.md)

A modern, elegant, and high-performance Windows desktop Markdown editor and reader.  
Built from the ground up on **Tauri 2 + React + TypeScript + CodeMirror 6**, delivering native startup speeds, minimal memory footprint, and a refined visual experience.

---

## ✨ Key Features & Highlights

1. **Refined Windows Desktop Layout**:
   - Top title and quick action bar (New, Open, Save, Save As, Export Word/PDF/HTML, View Switching, Theme Toggle, Preferences, Keyboard Shortcuts Help).
   - Smart left-hand Table of Contents (TOC) outline supporting H1-H6 heading hierarchy parsing and instant navigation.
   - Central multi-view workspace supporting three modes: **Editor Only**, **Split View**, and **Preview Only**.
   - Immersive bottom status bar: Real-time word count (smart detection of Chinese characters and English words), character count, line count, cursor position (Ln/Col), dirty save status, and estimated reading time.
   - Responsive design: Automatically collapses the sidebar on compact screens with instant shortcut toggle.

2. **Multi-Language Internationalization (Simplified Chinese & English)**:
   - **Comprehensive Bilingual Coverage**: Full support for both **Simplified Chinese (zh-CN, default)** and **English (en-US)** across title bars, tabs, toolbars, sidebar outlines, status bars, settings modals, shortcut guides, confirmation dialogs, toast notifications, code block copying, and export workflows.
   - **Lightweight Typed Architecture**: Custom type-safe TypeScript i18n architecture without bulky third-party dependencies, featuring parameter interpolation and safe fallback.
   - **Instant Hot-Switching**: Switch languages seamlessly in the Preferences modal without restarting the app or resetting active editor content/sessions.
   - **Versioned Defensive Migration**: Fully integrated with versioned localStorage settings (`markdown_editor_settings_v1`), automatically migrating missing or outdated options.

3. **Professional Markdown Editing Experience**:
   - Powered by **CodeMirror 6**, providing syntax highlighting, line numbers, word wrapping, bracket matching, and active line highlighting.
   - Toolbar formatting shortcuts: Bold, Italic, Strikethrough, Blockquote, Inline Code, Multi-Language Code Blocks, Unordered/Ordered/Task Lists, Links, Images, Tables, and Horizontal Rules.
   - Smart selection wrapping and cursor positioning.

4. **Native File System Capabilities**:
   - Powered by a Rust backend integrating `rfd` native file dialogs and `std::fs` for sub-millisecond file operations.
   - Strict UTF-8 validation and error handling.
   - **Unsaved Changes Protection**: Graceful confirmation dialogs when closing dirty tabs; snapshot-based save state preventing race conditions during typing.
   - **Universal Compatibility**: In pure browser preview environments, automatically falls back to standard browser file reading and Blob downloads without crashing.

5. **Professional Word (.docx), PDF (.pdf) & HTML (.html) Document Export**:
   - **Word (.docx) Export**: Built upon OOXML standards (`docx` + AST translation), transforming Markdown into formatted Word documents with Heading 1-6 styles (native Word navigation pane integration), A4 page geometry, standard margins, Microsoft YaHei typography, nested lists/task lists, GFM tables with dual DXA column widths, and styled blockquotes/code blocks.
   - **PDF (.pdf) Export**: Powered by system-native **Headless Microsoft Edge**, generating vector/text PDFs with A4 print styling, smart pagination break control (`break-inside: avoid` / `break-after: avoid`), syntax highlighting, and lossless font stacks.
   - **HTML (.html) Export**: Generates standalone single-page HTML with embedded CSS and syntax highlighting (no external stylesheet dependencies required), supporting responsive desktop/mobile viewports and A4 print styles.
   - **Strict Security & XSS Sanitization**:
     - HTML and PDF pipelines strictly utilize `rehype-sanitize` to eliminate XSS risks, stripping `<script>`, `<style>` injections, `<iframe>`, `<object>`, `<embed>`, `<form>`, and inline event handlers (e.g. `onerror`).
     - Absolute hyperlink protocols are strictly restricted to `http`, `https`, and `mailto`; absolute image protocols are restricted to `http` and `https`. Safe relative image references (e.g. `./assets/preview.png`) and in-page hash anchors (e.g. `#section`) are retained, while blocking dangerous protocols like `javascript:`, `file:`, and `data:`.
   - **UTF-8 Encoding & Meta Tags**: Exported HTML files include `<meta charset="utf-8">` and viewport meta declarations, dynamically adapting `<html lang="zh-CN">` or `<html lang="en-US">` according to current UI language.
   - **Hardened Local Base URL & Image References**: Automatically computes a valid, hardened `<base href="file:///...">` from local Markdown source paths, supporting Windows drive letters, Unicode/spaces, `#` and `?` characters, POSIX absolute paths, and UNC network shares. **Note: Images are referenced via relative/absolute URLs or online links, not embedded as binary bundled archive packages (Images are referenced, not embedded)**.
   - **Universal Compatibility & Graceful Fallbacks**:
     - Desktop environment automatically discovers Microsoft Edge installations across standard system paths (`Program Files (x86)`, `Program Files`, `LOCALAPPDATA`, `PATH`), utilizing isolated temp profiles and native file copy mechanisms supporting Chinese characters and spaces.
     - Web browser preview mode falls back seamlessly: Word and HTML download as standard Blobs (HTML using `text/html;charset=utf-8` MIME preserving Unicode content), while PDF opens the browser print preview.
     - Export operations are completely independent and **never alter** current open document paths, titles, saved content snapshots, or dirty states.

6. **Multi-Tab Workspace & Windows File Associations**:
   - Open, switch, and close multiple documents in tabs with dirty state indicators.
   - **Windows Native File Associations & Single-Instance Architecture**:
     - NSIS installer registers candidate associations for `.md`, `.markdown`, `.mdown`, `.mkd`, and `.txt` via `bundle.fileAssociations`.
     - Integrates `tauri-plugin-single-instance`: CLI arguments open files directly on cold start; opening files while running activates the existing window and opens the file in a new tab.
     - Supports Windows and POSIX `file://` URLs with percent-encoded characters and spaces.
     - Multi-channel wake-up coordinator handles window focus, page visibility, and polling recovery.
   - **Path Normalization & File Isolation**:
     - Case-insensitive Windows path normalization prevents duplicate tabs for the same physical file.
     - Independent UTF-8 validation ensures corrupt files fail gracefully without halting batch file opens.
   - Collision-free document IDs via `crypto.randomUUID`.

7. **Smart Table of Contents (TOC)**:
   - Real-time H1-H6 heading extraction, filtering out code block headings.
   - Live heading search and filter.
   - Two-way navigation: jumps to CodeMirror lines in Edit/Split modes and scrolls to preview anchors in Preview mode.

8. **GFM Rich-Text Rendering & Security Sandbox**:
   - Full GitHub Flavored Markdown support (tables, task lists, strikethrough, autolinks).
   - Code syntax highlighting (Rust, TypeScript, JavaScript, Python, CSS, HTML, JSON, etc.) with language tags and copy-to-clipboard buttons.
   - **XSS Sandbox**: Blocks dangerous raw HTML injections.
   - **Protocol Whitelist**: Restricts external links strictly to `http`, `https`, and `mailto`, opening safely in the default system browser.
   - **Strict CSP**: Built-in Content Security Policy blocking untrusted remote scripts.

9. **Light & Dark Theme Customization**:
   - Light, Dark, and System appearance modes adapting the entire UI and editor.
   - Persistent settings storage for theme, language, view mode, sidebar state, and open tab sessions.

10. **Comprehensive Preferences Modal (Settings)**:
   - **Quick Access**: Dedicated gear button in the TitleBar and global shortcut `Ctrl + ,`.
   - **Keyboard & Accessibility**: Full ARIA modal roles and keyboard accessibility (`Escape` to close).
   - **UI Language**: Instant toggle between Simplified Chinese and English without reload.
   - **Appearance Themes**: Seamless switching between Light, Dark, and System themes.
   - **Editor Customization**:
     - Font size adjustment (11px - 28px).
     - Line height ratio (1.2 - 2.4).
     - Tab indentation size (2 / 4 / 8 spaces).
     - Word wrapping and line number toggles.
   - **Startup & Session Preferences**:
     - Restore session on startup toggle.
     - Default startup view mode (Remember Last View, Split View, Edit Only, Preview Only).
   - **System File Associations**:
     - Lists supported extensions (`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`).
     - One-click launcher for Windows Default Apps settings (`ms-settings:defaultapps`).
   - **Reset to Defaults**: One-click restore to factory defaults.

---

## 🛠️ Technology Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Desktop Framework** | Tauri 2.x + Rust 2021 | Cross-platform lightweight desktop runtime |
| **Native Integrations** | `tauri-plugin-single-instance`, `rfd`, `opener`, `tempfile`, `std::fs` | Single instance IPC, native dialogs, system handlers, temp directories, safe file I/O |
| **Internationalization (i18n)** | Custom Typed Dictionary & Context (`src/i18n`) | Lightweight type-safe i18n supporting zh-CN & en-US hot switching |
| **Word (.docx) Export** | `docx`, `unified`, `remark-parse`, `remark-gfm` | Direct OOXML binary generation with headings, tables, and lists |
| **PDF (.pdf) Export** | Headless Microsoft Edge, `remark-rehype`, `rehype-sanitize` | Vector A4 printing with XSS sanitization and lossless font stacks |
| **HTML (.html) Export** | `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-highlight`, `rehype-sanitize`, `rehype-stringify` | Standalone single-page HTML with embedded CSS, responsive styling, syntax highlighting, and XSS sanitization |
| **Frontend Framework** | React 18 + TypeScript + Vite | Modern UI components with fast hot module replacement |
| **Editor Core** | CodeMirror 6 (`@uiw/react-codemirror`) | Modular code editor with Markdown highlighting and custom themes |
| **Markdown Rendering** | `react-markdown`, `remark-gfm`, `rehype-slug`, `rehype-highlight` | GFM AST parsing, anchor generation, and syntax highlighting |
| **Icons & Styling** | `lucide-react`, Tailwind CSS | Polished Windows desktop interface without emoji icons |
| **Testing Framework** | Vitest | Unit and acceptance testing for algorithms, security, and UI components |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description | Scope |
| :--- | :--- | :---: |
| `Ctrl + N` | New blank document tab | Global |
| `Ctrl + O` | Open local Markdown/text file (`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`) | Global |
| `Ctrl + S` | Save current document | Global |
| `Ctrl + Shift + S` | Save current document As... | Global |
| `Ctrl + W` | Close current tab (confirms if unsaved) | Global |
| `Ctrl + 1` | Switch to **Editor Only** view | Global |
| `Ctrl + 2` | Switch to **Split View** | Global |
| `Ctrl + 3` | Switch to **Preview Only** view | Global |
| `Ctrl + Shift + O` | Expand / Collapse outline sidebar | Global |
| `Ctrl + ,` | Open Preferences modal | Global |
| `F1` or `Ctrl + /` | Open Keyboard Shortcuts help | Global |
| `Ctrl + B` | Format selection as Bold | Editor |
| `Ctrl + I` | Format selection as Italic | Editor |
| `Ctrl + Z / Y` | Undo / Redo | Editor |

---

## 🚀 Development & Build

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (LTS 18+ recommended)
- [Rust & Cargo](https://www.rust-lang.org/) (1.75+ recommended)
- Windows C++ Build Tools (Visual Studio Build Tools) and WebView2 runtime.
- Microsoft Edge browser for headless PDF export (included by default on Windows 10/11).

### 2. Install Dependencies
```bash
npm install
```

### 3. Local Development

#### Mode A: Web Browser Development Mode (with download fallbacks)
```bash
npm run dev
```
Navigate to `http://localhost:5173`.

#### Mode B: Tauri Desktop Application Mode
```bash
npm run tauri dev
```
Compiles the Rust backend and opens the native desktop window.

---

## 📦 Windows Desktop Packaging & Installer

### 1. Build Desktop Release
Builds standalone Windows executables (`.exe`) and NSIS installer packages (`.exe` / `.msi`):

```bash
# 1. Verify frontend and backend builds
npm run build
cd src-tauri && cargo check && cd ..

# 2. Package release bundle
npm run tauri build
```

The output installer is generated under:
`src-tauri/target/release/bundle/nsis/`

### 2. Windows File Association & Default App Notes
- **Registration**: NSIS installer automatically registers MarkdownEditor as a candidate handler for `.md`, `.markdown`, `.mdown`, `.mkd`, and `.txt`.
- **System Constraints**: On Windows 10/11, OS security policies (User Choice Hash) prevent third-party installers from forcibly overriding default apps without user action.
- **Setting as Default**: Right click any Markdown file -> "Open with" -> "Choose another app" -> check "Always use this app", or navigate to Windows Settings -> Apps -> Default apps.

---

## 🧪 Testing

Comprehensive Vitest and Cargo test suites cover i18n dictionaries, settings persistence/migration, document utilities, OOXML Word generation, PDF printing, standalone HTML generation with hardened base URLs, external link security, outline extraction, and statistics:

```bash
# Run frontend test suite
npm test -- --run

# Run backend Rust test suite
cd src-tauri && cargo test && cd ..
```

---

## 📁 Project Structure

```
markdown-editor/
├── src-tauri/                # Tauri 2 Rust native backend
│   ├── Cargo.toml            # Rust dependencies (tauri, rfd, opener, tempfile, serde)
│   ├── build.rs              # Tauri build script
│   ├── tauri.conf.json       # Tauri window, CSP, and bundle config
│   ├── icons/                # Desktop application icons
│   └── src/
│       ├── lib.rs            # Rust commands (read/write/dialogs/export_pdf/opener)
│       └── main.rs           # Windows process entry point
├── src/                      # Frontend React + TypeScript source
│   ├── components/           # UI Components
│   │   ├── TitleBar.tsx      # Top title bar, Save As, and Export dropdown menu
│   │   ├── TabBar.tsx        # Multi-tab workspace manager
│   │   ├── Toolbar.tsx       # Markdown formatting quick toolbar
│   │   ├── Sidebar.tsx       # Table of contents (TOC) & search
│   │   ├── Editor.tsx        # CodeMirror 6 editor integration
│   │   ├── Preview.tsx       # GFM Markdown preview & code copy
│   │   ├── StatusBar.tsx     # Statistics & cursor position bar
│   │   ├── ConfirmModal.tsx  # Unsaved changes confirmation dialog
│   │   ├── ShortcutsModal.tsx# Keyboard shortcuts reference modal
│   │   ├── SettingsModal.tsx # Preferences modal
│   │   └── ToastContainer.tsx# Toast notification overlay
│   ├── hooks/                # React Hooks
│   │   ├── useSettings.ts    # Preferences state management
│   │   ├── useTheme.ts       # Appearance theme management
│   │   ├── useDocuments.ts   # Document tabs and file I/O state
│   │   ├── useExportDocument.ts # Word / PDF / HTML export interaction & state
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcut handler
│   │   └── useToast.ts       # Notification management
│   ├── i18n/                 # Internationalization
│   │   ├── types.ts          # i18n type definitions
│   │   ├── index.tsx         # I18nProvider, translation helpers, and interpolation
│   │   └── locales/          # Language dictionary packages
│   │       ├── zh-CN.ts      # Simplified Chinese
│   │       └── en-US.ts      # English
│   ├── lib/                  # Business logic & utilities
│   │   ├── settings.ts       # Settings schema, validation, and versioned persistence
│   │   ├── export/           # Document export modules
│   │   │   ├── docxExporter.ts # Markdown to OOXML .docx algorithm
│   │   │   ├── pdfExporter.ts  # Markdown to printable HTML & PDF export
│   │   │   └── htmlExporter.ts # Markdown to standalone HTML generator
│   │   ├── native.ts         # Tauri IPC wrappers, URL security, and Web fallbacks
│   │   ├── documentUtils.ts  # Document IDs, path normalization, and snapshots
│   │   ├── outline.ts        # Markdown TOC heading extraction algorithm
│   │   ├── stats.ts          # Word count, character count, and reading time
│   │   ├── markdownCommands.ts# Markdown syntax wrapping & selection handling
│   │   ├── fileCoordinator.ts # File opening & single instance wake-up coordinator
│   │   └── defaultDocument.ts# Welcome document template (zh-CN & en-US)
│   ├── styles/               # Styles
│   │   ├── index.css         # Global styles and custom scrollbars
│   │   └── markdown.css      # Markdown typography and dark theme styling
│   ├── types/                # TypeScript type definitions
│   ├── App.tsx               # Root application component
│   └── main.tsx              # React DOM entry point
├── tests/                    # Vitest unit tests
│   ├── i18n.test.tsx         # i18n dictionary completeness & component rendering
│   ├── settings.test.ts      # Settings validation & persistence tests
│   ├── settingsUI.test.tsx   # Settings UI and accessibility tests
│   ├── sessionRestore.test.ts# Startup view and session restoration tests
│   ├── export.test.ts        # Word / PDF / HTML export algorithms & security tests
│   ├── documentUtils.test.ts # Path normalization, ID generation, and filename tests
│   ├── native.test.ts        # External URL & native export wrapper tests
│   ├── outline.test.ts       # Outline extraction tests
│   ├── stats.test.ts         # Word count statistics tests
│   └── markdownCommands.test.ts # Text formatting command tests
├── package.json              # Frontend package configuration
├── tsconfig.json             # TypeScript configuration
├── vite.config.ts            # Vite configuration
└── vitest.config.ts          # Vitest configuration
```
