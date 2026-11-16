
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
  it('keeps raster image data and routes package links through inert download handling', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const html = renderToStaticMarkup(
      <Markdown urlTransform={documentUrlTransform}>{`![embedded](<${data}>) [download](${data}) [unsafe](data:text/html;base64,PHNjcmlwdD4=)`}</Markdown>
    );
    expect(html).toContain(`src="${data}"`);
    expect(html).toContain(`href="${data}"`);
    // The Preview anchor always downloads as application/octet-stream.
    expect(documentUrlTransform('data:text/html;base64,PHNjcmlwdD4=', 'href')).toContain('data:text/html');
    expect(documentUrlTransform('javascript:alert(1)', 'href')).toBe('');
  });
  it('allows bundled SVG only as a non-scripting image source', () => {
    const data = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    expect(documentUrlTransform(data, 'src')).toBe(data);
    expect(documentUrlTransform('data:image/svg+xml,%3Cscript%3E', 'src')).toBe('');
  });

  it('renders local destinations while blocking executable schemes', () => {
    const html = renderToStaticMarkup(<Markdown urlTransform={documentUrlTransform}>{'[local](file:///D:/docs/a.md) [relative](../中文.md) [unsafe](javascript:alert)'}</Markdown>);
    expect(html).toContain('href="file:///D:/docs/a.md"');
    expect(html).toContain('href="../%E4%B8%AD%E6%96%87.md"');
    expect(html).not.toContain('href="javascript:');
  });
});
