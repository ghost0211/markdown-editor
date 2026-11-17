import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  BUILT_IN_TEMPLATE_IDS,
  BUILT_IN_TEMPLATE_I18N_KEYS,
  MAX_SNIPPETS,
  MAX_SNIPPET_AUTHOR_LENGTH,
  MAX_SNIPPET_BODY_BYTES,
  MAX_SNIPPET_TITLE_LENGTH,
  SNIPPETS_STORAGE_KEY,
  SNIPPET_AUTHOR_STORAGE_KEY,
  createSnippetId,
  deleteSnippet,
  expandTemplate,
  getBuiltInTemplate,
  getBuiltInTemplates,
  isSafeSnippetId,
  loadSnippetAuthor,
  loadSnippets,
  normalizeSnippetTitle,
  renderBuiltInTemplate,
  saveSnippet,
  saveSnippetAuthor,
  utf8ByteLength,
  type DeleteSnippetResult,
  type SaveSnippetResult,
  type SnippetStorage,
} from '../src/lib/templates';

const FIXED_NOW = new Date(2026, 0, 2, 3, 4, 5);
const DATE = '2026-01-02';
const TIME = '03:04';
const VALID_ID = '123e4567-e89b-42d3-a456-426614174000';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class MemoryStorage implements SnippetStorage {
  values: Record<string, string>;
  writes = 0;

  constructor(initial: Record<string, string> = {}) {
    this.values = { ...initial };
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.values, key)
      ? this.values[key]
      : null;
  }

  setItem(key: string, value: string): void {
    this.values[key] = String(value);
    this.writes += 1;
  }

  removeItem(key: string): void {
    delete this.values[key];
  }
}

function assertSaveOk(
  result: SaveSnippetResult
): asserts result is Extract<SaveSnippetResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected successful save, got: ${result.error}`);
  }
}

function assertDeleteOk(
  result: DeleteSnippetResult
): asserts result is Extract<DeleteSnippetResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected successful delete, got: ${result.error}`);
  }
}

