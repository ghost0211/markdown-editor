import { describe, expect, it, vi } from 'vitest';
import {
  analyzeDocumentQuality,
  checkLocalDocumentResources,
  type QualityIssue,
} from '../src/lib/documentQuality';

function rulesOf(issues: readonly QualityIssue[]): string[] {
  return issues.map((issue) => issue.rule);
}

function issuesForRule(
  issues: readonly QualityIssue[],
  rule: string
): QualityIssue[] {
  return issues.filter((issue) => issue.rule === rule);
}

describe('analyzeDocumentQuality — headings', () => {
  it('returns no issues for a clean document', () => {
    const markdown = [
      '# Title',
      '',
      'Intro with [a safe link](https://example.com).',
      '',
      '## Section',
      '',
      '![diagram](diagram.png)',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');

    expect(analyzeDocumentQuality(markdown)).toEqual([]);
  });

  it('reports a heading level jump with the real line and column', () => {
    const issues = analyzeDocumentQuality('# A\n\n### B');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: 'heading-level-jump',
      severity: 'warning',
      line: 3,
      column: 1,
    });
    expect(issues[0].message).toContain('H1');
    expect(issues[0].message).toContain('H3');
  });

  it('allows descending headings and a document that starts below H1', () => {
    expect(analyzeDocumentQuality('## Start\n\n### Next\n\n# Back')).toEqual([]);
  });

  it('reports empty ATX headings but not headings with inline code', () => {
    const empty = analyzeDocumentQuality('#\n\n##   ');
    expect(issuesForRule(empty, 'empty-heading')).toHaveLength(2);
    expect(empty.every((issue) => issue.severity === 'warning')).toBe(true);

    expect(analyzeDocumentQuality('# `code`')).toEqual([]);
  });

  it('reports duplicate heading text as info with the first occurrence line', () => {
    const issues = analyzeDocumentQuality('# Intro\n\n## Details\n\n# Intro');
    const duplicates = issuesForRule(issues, 'duplicate-heading');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      severity: 'info',
      line: 5,
    });
    expect(duplicates[0].message).toContain('Intro');
    expect(duplicates[0].message).toContain('第 1 行');

    // Inline formatting is compared by visible text, not by raw source.
    const formatted = analyzeDocumentQuality('# Intro\n\n## **Intro**');
    expect(issuesForRule(formatted, 'duplicate-heading')).toHaveLength(1);
  });
});

describe('analyzeDocumentQuality — images and links', () => {
  it('reports an image without alternative text', () => {
    const issues = analyzeDocumentQuality(
      '![diagram](diagram.png)\n\n![   ](diagram.png)'
    );
    const altIssues = issuesForRule(issues, 'image-empty-alt');
    expect(altIssues).toHaveLength(1);
    expect(altIssues[0]).toMatchObject({ line: 3, column: 1, severity: 'warning' });
  });

  it('reports empty link and image destinations separately', () => {
    const issues = analyzeDocumentQuality('[empty]() and ![alt]()');
    expect(rulesOf(issues)).toEqual([
      'empty-link-address',
      'empty-image-address',
    ]);
    expect(issues[0]).toMatchObject({ line: 1, column: 1 });
    expect(issues[1]).toMatchObject({ line: 1, column: 15 });
  });

  it('does not flag ordinary links, image titles or anchors', () => {
    const markdown = [
      '[site](https://example.com)',
      '[jump](#section)',
      '![alt](diagram.png "a title")',
    ].join('\n\n');
    expect(analyzeDocumentQuality(markdown)).toEqual([]);
  });
});

describe('analyzeDocumentQuality — code, comments, math and front matter', () => {
  it('reports an unclosed code fence as an error on the opening line', () => {
    const markdown = ['# Before', '', '```js', 'const value = 1;'].join('\n');
    const issues = analyzeDocumentQuality(markdown);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: 'unclosed-code-fence',
      severity: 'error',
      line: 3,
      column: 1,
    });

    const tilde = analyzeDocumentQuality(['~~~', 'code'].join('\n'));
    expect(tilde[0]).toMatchObject({
      rule: 'unclosed-code-fence',
      line: 1,
    });
  });

  it('does not report a closed fence or parse its body as Markdown', () => {
    const markdown = [
      '# H1',
      '',
      '```md',
      '# not a heading',
      '[empty]()',
      '![](x)',
      '```',
      '',
      '## H2',
    ].join('\n');
    expect(analyzeDocumentQuality(markdown)).toEqual([]);
  });

  it('ignores escaped heading/link/image syntax', () => {
    const markdown = [
      '\\# not a heading',
      '',
      '\\[empty]()',
      '',
      '\\![](x)',
      '',
      '\\!\\[alt]()',
    ].join('\n');
    expect(analyzeDocumentQuality(markdown)).toEqual([]);
  });

  it('ignores HTML comments and math blocks', () => {
    const markdown = [
      '<!-- # hidden heading',
      '[empty]()',
      '![](x)',
      '-->',
      '',
      '$$',
      '# not a heading',
      '[empty]()',
      '$$',
      '',
      '# Real',
    ].join('\n');
    expect(analyzeDocumentQuality(markdown)).toEqual([]);
  });

  it('reports unclosed YAML front matter but not a closed block', () => {
    const unclosed = analyzeDocumentQuality(
      ['---', 'title: Draft', '', '# H1'].join('\n')
    );
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0]).toMatchObject({
      rule: 'unclosed-frontmatter',
      severity: 'error',
      line: 1,
      column: 1,
    });

    expect(
      analyzeDocumentQuality(['---', 'title: Draft', '---', '', '# H1'].join('\n'))
    ).toEqual([]);
  });

  it('reports unclosed TOML front matter and accepts a closed block', () => {
    expect(
      analyzeDocumentQuality(
        ['+++', 'title = "Draft"', '', '## H2'].join('\n')
      ).map((issue) => issue.rule)
    ).toEqual(['unclosed-frontmatter']);

    expect(
      analyzeDocumentQuality(
        ['+++', 'title = "Draft"', '+++', '', '## H2'].join('\n')
      )
    ).toEqual([]);
  });

  it('does not mistake a leading horizontal rule for unclosed front matter', () => {
    expect(analyzeDocumentQuality(['---', '', 'Plain paragraph'].join('\n'))).toEqual(
      []
    );
  });

  it('localizes messages without mixing languages', () => {
    const markdown = ['# A', '', '```js', 'const value = 1;'].join('\n');
    const english = analyzeDocumentQuality(markdown, undefined, 'en-US');
    expect(english[0].message).toBe('Unclosed code fence');
    expect(english[0].message).not.toContain('未闭合');

    const chinese = analyzeDocumentQuality(markdown, undefined, 'zh-CN');
    expect(chinese[0].message).toBe('代码块围栏未闭合');
  });

  it('returns stable, unique ids and a deterministic line order', () => {
    const issues = analyzeDocumentQuality('# A\n\n### B\n\n![](x)');
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(2);
    expect(issues.map((issue) => issue.line)).toEqual([3, 5]);
    expect(issues.every((issue) => issue.id.includes(issue.rule))).toBe(true);
  });
});

