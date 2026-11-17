/**
 * Pure template / snippet core.
 *
 * This module intentionally has no React, Tauri, or i18n runtime dependency:
 * the UI resolves `nameKey` / `descriptionKey` through the app's `t()` helper,
 * while the Markdown bodies live here so they can be used and tested without a
 * DOM. All localStorage access is guarded so importing this module (and calling
 * the read helpers) is safe during Node SSR.
 */

export type TemplateLanguage = 'zh-CN' | 'en-US';

export const BUILT_IN_TEMPLATE_IDS = [
  'meeting-minutes',
  'weekly-report',
  'technical-proposal',
  'reading-notes',
] as const;

export type BuiltInTemplateId = (typeof BUILT_IN_TEMPLATE_IDS)[number];

export type BuiltInTemplateI18nKey =
  | 'templates.builtin.meetingMinutes.name'
  | 'templates.builtin.meetingMinutes.description'
  | 'templates.builtin.weeklyReport.name'
  | 'templates.builtin.weeklyReport.description'
  | 'templates.builtin.technicalProposal.name'
  | 'templates.builtin.technicalProposal.description'
  | 'templates.builtin.readingNotes.name'
  | 'templates.builtin.readingNotes.description';

/**
 * Every key the root locale files must provide for the built-in templates.
 * Kept as an explicit list (rather than derived strings) so adding a built-in
 * without adding translations is visible in review and in the tests.
 */
export const BUILT_IN_TEMPLATE_I18N_KEYS: readonly BuiltInTemplateI18nKey[] = [
  'templates.builtin.meetingMinutes.name',
  'templates.builtin.meetingMinutes.description',
  'templates.builtin.weeklyReport.name',
  'templates.builtin.weeklyReport.description',
  'templates.builtin.technicalProposal.name',
  'templates.builtin.technicalProposal.description',
  'templates.builtin.readingNotes.name',
  'templates.builtin.readingNotes.description',
];

export interface BuiltInTemplate {
  readonly id: BuiltInTemplateId;
  readonly nameKey: BuiltInTemplateI18nKey;
  readonly descriptionKey: BuiltInTemplateI18nKey;
  readonly bodies: Readonly<Record<TemplateLanguage, string>>;
}

export interface LocalizedBuiltInTemplate {
  readonly id: BuiltInTemplateId;
  readonly nameKey: BuiltInTemplateI18nKey;
  readonly descriptionKey: BuiltInTemplateI18nKey;
  readonly body: string;
}

const MEETING_MINUTES_ZH = `# {{title}}

- 日期：{{date}}
- 时间：{{time}}
- 记录人：{{author}}
- 会议地点：
- 参会人：
- 缺席人：

## 会议目标

简要说明本次会议要解决的问题和预期产出。

## 议程

1.\x20
2.\x20
3.\x20

## 讨论要点

### 议题一

- 背景：
- 讨论：
- 结论：

### 议题二

- 背景：
- 讨论：
- 结论：

## 决议

| 编号 | 决议内容 | 负责人 | 截止日期 | 状态 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  | 待开始 |
| 2 |  |  |  | 待开始 |

## 行动项

- [ ] 行动项一（负责人：，截止：）
- [ ] 行动项二（负责人：，截止：）

## 风险与待确认事项

-\x20

## 下次会议

- 时间：
- 议题：
`;

const MEETING_MINUTES_EN = `# {{title}}

- Date: {{date}}
- Time: {{time}}
- Recorder: {{author}}
- Location:
- Attendees:
- Absentees:

## Objective

Describe the problem this meeting should resolve and the expected outcome.

## Agenda

1.\x20
2.\x20
3.\x20

## Discussion

### Topic 1

- Context:
- Discussion:
- Decision:

### Topic 2

- Context:
- Discussion:
- Decision:

## Decisions

| No. | Decision | Owner | Due | Status |
| --- | --- | --- | --- | --- |
| 1 |  |  |  | Not started |
| 2 |  |  |  | Not started |

## Action Items

- [ ] Action item 1 (owner:, due:)
- [ ] Action item 2 (owner:, due:)

## Risks and Open Questions

-\x20

## Next Meeting

- Time:
- Agenda:
`;

