# Markdown Editor 🚀

[English](README_EN.md) | 简体中文

一款现代、精致、高性能的 Windows 桌面级 Markdown 编辑与阅读器。  
基于 **Tauri 2 + React + TypeScript + CodeMirror 6** 技术栈从零构建，具备原生级启动速度、极小内存占用与优雅的视觉体验。

---

## ✨ 核心功能与亮点

1. **精美 Windows 桌面布局**：
   - 顶部标题与快速操作栏（新建/打开/保存/另存为/导出 Word、PDF 与 HTML/视图切换/主题切换/偏好设置/快捷键帮助）。
   - 左侧智能文档大纲（TOC），支持 H1-H6 目录树解析与快速跳转。
   - 中央工作区，支持三种视图切换：**纯编辑模式**、**双栏分屏模式**、**纯阅读模式**。
   - 底部沉浸式状态栏：实时显示字数（中文字符与英文单词智能统计）、字符数、行数、光标行列（Ln/Col）、保存状态及预估阅读时间。
   - 响应式设计：小屏幕或窄窗口自动收起侧边栏，支持快捷键随时唤出。

2. **多语言国际化支持（Simplified Chinese & English）**：
   - **双语完整覆盖**：提供完整的 **简体中文（zh-CN，默认）** 与 **English (en-US)** 界面语言支持，涵盖标题栏、标签页、工具栏、侧边大纲、状态栏、偏好设置、快捷键指南、确认对话框、消息通知（Toast）以及代码复制与导出交互。
   - **轻量类型化架构**：内置轻量级纯 TypeScript 类型安全 i18n 架构，无需引入庞大第三方国际化依赖；支持参数插值与缺失键中文安全回退。
   - **免重启即时切换**：可在「偏好设置」面板中随时自由切换语言，界面即时热更新，且完全不会重置当前编辑器内容或打开的会话标签。
   - **版本化防御兼容**：语言偏好与版本化设置（`markdown_editor_settings_v1`）无缝集成，自动防御性迁移缺失或旧版配置，重置设置时自动恢复为默认简体中文。

3. **专业级 Markdown 编辑体验**：
   - 基于 **CodeMirror 6**，提供专业的 Markdown 语法高亮、行号、自动换行、括号匹配与行聚焦。
   - 工具栏快捷插入：粗体、斜体、删除线、引用块、行内代码、多语言代码块、无序/有序/任务列表、超链接、图片、表格与分割线。
   - 智能选区包裹与光标自动定位。

4. **原生级文件系统能力**：
   - Rust 后端集成 `rfd` 原生文件选择对话框与 `std::fs` 文件读写，保证毫秒级响应。
   - 严格保证 UTF-8 编码读写，提供友好的错误提示与异常拦截。
   - **未保存修改保护**：关闭含有未保存修改的标签页或批量关闭其他标签页时，提供优雅的二次确认对话框；保存操作采用快照比对机制，写盘期间继续输入亦能精确保持脏标记与用户最新内容。
   - **全环境兼容**：在非 Tauri 的纯浏览器开发模式下，自动降级为浏览器文件读取与 Blob 下载，不会崩溃。

