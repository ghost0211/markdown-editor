import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { DocumentHistory } from '../src/components/DocumentHistory';
import { getDocumentToolAvailability } from '../src/components/titleBar/DocumentToolsMenu';
import type { DocumentTab } from '../src/types';

vi.mock('@/lib/native', () => ({ readDocumentHistory: vi.fn(async () => []), readDocumentSnapshot: vi.fn(async () => ''), isTauri: vi.fn(() => true) }));

function history(path: string | null) {
  return renderToStaticMarkup(<I18nProvider language="zh-CN"><DocumentHistory isOpen onClose={() => {}} sourceFilePath={path} content="current" title="测试.md" isDark={false} onRestore={() => true} /></I18nProvider>);
}

describe('local history UI', () => {
  it('has an accessible dialog and a non-destructive restore explanation', () => {
    const html = history('C:\\docs\\test.md');
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
    expect(html).toContain('本地历史版本'); expect(html).toContain('不直接覆盖文件');
    expect(html).toContain('恢复此版本');
  });

  it('explains that unsaved documents have no disk history', () => {
    expect(history(null)).toContain('保存文档后即可使用本地历史版本');
  });

  it('enables history only for saved local documents, not unsaved or diff tabs', () => {
    const base: DocumentTab = { id: 'saved', title: 'saved.md', filePath: 'C:\\docs\\saved.md', content: '', savedContent: '', isDirty: false, cursorLine: 1, cursorCol: 1 };
    expect(getDocumentToolAvailability(base).history).toBe(true);
    expect(getDocumentToolAvailability({ ...base, filePath: null }).history).toBe(false);
    expect(getDocumentToolAvailability({ ...base, kind: 'diff' }).history).toBe(false);
  });
});
