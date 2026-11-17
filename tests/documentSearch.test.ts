import { describe, expect, it } from 'vitest';
import {
  PER_TAB_MATCH_LIMIT,
  SearchError,
  TOTAL_MATCH_LIMIT,
  applySearchReplace,
  buildLineStarts,
  buildReplacePreviewSamples,
  buildSearchPattern,
  collectCodeRanges,
  collectEmbeddedDataUrlRanges,
  formatSearchSnippet,
  offsetToLineColumn,
  prepareReplacements,
  searchDocuments,
  selectSearchTabs,
  type SearchOptions,
  type SearchTabInput,
} from '../src/lib/documentSearch';

const baseOptions: SearchOptions = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

function options(overrides: Partial<SearchOptions> = {}): SearchOptions {
  return { ...baseOptions, ...overrides };
}

function doc(
  id: string,
  content: string,
  extra: Partial<SearchTabInput> = {}
): SearchTabInput {
  return { id, title: `Doc ${id}`, content, kind: 'document', ...extra };
}

describe('buildSearchPattern', () => {
  it('treats literal text literally and is case-insensitive by default', () => {
    const pattern = buildSearchPattern('a.b(c)', options({ query: 'a.b(c)' }));
    const content = 'A.B(C) axb(c)';
    const matches = [...content.matchAll(pattern)];
    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(0);
  });

  it('honours case sensitivity', () => {
    const insensitive = searchDocuments(
      [doc('a', 'Alpha alpha ALPHA')],
      options({ query: 'alpha' })
    );
    const sensitive = searchDocuments(
      [doc('a', 'Alpha alpha ALPHA')],
      options({ query: 'alpha', caseSensitive: true })
    );
    expect(insensitive.totalMatches).toBe(3);
    expect(sensitive.totalMatches).toBe(1);
  });

  it('uses Unicode whole-word boundaries for Latin and CJK text', () => {
    const latin = searchDocuments(
      [doc('a', 'cat concat cat_cat cat. cat')],
      options({ query: 'cat', wholeWord: true })
    );
    expect(
      latin.results[0].matches.map((match) => contentSlice('cat concat cat_cat cat. cat', match))
    ).toEqual(['cat', 'cat', 'cat']);

    const cjkContent = '文档 本文档 文档，测试文档。';
    const cjk = searchDocuments(
      [doc('a', cjkContent)],
      options({ query: '文档', wholeWord: true })
    );
    expect(cjk.totalMatches).toBe(2);
    expect(cjk.results[0].matches.map((match) => match.from)).toEqual([0, 7]);
  });

  it('reports invalid and empty regular expressions with stable error codes', () => {
    try {
      buildSearchPattern('([', options({ query: '([', regex: true }));
      throw new Error('expected a SearchError');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).code).toBe('invalid-regex');
      expect((error as SearchError).detail).toBeTruthy();
    }

    try {
      buildSearchPattern('', options({ query: '' }));
      throw new Error('expected a SearchError');
    } catch (error) {
      expect((error as SearchError).code).toBe('empty-query');
    }
  });

  it('does not hang on zero-width expressions', () => {
    const outcome = searchDocuments(
      [doc('a', 'abcabc')],
      options({ query: '(?=a)', regex: true })
    );
    expect(outcome.totalMatches).toBe(0);
  });
});

function contentSlice(content: string, match: { from: number; to: number }) {
  return content.slice(match.from, match.to);
}

