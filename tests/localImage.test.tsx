import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalImage } from '../src/components/LocalImage';
import { I18nProvider } from '../src/i18n';

const render = (src: string) =>
  renderToStaticMarkup(
    <I18nProvider language="en-US">
      <LocalImage src={src} sourcePath="D:/docs/note.md" alt="Diagram" />
    </I18nProvider>
  );

describe('LocalImage non-desktop rendering', () => {
  it('keeps a document-relative source unchanged in the browser', () => {
    expect(render('assets/diagram.png')).toContain('src="assets/diagram.png"');
    expect(render('assets/diagram.png')).toContain('alt="Diagram"');
  });

  it('lazy-loads images and leaves remote sources unchanged', () => {
    const html = render('https://example.com/diagram.png');
    expect(html).toContain('src="https://example.com/diagram.png"');
    expect(html).toContain('loading="lazy"');
  });
});