5. **专业 Word (.docx)、PDF (.pdf) & HTML (.html) 文档导出**：
   - **Word (.docx) 导出**：基于 OOXML 工业标准（`docx` + AST 转换），自动将 Markdown 转换为排版精良的 Word 文档。完整支持内置 Heading 1~6（原生支持 Word 导航窗格与目录生成）、A4 纸张与标准边距、微软雅黑中文字体、列表与嵌套多级列表（原生编号系统）、待办任务复选框、GFM 复杂表格（双重 DXA 列宽与表头底色）、等宽代码块及引用块。
   - **PDF (.pdf) 导出**：基于系统内置 **Microsoft Edge Headless** 引擎生成高质量矢量/文本型 PDF（非 Canvas 模糊截图或简易拼接）。内置 A4 打印样式、智能分页防断裂控制（`break-inside: avoid` / `break-after: avoid`）、代码语法高亮与中文无损字体栈。
   - **HTML (.html) 导出**：一键生成内嵌 CSS 样式的响应式独立单页 HTML（无需外部样式表依赖），完美支持移动端与桌面端自适应排版及 A4 打印样式。
   - **严格环境安全与 XSS 净化**：
     - PDF 与 HTML 转换期间严格通过 `rehype-sanitize` 进行 XSS 防护，禁止任意不可信脚本（`<script>`）、`<style>` 注入、`<iframe>`、`<object>`、`<embed>`、`<form>` 与内联事件（`onerror` 等）。
     - 绝对超链接协议严格白名单限制为 `http`、`https` 与 `mailto`，绝对图片协议严格限制为 `http` 与 `https`；同时安全保留页内锚点跳转（如 `#heading`）与安全相对图片引用（如 `./assets/preview.png`），拦截任意 `javascript:`、`file:`、`data:` 等危险协议。
   - **UTF-8 编码与 Meta 声明**：导出的 HTML 严格声明 `<meta charset="utf-8">` 与视口 `<meta name="viewport">`，并根据当前界面语言动态适配 `<html lang="zh-CN">` 或 `<html lang="en-US">`。
   - **本地基准路径与图片引用说明**：自动根据本地 Markdown 源文件目录生成安全规范的 `<base href="file:///...">`，支持 Windows 盘符、Unicode/空格、`#` 与 `?` 特殊字符、POSIX 绝对路径及 UNC 网络共享路径；**图片采用相对或绝对路径/网络链接引用，而非作为二进制文件包打包内嵌（Images are referenced, not embedded）**。
   - **全环境兼容与优雅降级**：
     - 桌面环境下自动检测 Windows Edge 多路常见安装路径（`Program Files (x86)`、`Program Files`、`LOCALAPPDATA`、`PATH` 等），安全采用隔离临时工作区渲染、落盘稳定性轮询校验与 Rust 原生文件复制机制，完美支持包含中文与空格的任意目标路径。
     - 浏览器纯 Web 预览环境下，Word 与 HTML 自动降级为标准 Blob 文件下载（HTML 采用 `text/html;charset=utf-8` MIME 并保持完整 Unicode 内容），PDF 自动打开浏览器打印友好页面，体验无缝一致。
     - 导出操作完全独立，**绝对不会篡改** 当前打开文档的路径、标题、保存快照或未保存脏状态。

6. **多标签页文档管理与 Windows 文件关联**：
   - 支持新建空白标签、独立打开多个本地文件、快速切换与关闭标签。
   - **Windows 原生文件关联（Open With）与单实例架构**：
     - 打包（NSIS）阶段通过 `bundle.fileAssociations` 注册关联 `.md`、`.markdown`、`.mdown`, `.mkd` 及 `.txt` 文档，作为 Windows 标准「打开方式」候选应用。
     - 集成 `tauri-plugin-single-instance`（单实例通信）：冷启动通过命令行参数直开目标文件；应用已在运行时双击或选择「打开方式」唤起，会自动激活已打开窗口、解除最小化并将新文件追加为新标签或切换至对应标签。
     - 启动与单实例参数安全支持 Windows 及 POSIX 标准 `file://` URL 解析（包括空格与 Unicode 百分比转义安全解码），严格拒绝非法非文件协议。
     - 前端通过 `fileCoordinator` 实现单实例唤醒信号、窗口焦点重聚、页面可见性恢复与后台挂起轮询恢复的多通道兜底机制，杜绝冷启动与运行时多重唤起的时序竞态问题。
   - **智能路径去重与安全隔离**：
     - Windows 路径忽略大小写并统一斜杠与规范化，避免重复打开同一物理文件（自动定位并切换至已打开的标签）。
     - 启动与唤起参数严格过滤为已存在的支持扩展名文件；文件读取阶段由 `read_text_file` 进行 UTF-8 编码校验并实现单文件错误隔离，单个损坏或非 UTF-8 文件失败时给出友好提示，绝不影响后续有效文件的批量打开。
   - 采用碰撞免疫的文档 ID 生成策略（优先 `crypto.randomUUID`），安全还原持久化会话。
   - 未保存修改实时展示脏状态标记（未保存圆点）。
   - 标签栏支持横向平滑滚动与鼠标中键一键关闭。

7. **智能文档大纲（TOC）**：
   - 实时从 Markdown 内容解析 H1-H6 标题层级，自动过滤代码块内部的假标题。
   - 支持实时标题过滤搜索。
   - 点击大纲条目：在编辑/分屏模式下精确跳转至 CodeMirror 对应行；在阅读/分屏模式下平滑滚动至预览锚点。

8. **GFM 富文本渲染与安全防护**：
   - 全面支持 GitHub Flavored Markdown（表格对齐、待办任务复选框、删除线、自动链接等）。
   - 代码块语法高亮（Rust、TypeScript、JavaScript、Python、CSS、HTML、JSON 等）。
   - 代码块顶部包含语言标签与「一键复制代码」按钮。
   - **XSS 安全防护**：默认拦截危险原生 HTML 注入，保证本地应用与文档浏览安全。
   - **外链安全白名单**：前后端严格限制 `http` / `https` / `mailto` 协议，系统级安全调用默认浏览器或邮件客户端，杜绝非法协议绕过。
   - **CSP 策略防护**：内置严格的 Content Security Policy，仅允许本地资源、Tauri IPC 与安全图片，禁止任意不可信外部脚本执行。