describe('searchDocuments', () => {
  it('reports accurate offsets, lines and columns across multiple lines', () => {
    const content = 'one two\none two\nthree one';
    const outcome = searchDocuments([doc('a', content)], options({ query: 'one' }));
    const matches = outcome.results[0].matches;

    expect(outcome.totalMatches).toBe(3);
    expect(matches.map((match) => contentSlice(content, match))).toEqual([
      'one',
      'one',
      'one',
    ]);
    expect(matches.map((match) => [match.line, match.column])).toEqual([
      [1, 1],
      [2, 1],
      [3, 7],
    ]);
    expect(matches.map((match) => match.from)).toEqual([0, 8, 22]);
    expect(outcome.protectedMatches).toBe(0);
  });

  it('supports multi-tab counts while skipping diff tabs', () => {
    const outcome = searchDocuments(
      [
        doc('a', 'needle needle'),
        doc('b', 'no hits here'),
        doc('c', 'needle', { kind: 'diff' }),
        doc('d', 'needle'),
      ],
      options({ query: 'needle' })
    );

    expect(outcome.results.map((result) => result.tabId)).toEqual(['a', 'b', 'd']);
    expect(outcome.totalMatches).toBe(3);
    expect(outcome.results[0].matches).toHaveLength(2);
    expect(outcome.results[1].matches).toHaveLength(0);
  });

  it('caps per-tab results and flags truncation', () => {
    const content = 'x '.repeat(PER_TAB_MATCH_LIMIT + 5);
    const outcome = searchDocuments(
      [doc('a', content)],
      options({ query: 'x' })
    );

    expect(outcome.results[0].matches).toHaveLength(PER_TAB_MATCH_LIMIT);
    expect(outcome.totalMatches).toBe(PER_TAB_MATCH_LIMIT);
    expect(outcome.results[0].truncated).toBe(true);
    expect(outcome.truncated).toBe(true);
  });

  it('caps the global result set at 5000 matches', () => {
    const tabs = Array.from({ length: 7 }, (_, index) =>
      doc(String(index), 'y '.repeat(PER_TAB_MATCH_LIMIT))
    );
    const outcome = searchDocuments(tabs, options({ query: 'y' }));

    expect(outcome.totalMatches).toBe(TOTAL_MATCH_LIMIT);
    expect(outcome.truncated).toBe(true);
  });

  it('skips fenced code blocks and inline code when requested', () => {
    const content = [
      '# Title',
      '',
      '`inline` text',
      '',
      '```js',
      'const inline = 1;',
      '```',
      '',
      'outside',
    ].join('\n');

    const withCode = searchDocuments([doc('a', content)], options({ query: 'inline' }));
    const withoutCode = searchDocuments(
      [doc('a', content)],
      options({ query: 'inline', skipCode: true })
    );

    expect(withCode.totalMatches).toBe(2);
    expect(withoutCode.totalMatches).toBe(0);
    expect(withoutCode.codeMatches).toBe(2);
    expect(collectCodeRanges(content)).toHaveLength(2);
  });

  it('protects embedded data: destinations in Markdown, HTML and definitions', () => {
    const content = [
      '![alt](data:image/png;base64,QUJDREVG)',
      '<img src="data:image/png;base64,QUJDREVG" alt="pic">',
      '[ref]: data:image/png;base64,QUJDREVG',
      '',
      'Use [link][ref] and ![pic][ref].',
      '[unused]: data:image/png;base64,WFla',
    ].join('\n');

    const payload = searchDocuments([doc('a', content)], options({ query: 'QUJDREVG' }));
    expect(payload.totalMatches).toBe(0);
    expect(payload.protectedMatches).toBeGreaterThan(0);

    const unused = searchDocuments([doc('a', content)], options({ query: 'WFla' }));
    expect(unused.totalMatches).toBe(0);

    const alt = searchDocuments([doc('a', content)], options({ query: 'alt' }));
    expect(alt.totalMatches).toBe(2);

    const ranges = collectEmbeddedDataUrlRanges(content);
    expect(ranges.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps BOM and CRLF while reporting visible line and column numbers', () => {
    const content = '\uFEFF# Title\r\nsecond target\r\nthird';
    const outcome = searchDocuments([doc('a', content)], options({ query: 'target' }));
    const match = outcome.results[0].matches[0];

    expect(contentSlice(content, match)).toBe('target');
    expect([match.line, match.column]).toEqual([2, 8]);

    const title = searchDocuments([doc('a', content)], options({ query: 'Title' }));
    expect([title.results[0].matches[0].line, title.results[0].matches[0].column]).toEqual([
      1, 3,
    ]);
  });

  it('maps offsets through the shared line index helper', () => {
    const content = 'a\nbc\r\nd';
    const starts = buildLineStarts(content);
    expect(offsetToLineColumn(content, starts, 2)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineColumn(content, starts, 3)).toEqual({ line: 2, column: 2 });
    expect(offsetToLineColumn(content, starts, 6)).toEqual({ line: 3, column: 1 });
  });
});

describe('applySearchReplace', () => {
  it('expands capture groups and JavaScript replacement tokens in regex mode', () => {
    const content = 'alice@example bob@test';
    const search = searchDocuments(
      [doc('a', content)],
      options({ query: '(\\w+)@(\\w+)', regex: true })
    );
    const matches = search.results[0].matches;

    const result = applySearchReplace(
      content,
      matches,
      options({ query: '(\\w+)@(\\w+)', regex: true }),
      '$2 <$1> $& $$'
    );
    expect(result.applied).toBe(2);
    expect(result.content).toBe(
      'example <alice> alice@example $ test <bob> bob@test $'
    );
  });

  it('keeps $ sequences verbatim in literal mode', () => {
    const content = 'price';
    const search = searchDocuments([doc('a', content)], options({ query: 'price' }));
    const result = applySearchReplace(
      content,
      search.results[0].matches,
      options({ query: 'price' }),
      '$1$&$$'
    );
    expect(result.content).toBe('$1$&$$');
  });

  it('preserves CRLF and BOM outside the replaced range', () => {
    const content = '\uFEFFone\r\ntwo\r\none';
    const search = searchDocuments([doc('a', content)], options({ query: 'one' }));
    const result = applySearchReplace(
      content,
      search.results[0].matches,
      options({ query: 'one' }),
      'ONE'
    );

    expect(result.content).toBe('\uFEFFONE\r\ntwo\r\nONE');
    expect(result.applied).toBe(2);
  });

  it('rejects stale matches instead of replacing the wrong range', () => {
    const original = 'hello world';
    const searchOptions = options({ query: 'world', caseSensitive: true });
    const search = searchDocuments([doc('a', original)], searchOptions);

    expect(() =>
      applySearchReplace(
        'hello WORLD',
        search.results[0].matches,
        searchOptions,
        'earth'
      )
    ).toThrow(SearchError);

    expect(() =>
      applySearchReplace(
        'hello worl',
        search.results[0].matches,
        searchOptions,
        'earth'
      )
    ).toThrow(SearchError);

    const overlapping = search.results[0].matches.slice();
    expect(() =>
      applySearchReplace(
        'hello world',
        [overlapping[0], { ...overlapping[0], from: 0, to: 5 }],
        searchOptions,
        'earth'
      )
    ).toThrow(SearchError);
  });

  it('replaces only the selected match for "replace current"', () => {
    const content = 'cat cat cat';
    const search = searchDocuments([doc('a', content)], options({ query: 'cat' }));
    const selected = search.results[0].matches[1];

    const result = applySearchReplace(
      content,
      [selected],
      options({ query: 'cat' }),
      'dog'
    );
    expect(result.content).toBe('cat dog cat');
  });

  it('rejects replacement buffers above the configured size limit', () => {
    const content = 'abc def';
    const searchOptions = options({ query: 'abc' });
    const search = searchDocuments([doc('a', content)], searchOptions);

    try {
      applySearchReplace(
        content,
        search.results[0].matches,
        searchOptions,
        'x'.repeat(20),
        10
      );
      throw new Error('expected a SearchError');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).code).toBe('output-too-large');
    }

    try {
      prepareReplacements(
        [doc('a', content)],
        search.results,
        searchOptions,
        'x'.repeat(20),
        10
      );
      throw new Error('expected a SearchError');
    } catch (error) {
      expect((error as SearchError).code).toBe('output-too-large');
    }
  });
});