const WEEKLY_REPORT_ZH = `# {{title}}

- 周期：{{date}} 至\x20
- 作者：{{author}}
- 生成时间：{{datetime}}

## 本周概要

用三到五句话说明本周最重要的进展、结论和需要关注的问题。

## 已完成

- [x]\x20
- [x]\x20

## 进行中

| 事项 | 当前进度 | 预计完成 | 风险 |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

## 阻塞与风险

| 问题 | 影响 | 需要的支持 | 负责人 |
| --- | --- | --- | --- |
|  |  |  |  |

## 下周计划

- [ ]\x20
- [ ]\x20
- [ ]\x20

## 数据与链接

- 相关文档：
- 关键指标：
- 待评审内容：
`;

const WEEKLY_REPORT_EN = `# {{title}}

- Period: {{date}} to\x20
- Author: {{author}}
- Generated: {{datetime}}

## Summary

Summarize the most important progress, conclusions, and concerns in three to five sentences.

## Completed

- [x]\x20
- [x]\x20

## In Progress

| Item | Current progress | ETA | Risk |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

## Blockers and Risks

| Issue | Impact | Support needed | Owner |
| --- | --- | --- | --- |
|  |  |  |  |

## Next Week

- [ ]\x20
- [ ]\x20
- [ ]\x20

## Data and Links

- Related documents:
- Key metrics:
- Items for review:
`;

const TECHNICAL_PROPOSAL_ZH = `# {{title}}

- 作者：{{author}}
- 日期：{{date}}
- 状态：草案
- 评审人：

## 1. 背景与问题

描述当前现状、问题的影响范围，以及为什么现在需要解决。

## 2. 目标与非目标

### 目标

-\x20
-\x20

### 非目标

-\x20
-\x20

## 3. 约束与假设

- 技术约束：
- 业务约束：
- 关键假设：

## 4. 方案对比

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 方案 A |  |  |  |
| 方案 B |  |  |  |

## 5. 推荐方案

### 总体设计

说明核心组件、职责边界和关键流程。

### 数据流

\`\`\`text
客户端 -> 接口层 -> 领域服务 -> 存储
\`\`\`

### 接口与数据结构

\`\`\`ts
interface ExampleRequest {
  id: string;
}

interface ExampleResponse {
  ok: boolean;
}
\`\`\`

## 6. 兼容性与迁移

- 兼容范围：
- 数据迁移：
- 灰度与回滚：

## 7. 安全与隐私

- 鉴权：
- 输入校验：
- 敏感数据：
- 日志脱敏：

## 8. 可观测性

- 指标：
- 日志：
- 告警：
- 追踪：

## 9. 发布与回滚

1. 发布前检查：
2. 发布步骤：
3. 回滚条件：
4. 回滚步骤：

## 10. 测试计划

- [ ] 单元测试覆盖核心分支
- [ ] 集成测试覆盖接口与存储
- [ ] 兼容性与迁移演练
- [ ] 异常与回滚演练

## 11. 风险

| 风险 | 影响 | 概率 | 缓解措施 |
| --- | --- | --- | --- |
|  |  |  |  |

## 12. 开放问题

-\x20
-\x20
`;

