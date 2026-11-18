import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

function render(content: string, renderHtml?: boolean): string {
  return renderToStaticMarkup(
    <I18nProvider language="zh-CN">
      <Preview content={content} renderHtml={renderHtml} />
    </I18nProvider>
  );
}

describe('preview HTML rendering', () => {
  it('renders break variants and safe formatting in prose and tables only when enabled', () => {
    const source = [
      '甲<br>乙<BR />丙 <sup>2</sup>',
      '',
      '| 列 |',
      '| --- |',
      '| 一<br/>二 |',
      '',
      '示例：' + String.fromCharCode(96) + '<br>' + String.fromCharCode(96),
      '',
      '转义：\\<br> 和 &lt;br&gt;',
    ].join('\n');
    expect(render(source)).not.toContain('<br/>');
    const enabled = render(source, true);
    expect(enabled).toContain('甲<br/>乙<br/>丙 <sup>2</sup>');
    expect(enabled).toContain('<td>一<br/>二</td>');
    expect(enabled).toContain('&lt;br&gt;');
    expect(enabled.match(/<br\/>/g)).toHaveLength(3);
  });

  it('filters unsafe HTML and links', () => {
    const rendered = render([
      '<script>window.previewInjected = true</script>',
      '',
      '<iframe src="https://example.test">frame</iframe>',
      '',
      '<strong onclick="bad()" style="color:red" id="app">bold</strong>',
      '',
      '<a href="jav&#x61;script:bad()">bad</a>',
      '',
      '<img src="https://example.test/image.png" onerror="bad()" srcset="https://example.test/other.png 2x">',
    ].join('\n'), true);
    expect(rendered).toContain('<strong>bold</strong>');
    expect(rendered).toContain('src="https://example.test/image.png"');
    expect(rendered).not.toMatch(/<(?:script|iframe)\b|href="javascript:|<img[^>]+(?:onerror|srcset)=/i);
  });

  it('preserves generated Markdown presentation, footnotes and bundled URLs', () => {
    const rendered = render([
      '# Title',
      '',
      '> [!TIP]',
      '> 注意事项',
      '',
      '- [x] Task',
      '',
      '公式 $x^2$ 和注释[^note]',
      '',
      '[^note]: the note',
      '',
      '![Image](data:image/png;base64,iVBORw0KGgo=)',
      '',
      '[Attachment](data:application/octet-stream;base64,AA==)',
      '',
      '[Local](C:/docs/a.md)',
    ].join('\n'), true);
    expect(rendered).toContain('id="title"');
    expect(rendered).toContain('class="md-callout md-callout-tip"');
    expect(rendered).toContain('type="checkbox"');
    expect(rendered).toContain('class="katex"');
    expect(rendered).toContain('href="#user-content-fn-note"');
    expect(rendered).toContain('id="user-content-fn-note"');
    expect(rendered).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(rendered).toContain('href="data:application/octet-stream;base64,AA=="');
    expect(rendered).toContain('href="C:/docs/a.md"');
  });
});