describe('built-in templates', () => {
  it('exposes four stable ids and complete bilingual GFM bodies', () => {
    expect(BUILT_IN_TEMPLATE_IDS).toEqual([
      'meeting-minutes',
      'weekly-report',
      'technical-proposal',
      'reading-notes',
    ]);
    expect(BUILT_IN_TEMPLATES).toHaveLength(4);

    for (const template of BUILT_IN_TEMPLATES) {
      expect(BUILT_IN_TEMPLATE_IDS).toContain(template.id);
      expect(BUILT_IN_TEMPLATE_I18N_KEYS).toContain(template.nameKey);
      expect(BUILT_IN_TEMPLATE_I18N_KEYS).toContain(template.descriptionKey);
      expect(BUILT_IN_TEMPLATE_I18N_KEYS.length).toBe(8);

      for (const language of ['zh-CN', 'en-US'] as const) {
        const body = template.bodies[language];
        expect(body.startsWith('# {{title}}')).toBe(true);
        expect(body).toContain('{{date}}');
        expect(body).toContain('{{author}}');
        // GFM table plus task list, no raw HTML and no emoji.
        expect(body).toMatch(/\n\| --- \|/);
        expect(body).toMatch(/- \[[ x]\]/);
        expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('localizes body selection while keeping metadata keys stable', () => {
    const zh = getBuiltInTemplates('zh-CN');
    const en = getBuiltInTemplates('en-US');

    expect(zh).toHaveLength(4);
    expect(en).toHaveLength(4);
    expect(zh[0].body).toContain('会议目标');
    expect(en[0].body).toContain('Objective');
    expect(zh[0].nameKey).toBe('templates.builtin.meetingMinutes.name');
    expect(en[0].nameKey).toBe(zh[0].nameKey);
    expect(getBuiltInTemplate('weekly-report', 'en-US')?.body).toContain(
      'Next Week'
    );
    expect(getBuiltInTemplate('does-not-exist')).toBeNull();
    expect(renderBuiltInTemplate('does-not-exist')).toBeNull();
  });

  it('renders a built-in with every supported variable replaced', () => {
    const output = renderBuiltInTemplate('weekly-report', 'en-US', {
      title: 'Week 1',
      author: 'Ada',
      now: FIXED_NOW,
    });

    expect(output).not.toBeNull();
    expect(output).toContain('# Week 1');
    expect(output).toContain(`Period: ${DATE}`);
    expect(output).toContain(`Generated: ${DATE} ${TIME}`);
    expect(output).toContain('Author: Ada');
    expect(output).not.toMatch(/\{\{(date|time|datetime|title|author)\}\}/);
  });
});

describe('template variable expansion', () => {
  it('replaces date, time, datetime, title, author and removes cursor', () => {
    const output = expandTemplate(
      '{{date}}|{{time}}|{{datetime}}|{{title}}|{{author}}|{{cursor}}',
      { title: 'Note', author: 'Ada', now: FIXED_NOW }
    );

    expect(output).toBe(`${DATE}|${TIME}|${DATE} ${TIME}|Note|Ada|`);
  });

  it('supports whitespace in tokens and repeated variables', () => {
    const output = expandTemplate('{{ date }} / {{  time  }} / {{date}}', {
      now: FIXED_NOW,
    });

    expect(output).toBe(`${DATE} / ${TIME} / ${DATE}`);
  });

  it('honors explicit date/time/datetime overrides over the clock', () => {
    const output = expandTemplate('{{date}}|{{time}}|{{datetime}}', {
      now: FIXED_NOW,
      date: '2030-12-31',
      time: '23:59',
      datetime: '2030-12-31T23:59:00',
    });

    expect(output).toBe('2030-12-31|23:59|2030-12-31T23:59:00');
  });

  it('leaves unknown or unsafe tokens untouched and never evaluates them', () => {
    const output = expandTemplate(
      '{{unknown}} {{constructor}} {{__proto__}} {{DATE}}',
      { title: 'x' }
    );

    expect(output).toBe(
      '{{unknown}} {{constructor}} {{__proto__}} {{DATE}}'
    );
  });

  it('does not re-expand replacement values (single pass)', () => {
    const output = expandTemplate('{{title}} / {{author}}', {
      title: '{{author}}',
      author: 'Ada',
    });

    expect(output).toBe('{{author}} / Ada');
  });

  it('treats replacement values literally, including dollar syntax', () => {
    const output = expandTemplate('{{title}}', {
      title: '$& $1 $$ $` $\'',
    });

    expect(output).toBe('$& $1 $$ $` $\'');
  });

  it('preserves Markdown, data:image payloads and unknown braces', () => {
    const body =
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n' +
      '![x](data:image/png;base64,AAAA)\n\n{{title}}';
    const output = expandTemplate(body, { title: 'T' });

    expect(output).toContain('| A | B |');
    expect(output).toContain('data:image/png;base64,AAAA');
    expect(output.endsWith('T')).toBe(true);
  });

  it('defaults missing title and author to empty strings', () => {
    expect(expandTemplate('[{{title}}][{{author}}]')).toBe('[][]');
  });
});

describe('custom snippet storage', () => {
  it('creates a snippet, persists it, and generates a safe UUID', () => {
    const storage = new MemoryStorage();
    const result = saveSnippet(
      { title: '  My notes  ', body: '# Hi\n', author: ' Ada ' },
      { storage, now: FIXED_NOW }
    );
    assertSaveOk(result);

    expect(result.created).toBe(true);
    expect(result.snippet.id).toMatch(UUID_RE);
    expect(result.snippet.title).toBe('My notes');
    expect(result.snippet.author).toBe('Ada');
    expect(result.snippet.createdAt).toBe(FIXED_NOW.getTime());
    expect(result.snippets).toHaveLength(1);

    const raw = storage.getItem(SNIPPETS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(result.snippet.id);
    expect(loadSnippets(storage)).toEqual(result.snippets);
  });

  it('rejects empty and over-long titles using Unicode code points', () => {
    const storage = new MemoryStorage();

    expect(
      saveSnippet({ title: ' \n\t ', body: '' }, { storage })
    ).toEqual({ ok: false, error: 'title-required' });

    expect(
      saveSnippet(
        { title: '界'.repeat(MAX_SNIPPET_TITLE_LENGTH + 1), body: '' },
        { storage }
      )
    ).toEqual({ ok: false, error: 'title-too-long' });

    const exact = saveSnippet(
      { title: '界'.repeat(MAX_SNIPPET_TITLE_LENGTH), body: '' },
      { storage }
    );
    assertSaveOk(exact);
    expect(Array.from(exact.snippet.title)).toHaveLength(
      MAX_SNIPPET_TITLE_LENGTH
    );
  });

  it('enforces the 256 KiB body limit by UTF-8 byte length', () => {
    const storage = new MemoryStorage();
    const asciiExact = 'a'.repeat(MAX_SNIPPET_BODY_BYTES);

    const exact = saveSnippet(
      { title: 'Exact', body: asciiExact },
      { storage }
    );
    assertSaveOk(exact);
    expect(utf8ByteLength(exact.snippet.body)).toBe(MAX_SNIPPET_BODY_BYTES);

    expect(
      saveSnippet(
        { title: 'Too big', body: `${asciiExact}a` },
        { storage }
      )
    ).toEqual({ ok: false, error: 'body-too-large' });

    // 87,381 CJK characters = 262,143 bytes; one ASCII byte still fits.
    const cjkBytes = Math.floor(MAX_SNIPPET_BODY_BYTES / 3);
    const cjk = '汉'.repeat(cjkBytes);
    expect(utf8ByteLength(`${cjk}a`)).toBe(MAX_SNIPPET_BODY_BYTES);
    const unicodeExact = saveSnippet(
      { title: 'CJK exact', body: `${cjk}a` },
      { storage }
    );
    assertSaveOk(unicodeExact);

    expect(
      saveSnippet(
        { title: 'CJK big', body: `${cjk}ab` },
        { storage }
      )
    ).toEqual({ ok: false, error: 'body-too-large' });
  });

  it('caps custom snippets at 50 and rejects the 51st', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < MAX_SNIPPETS; index += 1) {
      assertSaveOk(
        saveSnippet(
          { title: `Snippet ${index}`, body: `body ${index}` },
          { storage, now: FIXED_NOW }
        )
      );
    }
    expect(loadSnippets(storage)).toHaveLength(MAX_SNIPPETS);

    expect(
      saveSnippet({ title: 'One too many', body: '' }, { storage })
    ).toEqual({ ok: false, error: 'limit-reached' });
    expect(loadSnippets(storage)).toHaveLength(MAX_SNIPPETS);
  });

  it('updates an existing snippet by id and keeps createdAt', () => {
    const storage = new MemoryStorage();
    const first = saveSnippet(
      { title: 'First', body: 'one', author: 'Ada' },
      { storage, now: FIXED_NOW }
    );
    assertSaveOk(first);

    const later = new Date(2026, 0, 3, 4, 5, 6);
    const second = saveSnippet(
      { title: 'Second', body: 'two', author: 'Grace' },
      { storage, id: first.snippet.id, now: later }
    );
    assertSaveOk(second);

    expect(second.created).toBe(false);
    expect(second.snippet.id).toBe(first.snippet.id);
    expect(second.snippet.createdAt).toBe(first.snippet.createdAt);
    expect(second.snippet.updatedAt).toBe(later.getTime());
    expect(second.snippets).toHaveLength(1);
    expect(second.snippet.body).toBe('two');
    expect(loadSnippets(storage)[0].title).toBe('Second');
  });

  it('deletes snippets and treats a missing id as a no-op', () => {
    const storage = new MemoryStorage();
    const first = saveSnippet({ title: 'A', body: 'a' }, { storage });
    const second = saveSnippet({ title: 'B', body: 'b' }, { storage });
    assertSaveOk(first);
    assertSaveOk(second);

    const deleted = deleteSnippet(first.snippet.id, { storage });
    assertDeleteOk(deleted);
    expect(deleted.deleted).toBe(true);
    expect(deleted.snippets.map((snippet) => snippet.title)).toEqual(['B']);

    const missing = deleteSnippet(first.snippet.id, { storage });
    assertDeleteOk(missing);
    expect(missing.deleted).toBe(false);
    expect(missing.snippets).toHaveLength(1);
  });

  it('reports unavailable storage and write failures without throwing', () => {
    expect(
      saveSnippet({ title: 'A', body: 'a' }, { storage: null })
    ).toEqual({ ok: false, error: 'storage-unavailable' });
    expect(deleteSnippet('x', { storage: null })).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });

    const failing = new MemoryStorage();
    failing.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(
      saveSnippet({ title: 'A', body: 'a' }, { storage: failing })
    ).toEqual({ ok: false, error: 'storage-write-failed' });

    const brokenRead: SnippetStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    expect(loadSnippets(brokenRead)).toEqual([]);
    // A missing id is a no-op and therefore never attempts a write.
    expect(deleteSnippet('x', { storage: brokenRead })).toEqual({
      ok: true,
      snippets: [],
      deleted: false,
    });

    const deleteFailure = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: JSON.stringify([
        {
          id: VALID_ID,
          title: 'A',
          body: 'a',
          author: '',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    });
    deleteFailure.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(deleteSnippet(VALID_ID, { storage: deleteFailure })).toEqual({
      ok: false,
      error: 'storage-write-failed',
    });
  });

  it('returns [] for corrupt JSON and non-array payloads', () => {
    const corrupt = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: '{not-json',
    });
    expect(loadSnippets(corrupt)).toEqual([]);

    const objectPayload = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: '{"snippets":[]}',
    });
    expect(loadSnippets(objectPayload)).toEqual([]);

    const mixed = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: JSON.stringify([
        null,
        42,
        [],
        { title: '', body: 'empty title' },
        { title: 'No body', body: 42 },
      ]),
    });
    expect(loadSnippets(mixed)).toEqual([]);
  });

  it('sanitizes stored records, repairs ids, and drops invalid entries', () => {
    const storage = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: JSON.stringify([
        {
          id: 'not-a-uuid',
          title: '  Trimmed  ',
          body: '# A',
          author: 7,
          createdAt: 'bad',
        },
        {
          id: VALID_ID,
          title: 'B',
          body: '# B',
          author: '  Ada  ',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: VALID_ID,
          title: 'C',
          body: '# C',
          author: 'Grace',
          createdAt: 3,
          updatedAt: 4,
        },
        { id: 'x', title: '   ', body: 'dropped' },
        {
          id: 'y',
          title: 'x'.repeat(MAX_SNIPPET_TITLE_LENGTH + 20),
          body: 'long title',
        },
        { id: 'z', title: 'Too big', body: 'a'.repeat(MAX_SNIPPET_BODY_BYTES + 1) },
      ]),
    });

    const snippets = loadSnippets(storage);
    expect(snippets).toHaveLength(4);
    expect(snippets[0].title).toBe('Trimmed');
    expect(snippets[0].author).toBe('');
    expect(isSafeSnippetId(snippets[0].id)).toBe(true);
    expect(snippets[0].id).not.toBe('not-a-uuid');
    expect(typeof snippets[0].createdAt).toBe('number');

    expect(snippets[1].id).toBe(VALID_ID);
    expect(snippets[1].author).toBe('Ada');
    expect(snippets[2].id).not.toBe(VALID_ID);
    expect(new Set(snippets.map((snippet) => snippet.id)).size).toBe(4);

    expect(Array.from(snippets[3].title)).toHaveLength(
      MAX_SNIPPET_TITLE_LENGTH
    );
  });

  it('caps loaded records at 50 and preserves their order', () => {
    const records = Array.from({ length: MAX_SNIPPETS + 10 }, (_, index) => ({
      id: createSnippetId(),
      title: `S${index}`,
      body: `body ${index}`,
      author: '',
      createdAt: index,
      updatedAt: index,
    }));
    const storage = new MemoryStorage({
      [SNIPPETS_STORAGE_KEY]: JSON.stringify(records),
    });

    const snippets = loadSnippets(storage);
    expect(snippets).toHaveLength(MAX_SNIPPETS);
    expect(snippets[0].title).toBe('S0');
    expect(snippets[MAX_SNIPPETS - 1].title).toBe(`S${MAX_SNIPPETS - 1}`);
  });

  it('persists and trims the custom snippet author separately', () => {
    const storage = new MemoryStorage();

    expect(loadSnippetAuthor(storage)).toBe('');
    expect(saveSnippetAuthor('  Ada  ', storage)).toBe(true);
    expect(storage.getItem(SNIPPET_AUTHOR_STORAGE_KEY)).toBe('Ada');
    expect(loadSnippetAuthor(storage)).toBe('Ada');

    expect(saveSnippetAuthor('A'.repeat(MAX_SNIPPET_AUTHOR_LENGTH + 20), storage)).toBe(
      true
    );
    expect(loadSnippetAuthor(storage)).toHaveLength(MAX_SNIPPET_AUTHOR_LENGTH);
    expect(saveSnippetAuthor('blocked', null)).toBe(false);
  });

  it('generates unique v4 UUIDs and validates safe ids', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const id = createSnippetId();
      expect(id).toMatch(UUID_RE);
      expect(isSafeSnippetId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(100);

    expect(isSafeSnippetId(VALID_ID)).toBe(true);
    expect(isSafeSnippetId('../../etc/passwd')).toBe(false);
    expect(isSafeSnippetId('')).toBe(false);
    expect(isSafeSnippetId(null)).toBe(false);
    expect(isSafeSnippetId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isSafeSnippetId('123e4567-e89b-92d3-a456-426614174000')).toBe(false);
  });

  it('normalizes titles defensively', () => {
    expect(normalizeSnippetTitle('  hello  ')).toBe('hello');
    expect(normalizeSnippetTitle(null)).toBe('');
    expect(normalizeSnippetTitle(42)).toBe('');
    expect(normalizeSnippetTitle('\n\t')).toBe('');
  });
});
