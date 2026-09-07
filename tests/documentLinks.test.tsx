
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { documentUrlTransform, resolveDocumentLink } from '../src/lib/documentLinks';

describe('document links', () => {
  const source = 'D:\\proj\\文档\\审核报告\\索引.md';
  it('resolves sibling and parent Chinese documents', () => {
    expect(resolveDocumentLink('修改记录.md', source)?.path).toBe('D:/proj/文档/审核报告/修改记录.md');
    expect(resolveDocumentLink('../模块设计/认证.md#接口', source)).toEqual({path:'D:/proj/文档/模块设计/认证.md', anchor:'%E6%8E%A5%E5%8F%A3'});
  });
  it('decodes encoded names and preserves special characters in the source directory', () => {
    expect(resolveDocumentLink('./hello%20world.md', 'D:/a#b%/index.md')?.path).toBe('D:/a#b%/hello world.md');
  });
  it('supports absolute Windows, file URL, UNC and POSIX paths', () => {
    expect(resolveDocumentLink('D:\\docs\\test.md', source)?.path).toBe('D:/docs/test.md');
    expect(resolveDocumentLink('file:///D:/docs/test%20a.md', source)?.path).toBe('D:/docs/test a.md');
    expect(resolveDocumentLink('file://server/share/test.md', source)?.path).toBe('//server/share/test.md');
    expect(resolveDocumentLink('../test.md', '/home/docs/index.md')?.path).toBe('/home/test.md');
  });
  it('keeps external URLs and anchors out of local file handling', () => {
    for (const href of ['https://example.com', 'mailto:a@example.com', '#title', 'javascript:alert(1)']) expect(resolveDocumentLink(href, source)).toBeNull();
    expect(() => resolveDocumentLink('test.md', null)).toThrow('保存');
    expect(() => resolveDocumentLink('test.md', 'browser://index.md')).toThrow('保存');
  });
  it('renders local destinations while blocking executable schemes', () => {
    const html = renderToStaticMarkup(<Markdown urlTransform={documentUrlTransform}>{'[local](file:///D:/docs/a.md) [relative](../中文.md) [unsafe](javascript:alert)'}</Markdown>);
    expect(html).toContain('href="file:///D:/docs/a.md"');
    expect(html).toContain('href="../%E4%B8%AD%E6%96%87.md"');
    expect(html).not.toContain('href="javascript:');
  });
});
