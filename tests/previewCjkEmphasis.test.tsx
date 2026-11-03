import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

function renderPreview(content: string): string {
  return renderToStaticMarkup(
    <I18nProvider language="zh-CN">
      <Preview content={content} />
    </I18nProvider>
  );
}

describe('Preview CJK emphasis', () => {
  it('renders bold text that starts with a Chinese quotation mark next to CJK text', () => {
    const html = renderPreview(
      '其中**“充电订单信息”服务节点**下挂载了三类充电订单数据来源：'
    );

    expect(html).toContain('<strong>“充电订单信息”服务节点</strong>');
    expect(html).not.toContain('**');
  });

  it.each([
    ['中文弯引号', '前文**“充电订单信息”**后文', '<strong>“充电订单信息”</strong>'],
    ['中文单引号', '前文**‘充电订单信息’**后文', '<strong>‘充电订单信息’</strong>'],
    ['书名号', '前文**《充电订单信息》**后文', '<strong>《充电订单信息》</strong>'],
    ['方头括号', '前文**【充电订单信息】**后文', '<strong>【充电订单信息】</strong>'],
  ])('supports emphasis bounded by %s', (_name, markdown, expected) => {
    const html = renderPreview(markdown);

    expect(html).toContain(expected);
    expect(html).not.toContain('**');
  });

  it('does not change code spans, escaped markers, or unmatched markers', () => {
    const codeHtml = renderPreview('`其中**“充电订单信息”服务节点**下挂载`');
    expect(codeHtml).toContain('**“充电订单信息”服务节点**');
    expect(codeHtml).not.toContain('<strong>');

    const escapedHtml = renderPreview('其中\\*\\*“充电订单信息”服务节点\\*\\*下挂载');
    expect(escapedHtml).toContain('**“充电订单信息”服务节点**');
    expect(escapedHtml).not.toContain('<strong>');

    const unmatchedHtml = renderPreview('其中**“充电订单信息”服务节点下挂载');
    expect(unmatchedHtml).toContain('**“充电订单信息”服务节点');
    expect(unmatchedHtml).not.toContain('<strong>');
  });
});