describe('checkLocalDocumentResources — injected stat loader', () => {
  it('checks only local resources and never touches remote or embedded images', async () => {
    const readSize = vi.fn(async (path: string) =>
      path.endsWith('photo.png') ? 1024 : 2048
    );
    const markdown = [
      '![photo](assets/photo.png)',
      '',
      '[spec](assets/spec.pdf)',
      '',
      '![remote](https://example.com/a.png)',
      '',
      '![inline](data:image/png;base64,AAAA)',
    ].join('\n');

    const issues = await checkLocalDocumentResources(
      markdown,
      'D:\\docs\\notes.md',
      readSize
    );

    expect(issues).toEqual([]);
    expect(readSize).toHaveBeenCalledTimes(2);
    expect(readSize.mock.calls.map(([path]) => path)).toEqual([
      'D:/docs/assets/photo.png',
      'D:/docs/assets/spec.pdf',
    ]);
  });

  it('reports a missing local file as an error without leaking the full path', async () => {
    const readSize = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT',
      });
    });

    const issues = await checkLocalDocumentResources(
      '![photo](assets/photo.png)',
      'D:\\docs\\notes.md',
      readSize
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: 'resource-missing',
      severity: 'error',
      line: 1,
      column: 10,
    });
    expect(issues[0].message).toContain('photo.png');
    expect(issues[0].message).not.toContain('assets/');
    expect(issues[0].message).not.toContain('D:');
  });

  it('distinguishes an unreadable file from a missing one', async () => {
    const readSize = vi.fn(async () => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    });

    const issues = await checkLocalDocumentResources(
      '![photo](assets/photo.png)',
      'D:\\docs\\notes.md',
      readSize
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('resource-unresolved');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('无法解析或读取本地资源');
  });

  it('reports unresolved relative paths for an unsaved document without calling the loader', async () => {
    const readSize = vi.fn(async () => 10);
    const issues = await checkLocalDocumentResources(
      '![photo](assets/photo.png)',
      undefined,
      readSize
    );

    expect(readSize).not.toHaveBeenCalled();
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('resource-unresolved');
    expect(issues[0].line).toBe(1);
  });

  it('deduplicates repeated references to the same local path', async () => {
    const readSize = vi.fn(async () => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    });
    const markdown = [
      '![one](assets/photo.png)',
      '',
      '![two](./assets/photo.png)',
    ].join('\n');

    const issues = await checkLocalDocumentResources(
      markdown,
      'D:\\docs\\notes.md',
      readSize
    );

    expect(readSize).toHaveBeenCalledTimes(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
  });

  it('treats an invalid stat result as unresolved', async () => {
    const readSize = vi.fn(async () => Number.NaN);
    const issues = await checkLocalDocumentResources(
      '![photo](assets/photo.png)',
      'D:\\docs\\notes.md',
      readSize
    );
    expect(issues[0].rule).toBe('resource-unresolved');
  });

  it('localizes resource errors', async () => {
    const readSize = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const issues = await checkLocalDocumentResources(
      '![photo](assets/photo.png)',
      'D:\\docs\\notes.md',
      readSize,
      'en-US'
    );
    expect(issues[0].message).toBe('Local resource is missing: photo.png');
  });

  it('ignores local references inside code, comments and math', async () => {
    const readSize = vi.fn(async () => 10);
    const markdown = [
      '```md',
      '![inside](assets/a.png)',
      '```',
      '',
      '<!-- <img src="assets/b.png"> -->',
      '',
      '$$',
      '![inside](assets/c.png)',
      '$$',
    ].join('\n');

    const issues = await checkLocalDocumentResources(
      markdown,
      'D:\\docs\\notes.md',
      readSize
    );

    expect(issues).toEqual([]);
    expect(readSize).not.toHaveBeenCalled();
  });

  it('returns no issues for an empty document', async () => {
    const readSize = vi.fn(async () => 1);
    expect(await checkLocalDocumentResources('', undefined, readSize)).toEqual([]);
    expect(readSize).not.toHaveBeenCalled();
  });
});