9. **明暗双主题与个性化偏好持久化**：
   - 浅色模式 / 深色模式 / 跟随系统主题，全 UI 与代码编辑器深度适配。
   - 本地持久化记忆用户偏好（语言设置、主题设置、视图模式、侧边栏开关、打开的标签页会话）。

10. **全功能精致偏好设置中心（Settings Modal）**：
   - **顶部快速唤出**：TitleBar 帮助按钮旁专属齿轮图标，支持全局快捷键 `Ctrl + ,` 随时唤起，无任何 Emoji，全 Lucide 矢量图标适配。
   - **键盘与无障碍支持**：支持 `Escape` / 遮罩点击快速关闭，具备完整的 ARIA 模态角色与辅助属性标注。
   - **界面语言选择**：支持一键在「简体中文」与「English」之间切换，即时生效无需重启。
   - **外观主题**：浅色模式、深色模式、跟随系统实时无缝切换，与全局主题状态双向绑定。
   - **编辑器偏好实时生效**：
     - 编辑器字号（11px ~ 28px 滑块与步进按钮调节，即时更新 CodeMirror）。
     - 行高比例（1.2 ~ 2.4 步进调节，舒适排版）。
     - 制表符宽度（2 空格 / 4 空格 / 8 空格切换与代码缩进对齐）。
     - 自动折行开关（Word Wrapping）与行号显示开关（Line Numbers）。
     - 全面解除 CodeMirror 硬编码 CSS 冲突，字体与行距修改实时热重载。
   - **启动与会话偏好**：
     - 启动时恢复会话：开启时自动恢复上次关闭时的所有标签页；关闭时启动干净的默认文档，且不会破坏性清除持久化会话数据。
     - 默认启动视图模式：支持选择「记忆上次视图」、「双栏分屏」、「纯编辑」或「纯阅读」，启动时严格遵从偏好配置。
   - **系统文件关联管理**：
     - 直观列出应用支持的关联扩展名（`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`）。
     - 桌面端一键直达 Windows 系统「默认应用」设置（通过固定专用无参 Rust 命令调起 `ms-settings:defaultapps`，坚决杜绝任意命令与危险协议注入），非 Windows 或 Web 环境优雅提示。
   - **一键恢复默认设置**：支持将所有偏好重置为系统出厂最佳预设（语言恢复为简体中文）。
   - **版本化防御性持久化**：采用版本化存储（`markdown_editor_settings_v1`），支持损坏 JSON 拦截、范围越界与枚举安全回退，并平滑兼容和迁移旧版 localStorage 配置。

---

## 🛠️ 技术栈

| 模块 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **底层桌面框架** | Tauri 2.x + Rust 2021 | 跨平台轻量桌面运行时，极低资源占用 |
| **原生能力集成** | `tauri-plugin-single-instance`, `rfd`, `opener`, `tempfile`, `std::fs` | 单实例通信唤醒、原生文件对话框、系统浏览器/邮件调用、临时工作区与安全二进制读写 |
| **国际化 (i18n)** | Custom Typed Dictionary & Context (`src/i18n`) | 轻量类型安全 i18n 架构，支持 Simplified Chinese / English 即时切换与回退 |
| **Word (.docx) 生成** | `docx`, `unified`, `remark-parse`, `remark-gfm` | 纯 OOXML 二进制构建，内置 Heading / 表格 / 列表编号系统 |
| **PDF (.pdf) 导出与排版** | Headless Microsoft Edge, `remark-rehype`, `rehype-sanitize` | 矢量级 A4 打印排版、XSS 严格过滤与纯净字体渲染 |
| **HTML (.html) 导出** | `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-highlight`, `rehype-sanitize`, `rehype-stringify` | 独立单页 HTML 生成（内嵌 CSS 样式）、响应式排版、代码高亮与严格安全净化 |
| **前端框架** | React 18 + TypeScript + Vite | 现代化组件开发与极速热重载 |
| **核心编辑器** | CodeMirror 6 (`@uiw/react-codemirror`) | 现代模块化代码编辑器，Markdown 语法高亮与主题 |
| **Markdown 渲染** | `react-markdown`, `remark-gfm`, `rehype-slug`, `rehype-highlight` | GFM 解析、标题锚点生成与代码高亮 |
| **图标与样式** | `lucide-react`, Tailwind CSS | 精致无 Emoji 的 Windows 原生质感界面 |
| **测试框架** | Vitest | 快速纯函数、转换器、安全性与逻辑单元测试 |