describe('snippets and previews', () => {
  it('never exposes large Base64 payloads in a snippet', () => {
    const payload = 'A'.repeat(2000);
    const content = `alt text ![pic](data:image/png;base64,${payload}) tail`;
    const search = searchDocuments([doc('a', content)], options({ query: 'alt' }));
    const match = search.results[0].matches[0];
    const snippet = formatSearchSnippet(content, match.from, match.to);

    expect(snippet.match).toBe('alt');
    expect(snippet.after).toContain('data:image/png;base64,…');
    expect(snippet.after).not.toContain('A'.repeat(100));
    expect(
      snippet.before.length + snippet.match.length + snippet.after.length
    ).toBeLessThan(400);
  });

  it('protects data: destinations even when a regex spans across them', () => {
    const content = 'alt text ![pic](data:image/png;base64,QUJDREVG) END';
    const outcome = searchDocuments(
      [doc('a', content)],
      options({ query: 'alt.*END', regex: true })
    );

    expect(outcome.totalMatches).toBe(0);
    expect(outcome.protectedMatches).toBe(1);
  });

  it('protects whitespace/quoted SVG payloads in angle Markdown destinations', () => {
    const content =
      "![svg](<data:image/svg+xml,%3Csvg width='1' height='1'%3E%3C/svg%3E>) tail";
    const inside = searchDocuments(
      [doc('a', content)],
      options({ query: 'width' })
    );
    const outside = searchDocuments(
      [doc('a', content)],
      options({ query: 'tail' })
    );

    expect(inside.totalMatches).toBe(0);
    expect(inside.protectedMatches).toBe(1);
    expect(outside.totalMatches).toBe(1);
  });

  it('protects quoted HTML src attributes containing spaces or line breaks', () => {
    const svg =
      '<img src="data:image/svg+xml,%3Csvg width=\'1\' height=\'1\'%3E%3C/svg%3E" alt="pic">';
    const base64 = '<img src="data:image/png;base64,AAAA\nBBBB" alt="pic">';

    expect(
      searchDocuments([doc('a', svg)], options({ query: 'width' })).totalMatches
    ).toBe(0);
    expect(
      searchDocuments([doc('a', base64)], options({ query: 'BBBB' })).totalMatches
    ).toBe(0);
    // Text outside the attribute value remains searchable.
    expect(
      searchDocuments([doc('a', svg)], options({ query: 'pic' })).totalMatches
    ).toBe(1);
  });

  it('protects the whole srcset attribute, including later candidates', () => {
    const content =
      '<img srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,CCCC 2x" alt="pic">';
    const outcome = searchDocuments([doc('a', content)], options({ query: 'CCCC' }));

    expect(outcome.totalMatches).toBe(0);
    expect(outcome.protectedMatches).toBeGreaterThan(0);
  });

  it('protects balanced parentheses inside a bare SVG data destination', () => {
    const content = '![x](data:image/svg+xml,%3Csvg%3E(foo)%3C%2Fsvg%3E) foo';
    const outcome = searchDocuments([doc('svg', content)], options({ query: 'foo' }));
    expect(outcome.totalMatches).toBe(1);
    expect(outcome.results[0].matches[0].from).toBe(content.lastIndexOf('foo'));
    expect(outcome.protectedMatches).toBe(1);
  });

  it('protects unused reference definitions with whitespace in the destination', () => {
    const content = "[unused]: <data:image/svg+xml,%3Csvg width='1'%3E>";
    const outcome = searchDocuments([doc('a', content)], options({ query: 'width' }));

    expect(outcome.totalMatches).toBe(0);
    expect(outcome.protectedMatches).toBeGreaterThan(0);
  });

  it('builds a before/after preview using capture replacement', () => {
    const content = 'name: alice\nname: bob';
    const search = searchDocuments(
      [doc('a', content, { title: 'People' })],
      options({ query: 'name: (\\w+)', regex: true })
    );
    const samples = buildReplacePreviewSamples(
      [doc('a', content, { title: 'People' })],
      search.results,
      options({ query: 'name: (\\w+)', regex: true }),
      'user: $1',
      1
    );

    expect(samples).toHaveLength(1);
    expect(samples[0].title).toBe('People');
    expect(samples[0].before).toContain('name: alice');
    expect(samples[0].after).toContain('user: alice');
    expect(samples[0].after).not.toContain('name: alice');
  });

  it('prepares worker-side expansions that can replace a single match without re-running regex', () => {
    const content = 'cat cat cat';
    const searchOptions = options({ query: 'cat' });
    const search = searchDocuments([doc('a', content)], searchOptions);
    const prepared = prepareReplacements(
      [doc('a', content)],
      search.results,
      searchOptions,
      'dog'
    );

    expect(prepared.updates[0].content).toBe('dog dog dog');
    expect(prepared.expansions).toHaveLength(3);

    // Mirrors the UI's "replace current": splice one stored expansion only.
    const target = prepared.expansions[1];
    const single = `${content.slice(0, target.from)}${target.text}${content.slice(
      target.to
    )}`;
    expect(single).toBe('cat dog cat');
  });

  it('keeps CRLF out of preview snippets and preserves it in prepared buffers', () => {
    const content = 'foo\r\nbar foo\r\n';
    const searchOptions = options({ query: 'foo' });
    const search = searchDocuments([doc('a', content)], searchOptions);
    const prepared = prepareReplacements(
      [doc('a', content)],
      search.results,
      searchOptions,
      'FOO'
    );

    expect(prepared.updates[0].content).toBe('FOO\r\nbar FOO\r\n');

    const samples = buildReplacePreviewSamples(
      [doc('a', content)],
      search.results,
      searchOptions,
      'FOO',
      2,
      prepared.expansions
    );
    expect(samples.length).toBe(2);
    for (const sample of samples) {
      expect(sample.before).not.toContain('\r');
      expect(sample.before).not.toContain('\n');
      expect(sample.after).not.toContain('\r');
      expect(sample.after).not.toContain('\n');
    }
  });

  it('has nothing to preview for zero-width or empty searches', () => {
    const content = 'abc';
    const zeroWidth = searchDocuments(
      [doc('a', content)],
      options({ query: '(?=a)', regex: true })
    );
    expect(zeroWidth.results[0].matches).toHaveLength(0);
    expect(
      buildReplacePreviewSamples(
        [doc('a', content)],
        zeroWidth.results,
        options({ query: '(?=a)', regex: true }),
        'x'
      )
    ).toEqual([]);
    expect(
      prepareReplacements(
        [doc('a', content)],
        zeroWidth.results,
        options({ query: '(?=a)', regex: true }),
        'x'
      )
    ).toEqual({ updates: [], expansions: [] });
  });
});

describe('selectSearchTabs', () => {
  const tabs: SearchTabInput[] = [
    doc('a', 'alpha'),
    doc('b', 'beta'),
    doc('diff', 'alpha', { kind: 'diff' }),
  ];

  it('uses the active tab for the current scope', () => {
    expect(selectSearchTabs(tabs, 'b', 'current').docs.map((item) => item.id)).toEqual([
      'b',
    ]);
  });

  it('excludes diff tabs in the all-documents scope', () => {
    const selection = selectSearchTabs(tabs, 'diff', 'all');
    expect(selection.docs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(selection.activeUnavailable).toBe(false);
  });

  it('reports an unavailable current scope for a diff tab', () => {
    const selection = selectSearchTabs(tabs, 'diff', 'current');
    expect(selection.docs).toEqual([]);
    expect(selection.activeUnavailable).toBe(true);
  });
});