const TECHNICAL_PROPOSAL_EN = `# {{title}}

- Author: {{author}}
- Date: {{date}}
- Status: Draft
- Reviewers:

## 1. Context and Problem

Describe the current state, who is affected, and why this needs to be solved now.

## 2. Goals and Non-goals

### Goals

-\x20
-\x20

### Non-goals

-\x20
-\x20

## 3. Constraints and Assumptions

- Technical constraints:
- Business constraints:
- Key assumptions:

## 4. Alternatives

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| Option A |  |  |  |
| Option B |  |  |  |

## 5. Recommended Design

### Overview

Describe the core components, responsibility boundaries, and key flows.

### Data Flow

\`\`\`text
Client -> API -> Domain service -> Storage
\`\`\`

### Interfaces and Data Structures

\`\`\`ts
interface ExampleRequest {
  id: string;
}

interface ExampleResponse {
  ok: boolean;
}
\`\`\`

## 6. Compatibility and Migration

- Compatibility scope:
- Data migration:
- Rollout and rollback:

## 7. Security and Privacy

- Authentication:
- Input validation:
- Sensitive data:
- Log redaction:

## 8. Observability

- Metrics:
- Logs:
- Alerts:
- Tracing:

## 9. Rollout and Rollback

1. Pre-release checks:
2. Release steps:
3. Rollback triggers:
4. Rollback steps:

## 10. Test Plan

- [ ] Unit tests cover core branches
- [ ] Integration tests cover API and storage
- [ ] Compatibility and migration rehearsal
- [ ] Failure and rollback rehearsal

## 11. Risks

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
|  |  |  |  |

## 12. Open Questions

-\x20
-\x20
`;

const READING_NOTES_ZH = `# {{title}}

| 项目 | 内容 |
| --- | --- |
| 书名 |  |
| 作者 |  |
| 译者 |  |
| 出版社 |  |
| 阅读日期 | {{date}} |
| 笔记作者 | {{author}} |
| 评分 | /5 |

## 一句话总结

用一句话概括这本书最核心的主张。

## 核心观点

1.\x20
2.\x20
3.\x20

## 章节笔记

### 第一章

- 关键概念：
- 我的理解：
- 疑问：

### 第二章

- 关键概念：
- 我的理解：
- 疑问：

## 原文摘录

> 摘录内容（注明页码或章节）

## 个人思考

- 哪些观点改变了我的认知：
- 哪些观点我不同意，为什么：
- 可以如何应用到工作或生活：

## 行动清单

- [ ]\x20
- [ ]\x20

## 关联阅读

-\x20
`;

const READING_NOTES_EN = `# {{title}}

| Item | Content |
| --- | --- |
| Title |  |
| Author |  |
| Translator |  |
| Publisher |  |
| Date read | {{date}} |
| Notes by | {{author}} |
| Rating | /5 |

## One-sentence Summary

State the book's central claim in one sentence.

## Key Ideas

1.\x20
2.\x20
3.\x20

## Chapter Notes

### Chapter 1

- Key concepts:
- My understanding:
- Questions:

### Chapter 2

- Key concepts:
- My understanding:
- Questions:

## Excerpts

> Quote (include page or chapter)

## Reflections

- Which ideas changed my thinking:
- Which ideas I disagree with, and why:
- How I can apply this at work or in life:

## Action Items

- [ ]\x20
- [ ]\x20

## Related Reading

-\x20
`;

/**
 * Stable identifiers are part of the public contract: do not rename them,
 * because a future "recently used" list or user preference may persist them.
 */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    id: 'meeting-minutes',
    nameKey: 'templates.builtin.meetingMinutes.name',
    descriptionKey: 'templates.builtin.meetingMinutes.description',
    bodies: { 'zh-CN': MEETING_MINUTES_ZH, 'en-US': MEETING_MINUTES_EN },
  },
  {
    id: 'weekly-report',
    nameKey: 'templates.builtin.weeklyReport.name',
    descriptionKey: 'templates.builtin.weeklyReport.description',
    bodies: { 'zh-CN': WEEKLY_REPORT_ZH, 'en-US': WEEKLY_REPORT_EN },
  },
  {
    id: 'technical-proposal',
    nameKey: 'templates.builtin.technicalProposal.name',
    descriptionKey: 'templates.builtin.technicalProposal.description',
    bodies: { 'zh-CN': TECHNICAL_PROPOSAL_ZH, 'en-US': TECHNICAL_PROPOSAL_EN },
  },
  {
    id: 'reading-notes',
    nameKey: 'templates.builtin.readingNotes.name',
    descriptionKey: 'templates.builtin.readingNotes.description',
    bodies: { 'zh-CN': READING_NOTES_ZH, 'en-US': READING_NOTES_EN },
  },
];