---

## ⌨️ 常用快捷键

| 快捷键 | 功能描述 |
| :--- | :--- |
| `Ctrl + N` | 新建空白文档标签 |
| `Ctrl + O` | 打开本地 Markdown/文本文件 (`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`) |
| `Ctrl + S` | 快速保存当前文档 |
| `Ctrl + Shift + S` | 当前文档另存为... |
| `Ctrl + W` | 关闭当前标签页（若有未保存修改将弹出确认） |
| `Ctrl + 1` | 切换至 **纯编辑模式** |
| `Ctrl + 2` | 切换至 **双栏分屏模式** |
| `Ctrl + 3` | 切换至 **纯阅读模式** |
| `Ctrl + Shift + O` | 展开 / 收起左侧大纲侧边栏 |
| `Ctrl + ,` | 打开偏好设置面板 |
| `F1` 或 `Ctrl + /` | 打开快捷键帮助窗口 |
| `Ctrl + B` | 选中文本加粗 |
| `Ctrl + I` | 选中文本斜体 |
| `Ctrl + Z / Y` | 撤销 / 重做 |

---

## 🚀 开发与运行

### 1. 环境准备
- 安装 [Node.js](https://nodejs.org/) (推荐 LTS 18+ 或最新稳定版)
- 安装 [Rust & Cargo](https://www.rust-lang.org/) (推荐 1.75+)
- Windows 系统需确保安装了 C++ 生成工具 (Visual Studio Build Tools) 以及 WebView2 运行时。
- PDF 导出依赖系统已安装的 **Microsoft Edge** 浏览器（Windows 10/11 默认已内置）。

### 2. 安装依赖
```bash
npm install
```

### 3. 本地开发调试

#### 方式 A：纯前端 Web 开发模式（支持浏览器文件交互与打印降级）
```bash
npm run dev
```
启动后在浏览器中访问 `http://localhost:5173`。

#### 方式 B：Tauri 桌面应用开发模式
```bash
npm run tauri dev
```
启动后将自动编译 Rust 后端并唤起原生桌面窗口。

---

## 📦 Windows 桌面打包构建与文件关联

### 1. 打包生成安装包
打包生成独立的 Windows 可执行程序 (`.exe`) 及安装包 (`.msi` / `.nsis`)：

```bash
# 1. 确保前端与后端无编译错误
npm run build
cd src-tauri && cargo check && cd ..

# 2. 一键打包 Windows 发布版本
npm run tauri build
```

打包完成后，安装包将生成在：
`src-tauri/target/release/bundle/nsis/` 或 `src-tauri/target/release/` 目录下。

### 2. Windows 文件关联与「默认应用」行为说明
- **注册机制**：在 NSIS 安装包中，已配置 `bundle.fileAssociations` 自动将 MarkdownEditor 注册为 `.md`、`.markdown`、`.mdown`、`.mkd`、`.txt` 的打开方式候选程序。
- **系统限制与规范**：自 Windows 10/11 起，操作系统为保障用户自主选择权与系统安全，严禁任何第三方安装程序直接在注册表强行篡改用户默认打开程序（User Choice Hash 保护机制）。
- **设为默认程序**：安装完成后，用户在任意 Markdown 文件上右键点击「打开方式」->「选择其他应用」-> 勾选「始终使用此应用打开文件」，或前往 Windows 系统「设置 -> 应用 -> 默认应用」中搜索 `.md` 并指定 MarkdownEditor 即可。

---

## 🧪 单元测试

项目集成了 Vitest 与 Cargo 单元测试，涵盖国际化字典完备性与插值、偏好设置校验与迁移、文档工具（ID 生成、路径规范化、导出默认文件名计算）、Word OOXML 生成结构、PDF 打印 HTML 与 XSS 安全过滤、HTML 独立单页生成与本地 Base URL 强化解析、外链安全白名单校验、大纲解析、标题 Slug 生成、中英文分词统计等核心模块：

```bash
# 执行前端测试
npm test -- --run

# 执行 Rust 后端测试
cd src-tauri && cargo test && cd ..
```

---

## 📁 项目结构

```
markdown-editor/
├── src-tauri/                # Tauri 2 Rust 原生后端工程
│   ├── Cargo.toml            # Rust 依赖配置 (tauri, rfd, opener, tempfile, serde)
│   ├── build.rs              # Tauri 资源编译脚本
│   ├── tauri.conf.json       # Tauri 窗口、CSP 与打包配置
│   ├── icons/                # Windows/Mac/Linux 桌面应用图标
│   └── src/
│       ├── lib.rs            # Rust 原生命令 (read/write/dialogs/export_pdf/opener)
│       └── main.rs           # Windows 进程入口
├── src/                      # 前端 React + TypeScript 源码
│   ├── components/           # UI 界面组件
│   │   ├── TitleBar.tsx      # 顶部标题栏、另存为及导出下拉菜单
│   │   ├── TabBar.tsx        # 多标签页管理
│   │   ├── Toolbar.tsx       # Markdown 快捷插入工具条
│   │   ├── Sidebar.tsx       # 文档大纲（TOC）与搜索
│   │   ├── Editor.tsx        # CodeMirror 6 编辑器集成
│   │   ├── Preview.tsx       # GFM Markdown 渲染与代码复制
│   │   ├── StatusBar.tsx     # 底部统计与光标状态栏
│   │   ├── ConfirmModal.tsx  # 未保存提示确认对话框
│   │   ├── ShortcutsModal.tsx# 快捷键速查面板
│   │   ├── SettingsModal.tsx # 偏好设置中心面板
│   │   └── ToastContainer.tsx# 消息 Toast 浮窗
│   ├── hooks/                # React Hooks
│   │   ├── useSettings.ts    # 偏好设置响应式管理
│   │   ├── useTheme.ts       # 明暗主题管理
│   │   ├── useDocuments.ts   # 文档多标签与读写核心状态
│   │   ├── useExportDocument.ts # Word / PDF / HTML 导出交互与状态管理
│   │   ├── useKeyboardShortcuts.ts # 全局键盘快捷键响应
│   │   └── useToast.ts       # 通知状态管理
│   ├── i18n/                 # 国际化架构与语言字典
│   │   ├── types.ts          # i18n 类型定义
│   │   ├── index.tsx         # I18nProvider、t 函数与插值工具
│   │   └── locales/          # 语言字典包
│   │       ├── zh-CN.ts      # 简体中文
│   │       └── en-US.ts      # English
│   ├── lib/                  # 业务算法与工具函数
│   │   ├── settings.ts       # 偏好设置数据结构、防御校验与版本持久化
│   │   ├── export/           # 文档导出模块
│   │   │   ├── docxExporter.ts # Markdown 转 OOXML .docx 算法
│   │   │   ├── pdfExporter.ts  # Markdown 转安全打印 HTML 与 PDF 导出
│   │   │   └── htmlExporter.ts # Markdown 转独立单页 HTML 算法
│   │   ├── native.ts         # Tauri 原生命令调用、外链校验与 Web 降级
│   │   ├── documentUtils.ts  # 文档 ID 生成、路径规范化与保存快照计算
│   │   ├── outline.ts        # Markdown 标题大纲提取算法
│   │   ├── stats.ts          # 中英文字数与阅读时间统计
│   │   ├── markdownCommands.ts# Markdown 语法包裹与选区处理
│   │   ├── fileCoordinator.ts # 文件打开与单实例唤醒多通道协调器
│   │   └── defaultDocument.ts# 首次启动欢迎文档 (中/英文双语适配)
│   ├── styles/               # 样式文件
│   │   ├── index.css         # 全局样式与自定义滚动条
│   │   └── markdown.css      # Markdown 排版与暗黑模式适配
│   ├── types/                # TypeScript 类型定义
│   ├── App.tsx               # 根应用布局容器 (I18nProvider 挂载)
│   └── main.tsx              # React DOM 渲染入口
├── tests/                    # Vitest 单元测试
│   ├── i18n.test.tsx         # 国际化字典完备性、插值与双语组件渲染测试
│   ├── settings.test.ts      # 偏好设置校验、持久化与迁移测试
│   ├── settingsUI.test.tsx   # 偏好设置组件与无障碍交互测试
│   ├── sessionRestore.test.ts# 启动视图偏好与会话恢复测试
│   ├── export.test.ts        # Word / PDF / HTML 导出算法与安全过滤测试
│   ├── documentUtils.test.ts # 路径规范化、ID 生成与保存快照测试
│   ├── native.test.ts        # 外部链接与原生导出封装测试
│   ├── outline.test.ts       # 大纲提取测试
│   ├── stats.test.ts         # 字数统计测试
│   └── markdownCommands.test.ts # 文本格式化命令测试
├── package.json              # 前端配置与依赖
├── tsconfig.json             # TypeScript 配置
├── vite.config.ts            # Vite 配置
└── vitest.config.ts          # Vitest 配置
```
