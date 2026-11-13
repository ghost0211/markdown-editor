import { describe, it, expect } from 'vitest';
import { dragCarriesFiles, filterMarkdownFiles, isMarkdownFileName } from '../src/lib/dropFiles';
import {
  createDefaultTab,
  normalizeLineEndings,
  openDroppedDocumentState,
} from '../src/lib/documentUtils';
import type { DocumentTab } from '../src/types';

const file = (name: string) => new File(['x'], name);

describe('dropFiles', () => {
  it('recognizes supported markdown / text extensions case-insensitively', () => {
    for (const name of ['a.md', 'A.MD', 'b.markdown', 'c.mdown', 'd.mkd', 'notes.txt']) {
      expect(isMarkdownFileName(name)).toBe(true);
    }
    for (const name of ['a.png', 'a.md.exe', 'md', 'a.docx']) {
      expect(isMarkdownFileName(name)).toBe(false);
    }
  });

  it('keeps only markdown files from a mixed drop', () => {
    const result = filterMarkdownFiles([file('a.md'), file('b.png'), file('c.txt')]);
    expect(result.map((f) => f.name)).toEqual(['a.md', 'c.txt']);
  });

  it('detects file drags but not text or tab drags', () => {
    expect(dragCarriesFiles({ types: ['Files'] })).toBe(true);
    expect(dragCarriesFiles({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(dragCarriesFiles({ types: ['text/plain'] })).toBe(false);
    expect(dragCarriesFiles(null)).toBe(false);
    expect(dragCarriesFiles(undefined)).toBe(false);
  });

  describe('openDroppedDocumentState (regression: dropped file must never start dirty)', () => {
    it('opens a dropped file with isDirty=false, matching savedContent, and replaces pristine welcome tab', () => {
      const welcome: DocumentTab = {
        ...createDefaultTab('Welcome.md', '# Welcome', 'doc-welcome'),
        filePath: null,
        isDirty: false,
      };

      const content = '# 一、结论先行\r\n\r\n| 项目 | 评估 |\r\n| --- | --- |\r\n| 其余软件 | 90% 有原生 Linux 版 |\r\n';
      const res = openDroppedDocumentState([welcome], 'Ubuntu迁移可行性评估.md', content);

      expect(res.action).toBe('opened');
      expect(res.tabs).toHaveLength(1);
      expect(res.tab.title).toBe('Ubuntu迁移可行性评估.md');
      expect(res.tab.content).toBe(content);
      expect(res.tab.savedContent).toBe(content);
      expect(res.tab.isDirty).toBe(false);
    });

    it('focuses an existing clean dropped tab instead of opening duplicates (even across CRLF/LF)', () => {
      const first = openDroppedDocumentState(
        [],
        'Ubuntu迁移可行性评估.md',
        '# 标题\r\n内容行\r\n'
      );
      expect(first.action).toBe('opened');

      const second = openDroppedDocumentState(
        first.tabs,
        'Ubuntu迁移可行性评估.md',
        '# 标题\n内容行\n'
      );
      expect(second.action).toBe('focused');
      expect(second.tabs).toHaveLength(1);
      expect(second.activeTabId).toBe(first.activeTabId);
      expect(second.tab.isDirty).toBe(false);
    });

    it('does not overwrite an edited (dirty) tab when the original file is dropped again', () => {
      const first = openDroppedDocumentState([], 'notes.md', '# Original');
      const editedTabs: DocumentTab[] = first.tabs.map((t) => ({
        ...t,
        content: '# Original\nNew paragraph',
        isDirty: true,
      }));

      const second = openDroppedDocumentState(editedTabs, 'notes.md', '# Original');
      expect(second.action).toBe('opened');
      expect(second.tabs).toHaveLength(2);
      expect(second.tabs[0].isDirty).toBe(true);
      expect(second.tabs[1].isDirty).toBe(false);
    });

    it('treats CRLF and LF content as equivalent when checking dirty state', () => {
      const crlf = '# 标题\r\n第一段\r\n第二段\r\n';
      const lf = '# 标题\n第一段\n第二段\n';
      expect(normalizeLineEndings(crlf)).toBe(lf);
    });
  });
});