function normalizeLanguage(language: TemplateLanguage | undefined): TemplateLanguage {
  return language === 'en-US' ? 'en-US' : 'zh-CN';
}

/** Returns built-in templates with the body for the requested UI language. */
export function getBuiltInTemplates(
  language: TemplateLanguage = 'zh-CN'
): LocalizedBuiltInTemplate[] {
  const lang = normalizeLanguage(language);
  return BUILT_IN_TEMPLATES.map((template) => ({
    id: template.id,
    nameKey: template.nameKey,
    descriptionKey: template.descriptionKey,
    body: template.bodies[lang],
  }));
}

/** Returns one built-in template, or `null` for an unknown id. */
export function getBuiltInTemplate(
  id: string,
  language: TemplateLanguage = 'zh-CN'
): LocalizedBuiltInTemplate | null {
  const template = BUILT_IN_TEMPLATES.find((item) => item.id === id);
  if (!template) return null;
  return {
    id: template.id,
    nameKey: template.nameKey,
    descriptionKey: template.descriptionKey,
    body: template.bodies[normalizeLanguage(language)],
  };
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export interface TemplateVariableValues {
  /** Replaced into `{{title}}`. */
  title?: string;
  /** Replaced into `{{author}}`. */
  author?: string;
  /** Explicit `{{date}}` value. Defaults to the local date of `now`. */
  date?: string;
  /** Explicit `{{time}}` value. Defaults to the local time of `now`. */
  time?: string;
  /** Explicit `{{datetime}}` value. Defaults to `<date> <time>`. */
  datetime?: string;
  /** Clock used for date/time defaults. Defaults to `new Date()`. */
  now?: Date | number | string;
}

const TEMPLATE_VARIABLE_PATTERN =
  /\{\{\s*(date|time|datetime|title|author|cursor)\s*\}\}/g;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(
    date.getMonth() + 1
  )}-${pad2(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function coerceDate(value: Date | number | string | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Replaces `{{date}}`, `{{time}}`, `{{datetime}}`, `{{title}}`, `{{author}}`
 * and `{{cursor}}` in one pass.
 *
 * This is deliberately a pure string replacement: there is no `eval`, no
 * expression support, no HTML/Markdown rewriting, and no inspection of
 * `data:` URLs. Unknown tokens (including `{{constructor}}`) are left exactly
 * as written, and values inserted by this pass are never expanded again.
 */
export function expandTemplate(
  body: string,
  values: TemplateVariableValues = {}
): string {
  const now = coerceDate(values.now);
  const date = typeof values.date === 'string' ? values.date : formatDate(now);
  const time = typeof values.time === 'string' ? values.time : formatTime(now);
  const datetime =
    typeof values.datetime === 'string' ? values.datetime : `${date} ${time}`;
  const title = typeof values.title === 'string' ? values.title : '';
  const author = typeof values.author === 'string' ? values.author : '';

  return body.replace(TEMPLATE_VARIABLE_PATTERN, (match, name: string) => {
    switch (name) {
      case 'date':
        return date;
      case 'time':
        return time;
      case 'datetime':
        return datetime;
      case 'title':
        return title;
      case 'author':
        return author;
      case 'cursor':
        // The caller inserts at its current cursor; `{{cursor}}` only marks
        // an optional insertion point, so the token itself is removed.
        return '';
      default:
        return match;
    }
  });
}

/** Expands a built-in template, or returns `null` for an unknown id. */
export function renderBuiltInTemplate(
  id: string,
  language: TemplateLanguage = 'zh-CN',
  values: TemplateVariableValues = {}
): string | null {
  const template = getBuiltInTemplate(id, language);
  return template ? expandTemplate(template.body, values) : null;
}

// ---------------------------------------------------------------------------
// Custom snippets
// ---------------------------------------------------------------------------

export const SNIPPETS_STORAGE_KEY = 'markdown_editor_snippets_v1';
export const SNIPPET_AUTHOR_STORAGE_KEY = 'markdown_editor_snippet_author';
export const MAX_SNIPPETS = 50;
export const MAX_SNIPPET_TITLE_LENGTH = 80;
export const MAX_SNIPPET_AUTHOR_LENGTH = 80;
/** 256 KiB, measured as UTF-8 bytes rather than UTF-16 code units. */
export const MAX_SNIPPET_BODY_BYTES = 256 * 1024;

export interface Snippet {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetDraft {
  title: string;
  body: string;
  author?: string;
}

/** Minimal browser-storage surface; tests can pass an in-memory object. */
export interface SnippetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type SnippetSaveError =
  | 'title-required'
  | 'title-too-long'
  | 'body-too-large'
  | 'invalid-body'
  | 'limit-reached'
  | 'storage-unavailable'
  | 'storage-write-failed';

export interface SaveSnippetOptions {
  /**
   * Update this snippet when it exists. A valid, unused id is reused when the
   * record is missing; otherwise a fresh UUID is generated.
   */
  id?: string;
  /** Injected clock for deterministic tests. */
  now?: Date;
  /** `undefined` uses localStorage, `null` disables persistence. */
  storage?: SnippetStorage | null;
}

export type SaveSnippetResult =
  | {
      ok: true;
      snippets: Snippet[];
      snippet: Snippet;
      created: boolean;
    }
  | {
      ok: false;
      error: SnippetSaveError;
    };

export interface DeleteSnippetOptions {
  storage?: SnippetStorage | null;
}

export type DeleteSnippetResult =
  | {
      ok: true;
      snippets: Snippet[];
      deleted: boolean;
    }
  | {
      ok: false;
      error: 'storage-unavailable' | 'storage-write-failed';
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the browser localStorage when it is safe to touch. Access can throw
 * (for example in a privacy-restricted iframe), so it is always wrapped.
 */
export function getDefaultSnippetStorage(): SnippetStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

/**
 * Generates a UUID v4 using the platform CSPRNG when available. The
 * `Math.random` branch is only a last-resort fallback for environments without
 * Web Crypto (all supported Tauri webviews and Node provide it).
 */
export function createSnippetId(): string {
  const cryptoApi =
    typeof crypto === 'undefined' ? undefined : crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = randomByte();
    }
  }

  // RFC 4122 version 4 / variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function isSafeSnippetId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Counts UTF-8 bytes without requiring Buffer / TextEncoder in callers. */
export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }

  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

function truncateCodePoints(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length <= maxLength
    ? value
    : characters.slice(0, maxLength).join('');
}

export function normalizeSnippetTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSnippetAuthor(value: unknown): string {
  return typeof value === 'string'
    ? truncateCodePoints(value.trim(), MAX_SNIPPET_AUTHOR_LENGTH)
    : '';
}

function toTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function sanitizeStoredSnippet(
  raw: unknown,
  now: number,
  seenIds: Set<string>
): Snippet | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const title = truncateCodePoints(
    normalizeSnippetTitle(record.title),
    MAX_SNIPPET_TITLE_LENGTH
  );
  // Empty titles are meaningless in the picker and are dropped, as are bodies
  // that exceed the hard storage cap (they could not have been saved by us).
  if (!title) return null;
  if (typeof record.body !== 'string') return null;
  if (utf8ByteLength(record.body) > MAX_SNIPPET_BODY_BYTES) return null;

  let id =
    isSafeSnippetId(record.id) && !seenIds.has(record.id)
      ? record.id
      : createSnippetId();
  while (seenIds.has(id)) {
    id = createSnippetId();
  }
  seenIds.add(id);

  const createdAt = toTimestamp(record.createdAt, now);
  const updatedAt = Math.max(createdAt, toTimestamp(record.updatedAt, now));

  return {
    id,
    title,
    body: record.body,
    author: normalizeSnippetAuthor(record.author),
    createdAt,
    updatedAt,
  };
}

/**
 * Loads custom snippets defensively.
 *
 * Corrupt JSON, a non-array payload, malformed records, duplicate/invalid ids,
 * and over-limit data never throw; they are skipped or repaired. At most
 * `MAX_SNIPPETS` records are returned.
 */
export function loadSnippets(
  storage: SnippetStorage | null = getDefaultSnippetStorage()
): Snippet[] {
  if (!storage) return [];

  let raw: string | null;
  try {
    raw = storage.getItem(SNIPPETS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const seenIds = new Set<string>();
  const snippets: Snippet[] = [];

  for (const item of parsed) {
    const snippet = sanitizeStoredSnippet(item, now, seenIds);
    if (snippet) snippets.push(snippet);
    if (snippets.length >= MAX_SNIPPETS) break;
  }

  return snippets;
}

function resolveStorage(
  storage: SnippetStorage | null | undefined
): SnippetStorage | null {
  return storage === undefined ? getDefaultSnippetStorage() : storage;
}

/**
 * Creates a snippet, or updates one when `options.id` matches an existing
 * record. The returned list is already persisted; a storage quota/write error
 * is reported instead of silently losing the snippet.
 */
export function saveSnippet(
  draft: SnippetDraft,
  options: SaveSnippetOptions = {}
): SaveSnippetResult {
  const title = normalizeSnippetTitle(draft.title);
  if (!title) return { ok: false, error: 'title-required' };
  if (Array.from(title).length > MAX_SNIPPET_TITLE_LENGTH) {
    return { ok: false, error: 'title-too-long' };
  }
  if (typeof draft.body !== 'string') {
    return { ok: false, error: 'invalid-body' };
  }
  if (utf8ByteLength(draft.body) > MAX_SNIPPET_BODY_BYTES) {
    return { ok: false, error: 'body-too-large' };
  }

  const storage = resolveStorage(options.storage);
  if (!storage) return { ok: false, error: 'storage-unavailable' };

  const existing = loadSnippets(storage);
  const matchIndex = options.id
    ? existing.findIndex((snippet) => snippet.id === options.id)
    : -1;
  const current = matchIndex >= 0 ? existing[matchIndex] : null;

  if (!current && existing.length >= MAX_SNIPPETS) {
    return { ok: false, error: 'limit-reached' };
  }

  const now = coerceTimestamp(options.now);
  const id = current
    ? current.id
    : isSafeSnippetId(options.id)
    ? options.id
    : createSnippetId();
  const snippet: Snippet = {
    id,
    title,
    body: draft.body,
    author: normalizeSnippetAuthor(draft.author),
    createdAt: current ? current.createdAt : now,
    updatedAt: now,
  };

  const next = current
    ? existing.map((item, index) => (index === matchIndex ? snippet : item))
    : [snippet, ...existing];

  try {
    storage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, error: 'storage-write-failed' };
  }

  return { ok: true, snippets: next, snippet, created: !current };
}

function coerceTimestamp(value: Date | undefined): number {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.getTime()
    : Date.now();
}

/** Deletes one snippet by id. Deleting a missing id is a successful no-op. */
export function deleteSnippet(
  id: string,
  options: DeleteSnippetOptions = {}
): DeleteSnippetResult {
  const storage = resolveStorage(options.storage);
  if (!storage) return { ok: false, error: 'storage-unavailable' };

  const existing = loadSnippets(storage);
  const next = existing.filter((snippet) => snippet.id !== id);
  if (next.length === existing.length) {
    return { ok: true, snippets: existing, deleted: false };
  }

  try {
    storage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, error: 'storage-write-failed' };
  }

  return { ok: true, snippets: next, deleted: true };
}

/** Reads the last-used custom-snippet author (empty string when unset). */
export function loadSnippetAuthor(
  storage: SnippetStorage | null = getDefaultSnippetStorage()
): string {
  if (!storage) return '';
  try {
    return normalizeSnippetAuthor(storage.getItem(SNIPPET_AUTHOR_STORAGE_KEY));
  } catch {
    return '';
  }
}

/** Persists the custom-snippet author. Returns false when storage is blocked. */
export function saveSnippetAuthor(
  author: string,
  storage: SnippetStorage | null = getDefaultSnippetStorage()
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SNIPPET_AUTHOR_STORAGE_KEY,
      normalizeSnippetAuthor(author)
    );
    return true;
  } catch {
    return false;
  }
}
