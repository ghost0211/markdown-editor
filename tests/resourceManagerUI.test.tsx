import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ResourceManager,
  canPreviewResourceImage,
  filterResources,
  formatResourceByteLength,
  getResourceExportBlockReason,
  getResourceFullAddress,
  isSafeDataImageUrl,
  isSafeHttpUrl,
  isSafeLocalPreviewSource,
  summarizeResources,
  type ResourceManagerProps,
} from '../src/components/ResourceManager';
import { getDocumentToolAvailability } from '../src/components/titleBar/DocumentToolsMenu';
import { I18nProvider } from '../src/i18n';
import type { DocumentResource } from '../src/lib/documentResources';
import type { DocumentTab } from '../src/types';

const embeddedImage: DocumentResource = {
  id: 'img-embedded',
  name: 'diagram.png',
  kind: 'image',
  location: 'embedded',
  source: 'data:image/png;base64,QUJD',
  // The scanner deliberately compacts Base64 addresses; the UI must not use
  // the compact form for the copyable full address.
  displayAddress: 'data:image/png;base64,…',
  mimeType: 'image/png',
  referenceCount: 2,
  references: [{ line: 12, target: { from: 100, to: 120 } }, { line: 40, target: { from: 400, to: 420 } }],
  status: 'ready',
  byteLength: 2048,
};

const localImage: DocumentResource = {
  id: 'img-local',
  name: 'photo.jpg',
  kind: 'image',
  location: 'local',
  source: 'assets/photo.jpg',
  displayAddress: 'assets/photo.jpg',
  localPath: 'D:\\docs\\assets\\photo.jpg',
  mimeType: 'image/jpeg',
  referenceCount: 1,
  references: [{ line: 7, target: { from: 70, to: 90 } }],
  status: 'ready',
  byteLength: 512 * 1024,
};

const remoteImage: DocumentResource = {
  id: 'img-remote',
  name: 'banner.png',
  kind: 'image',
  location: 'remote',
  source: 'https://example.com/banner.png',
  displayAddress: 'https://example.com/…',
  mimeType: 'image/png',
  referenceCount: 1,
  references: [{ line: 22, target: { from: 220, to: 240 } }],
  status: 'ready',
};

const attachment: DocumentResource = {
  id: 'file-pdf',
  name: 'spec.pdf',
  kind: 'attachment',
  location: 'local',
  source: 'assets/spec.pdf',
  displayAddress: 'assets/spec.pdf',
  localPath: 'D:\\docs\\assets\\spec.pdf',
  mimeType: 'application/pdf',
  referenceCount: 1,
  references: [{ line: 88, target: { from: 880, to: 900 } }],
  status: 'ready',
  byteLength: 1024 * 1024,
};

const missingAttachment: DocumentResource = {
  id: 'file-missing',
  name: 'old-notes.docx',
  kind: 'attachment',
  location: 'remote',
  source: 'https://example.com/old-notes.docx',
  displayAddress: 'https://example.com/old-notes.docx',
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  referenceCount: 0,
  references: [],
  status: 'missing',
};

const loadingImage: DocumentResource = {
  ...localImage,
  id: 'img-loading',
  name: 'still-loading.png',
  status: 'loading',
  byteLength: undefined,
};

const transientImage: DocumentResource = {
  id: 'img-transient',
  name: 'pasted.png',
  kind: 'image',
  location: 'transient',
  source: 'blob:https://example.com/9f8e7d',
  displayAddress: 'blob:https://example.com/9f8e7d',
  mimeType: 'image/png',
  referenceCount: 1,
  references: [{ line: 5, target: { from: 50, to: 70 } }],
  status: 'ready',
  byteLength: 4096,
};

const unsafeRemoteImage: DocumentResource = {
  id: 'img-unsafe-remote',
  name: 'evil.png',
  kind: 'image',
  location: 'remote',
  source: 'javascript:alert(1)',
  displayAddress: 'javascript:alert(1)',
  mimeType: 'image/png',
  referenceCount: 1,
  references: [{ line: 9, target: { from: 90, to: 110 } }],
  status: 'ready',
};

const ftpRemoteImage: DocumentResource = {
  ...unsafeRemoteImage,
  id: 'img-ftp',
  name: 'ftp-image.png',
  source: 'ftp://example.com/ftp-image.png',
  displayAddress: 'ftp://example.com/ftp-image.png',
};

const unsafeEmbeddedImage: DocumentResource = {
  id: 'img-unsafe-embedded',
  name: 'inline.svg',
  kind: 'image',
  location: 'embedded',
  source: 'data:text/html,<svg onload="alert(1)"></svg>',
  displayAddress: 'data:text/html,…',
  mimeType: 'image/svg+xml',
  referenceCount: 1,
  references: [{ line: 3, target: { from: 30, to: 50 } }],
  status: 'ready',
  byteLength: 512,
};

const tooLargeImage: DocumentResource = {
  ...embeddedImage,
  id: 'img-too-large',
  name: 'huge.png',
  byteLength: 33 * 1024 * 1024,
};

const unsafeLocalImage: DocumentResource = {
  ...localImage,
  id: 'img-unsafe-local',
  name: 'local-evil.png',
  localPath: undefined,
  source: 'javascript:alert(1)',
  displayAddress: 'javascript:alert(1)',
};

const allResources: DocumentResource[] = [
  embeddedImage,
  localImage,
  remoteImage,
  attachment,
  missingAttachment,
];

function baseProps(
  overrides: Partial<ResourceManagerProps> = {}
): ResourceManagerProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    documentTitle: 'notes.md',
    resources: allResources,
    error: null,
    isRefreshing: false,
    onRefresh: vi.fn(),
    onLocate: vi.fn(),
    onExport: vi.fn(async () => {}),
    onReveal: vi.fn(async () => {}),
    onConvert: vi.fn(async () => {}),
    onConvertAll: vi.fn(async () => {}),
    canConvert: true,
    convertReason: '',
    busyId: null,
    sourceFilePath: 'D:\\docs\\notes.md',
    ...overrides,
  };
}

function renderManager(
  overrides: Partial<ResourceManagerProps> = {},
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): string {
  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <ResourceManager {...baseProps(overrides)} />
    </I18nProvider>
  );
}

describe('ResourceManager pure list helpers', () => {
  it('summarizes images, attachments and missing resources', () => {
    expect(summarizeResources(allResources)).toEqual({
      total: 5,
      images: 3,
      attachments: 2,
      missing: 1,
    });
    expect(summarizeResources([])).toEqual({
      total: 0,
      images: 0,
      attachments: 0,
      missing: 0,
    });
  });

  it('filters by kind and by missing status', () => {
    expect(filterResources(allResources, '', 'all')).toHaveLength(5);
    expect(filterResources(allResources, '', 'image')).toEqual([
      embeddedImage,
      localImage,
      remoteImage,
    ]);
    expect(filterResources(allResources, '', 'attachment')).toEqual([
      attachment,
      missingAttachment,
    ]);
    expect(filterResources(allResources, '', 'missing')).toEqual([
      missingAttachment,
    ]);
  });

  it('searches names, displayed addresses and local paths case-insensitively', () => {
    expect(filterResources(allResources, 'DIAGRAM', 'all')).toEqual([
      embeddedImage,
    ]);
    expect(filterResources(allResources, 'example.com', 'all')).toEqual([
      remoteImage,
      missingAttachment,
    ]);
    expect(filterResources(allResources, 'photo.jpg', 'image')).toEqual([
      localImage,
    ]);
    expect(filterResources(allResources, 'no-such-resource', 'all')).toEqual([]);
  });

  it('combines search text and filters', () => {
    expect(filterResources(allResources, 'old-notes', 'image')).toEqual([]);
    expect(filterResources(allResources, 'old-notes', 'missing')).toEqual([
      missingAttachment,
    ]);
  });

  it('formats byte sizes safely', () => {
    expect(formatResourceByteLength(undefined)).toBeNull();
    expect(formatResourceByteLength(Number.NaN)).toBeNull();
    expect(formatResourceByteLength(-1)).toBeNull();
    expect(formatResourceByteLength(0)).toBe('0 B');
    expect(formatResourceByteLength(512)).toBe('512 B');
    expect(formatResourceByteLength(2048)).toBe('2.0 KiB');
    expect(formatResourceByteLength(1024 * 1024)).toBe('1.0 MiB');
  });
});

describe('ResourceManager full address / export / preview policy', () => {
  it('uses the original source or local path, never the compact display address', () => {
    expect(getResourceFullAddress(embeddedImage)).toBe(
      'data:image/png;base64,QUJD'
    );
    expect(getResourceFullAddress(remoteImage)).toBe(
      'https://example.com/banner.png'
    );
    expect(getResourceFullAddress(localImage)).toBe(
      'D:\\docs\\assets\\photo.jpg'
    );
    // A local resource without a resolved path falls back to its source.
    expect(
      getResourceFullAddress({ ...localImage, localPath: undefined })
    ).toBe('assets/photo.jpg');
  });

  it('only accepts explicit http(s) URLs for remote resources', () => {
    expect(isSafeHttpUrl('https://example.com/a.png')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/a.png?x=1')).toBe(true);
    expect(isSafeHttpUrl('//example.com/a.png')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com/a.png')).toBe(false);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('https://example.com/a b.png')).toBe(false);
  });

  it('only accepts data:image URLs for embedded image previews', () => {
    expect(isSafeDataImageUrl('data:image/png;base64,QUJD')).toBe(true);
    expect(
      isSafeDataImageUrl('data:image/svg+xml;charset=utf-8,<svg/>')
    ).toBe(true);
    expect(isSafeDataImageUrl('data:text/html,<svg/>')).toBe(false);
    expect(isSafeDataImageUrl('data:image/svg+xml')).toBe(false);
    expect(isSafeDataImageUrl('https://example.com/a.png')).toBe(false);
  });

  it('blocks export for missing, loading, transient, unsafe and oversized resources', () => {
    expect(getResourceExportBlockReason(embeddedImage)).toBeNull();
    expect(getResourceExportBlockReason(localImage)).toBeNull();
    expect(getResourceExportBlockReason(remoteImage)).toBeNull();
    expect(getResourceExportBlockReason(attachment)).toBeNull();

    expect(getResourceExportBlockReason(missingAttachment)).toBe('missing');
    expect(getResourceExportBlockReason(loadingImage)).toBe('loading');
    expect(getResourceExportBlockReason(transientImage)).toBe('transient');
    expect(getResourceExportBlockReason(unsafeRemoteImage)).toBe(
      'unsafe-remote'
    );
    expect(getResourceExportBlockReason(ftpRemoteImage)).toBe('unsafe-remote');
    expect(getResourceExportBlockReason(unsafeEmbeddedImage)).toBe(
      'unsafe-source'
    );
    expect(getResourceExportBlockReason(unsafeLocalImage)).toBe(
      'unsafe-source'
    );
    expect(getResourceExportBlockReason(tooLargeImage)).toBe('too-large');
  });

  it('uses the native 32 MiB read limit as the export boundary', () => {
    const limit = 32 * 1024 * 1024;
    expect(
      getResourceExportBlockReason({ ...embeddedImage, byteLength: limit })
    ).toBeNull();
    expect(
      getResourceExportBlockReason({ ...embeddedImage, byteLength: limit + 1 })
    ).toBe('too-large');
  });

  it('allows previews only for safe embedded data images, HTTP(S) remotes and local files', () => {
    expect(canPreviewResourceImage(embeddedImage)).toBe(true);
    expect(canPreviewResourceImage(remoteImage)).toBe(true);
    expect(canPreviewResourceImage(localImage)).toBe(true);
    expect(canPreviewResourceImage(unsafeRemoteImage)).toBe(false);
    expect(canPreviewResourceImage(ftpRemoteImage)).toBe(false);
    expect(canPreviewResourceImage(unsafeEmbeddedImage)).toBe(false);
    expect(canPreviewResourceImage(transientImage)).toBe(false);
    expect(canPreviewResourceImage(attachment)).toBe(false);
  });

  it('rejects scheme and protocol-relative sources for local previews', () => {
    expect(isSafeLocalPreviewSource(localImage)).toBe(true);
    expect(
      isSafeLocalPreviewSource({
        ...localImage,
        localPath: undefined,
        source: 'assets/photo.jpg',
      })
    ).toBe(true);
    expect(
      isSafeLocalPreviewSource({
        ...localImage,
        localPath: undefined,
        source: 'javascript:alert(1)',
      })
    ).toBe(false);
    expect(
      isSafeLocalPreviewSource({
        ...localImage,
        localPath: undefined,
        source: '//evil.example/photo.png',
      })
    ).toBe(false);
    expect(
      isSafeLocalPreviewSource({ ...localImage, localPath: undefined, source: '#frag' })
    ).toBe(false);
  });
});

describe('ResourceManager accessible modal (SSR)', () => {
  it('renders an accessible dialog with the document title and summary', () => {
    const html = renderManager();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);

    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);

    expect(html).toContain('资源管理器');
    expect(html).toContain('notes.md');
    expect(html).toContain('共 5 项 · 图片 3 · 附件 2 · 失效 1');
    expect(html).toContain('关闭资源管理器');
    // Accessible size contract: about 900px wide and min(75vh, 650px) tall.
    expect(html).toContain('w-[900px]');
    expect(html).toContain('h-[min(75vh,650px)]');
  });

  it('renders the search field, filters, refresh and batch convert controls', () => {
    const html = renderManager();

    expect(html).toContain('搜索资源名称或地址...');
    expect(html).toContain('资源类型筛选');
    expect(html).toContain('全部');
    expect(html).toContain('图片');
    expect(html).toContain('附件');
    expect(html).toContain('失效');
    expect(html).toContain('刷新');
    expect(html).toContain('内嵌图片转存 assets');
  });

  it('renders the resource list with metadata and a red missing badge', () => {
    const html = renderManager();

    expect(html).toContain('diagram.png');
    expect(html).toContain('spec.pdf');
    expect(html).toContain('old-notes.docx');
    expect(html).toContain('bg-red-100');
    expect(html).toContain('2 处引用');
    expect(html).toContain('1.0 MiB');
    expect(html).toContain('本地');
    expect(html).toContain('远程');
    expect(html).toContain('内嵌');
  });

  it('previews an embedded image from its data URL and never puts Base64 in a title attribute', () => {
    const html = renderManager();

    expect(html).toContain('data-resource-preview="embedded"');
    expect(html).toContain('src="data:image/png;base64,QUJD"');
    expect(html).not.toContain('title="data:image');
    expect(html).not.toContain('title="data:image/png;base64,QUJD"');
  });

  it('previews local and remote images using the correct strategy', () => {
    const localHtml = renderManager({ resources: [localImage] });
    expect(localHtml).toContain('data-resource-preview="local"');
    expect(localHtml).toContain('alt="photo.jpg"');

    const remoteHtml = renderManager({ resources: [remoteImage] });
    expect(remoteHtml).toContain('data-resource-preview="remote"');
    expect(remoteHtml).toMatch(/referrerpolicy="no-referrer"/i);
    expect(remoteHtml).toContain('src="https://example.com/banner.png"');
  });

  it('shows a file icon for attachments and their MIME type and size', () => {
    const html = renderManager({ resources: [attachment] });

    expect(html).toContain('lucide-file-text');
    expect(html).toContain('spec.pdf');
    expect(html).toContain('application/pdf');
    expect(html).toContain('1.0 MiB');
    expect(html).toContain('在文件管理器中显示');
  });

  it('shows a friendly missing-resource state', () => {
    const html = renderManager({ resources: [missingAttachment] });

    expect(html).toContain('失效');
    expect(html).toContain('资源文件缺失或无法访问');
    // A missing resource must not render a broken remote image element.
    expect(html).not.toContain('data-resource-preview="remote"');
  });

  it('renders a bounded read-only textarea with the complete address and copy control', () => {
    const embeddedHtml = renderManager({ resources: [embeddedImage] });

    expect(embeddedHtml).toContain('完整地址');
    expect(embeddedHtml).toContain('复制地址');
    expect(embeddedHtml).toContain('readonly=""');
    expect(embeddedHtml).toContain('max-h-24');
    // Full Base64 source, not the compact displayAddress.
    expect(embeddedHtml).toContain('>data:image/png;base64,QUJD</textarea>');
    expect(embeddedHtml).not.toContain('>data:image/png;base64,…</textarea>');
    expect(embeddedHtml).not.toMatch(/title="[^"]*data:image/);

    const localHtml = renderManager({ resources: [localImage] });
    expect(localHtml).toContain('>D:\\docs\\assets\\photo.jpg</textarea>');

    const remoteHtml = renderManager({ resources: [remoteImage] });
    expect(remoteHtml).toContain(
      '>https://example.com/banner.png</textarea>'
    );
    expect(remoteHtml).not.toContain('>https://example.com/…</textarea>');
  });

  it('shows the full address for a transient resource without previewing its blob URL', () => {
    const html = renderManager({ resources: [transientImage] });

    expect(html).toContain(
      '>blob:https://example.com/9f8e7d</textarea>'
    );
    expect(html).toContain('data-resource-preview="unavailable"');
    expect(html).not.toContain('src="blob:');
  });

  it('renders per-reference line buttons and the locate action', () => {
    const html = renderManager();

    expect(html).toContain('正文引用');
    expect(html).toContain('定位正文');
    expect(html).toContain('第 12 行');
    expect(html).toContain('第 40 行');
    expect(html).toContain('定位正文（第 12 行）');
    expect(html).toContain('定位正文（第 40 行）');
  });

  it('renders export, reveal for local resources and per-resource convert actions', () => {
    const html = renderManager({ resources: [localImage] });

    expect(html).toContain('导出/另存');
    expect(html).toContain('在文件管理器中显示');
    // A local image is not embedded, so the per-resource convert action is hidden.
    expect(html).not.toContain('内嵌图片转存本地');

    const embeddedHtml = renderManager({ resources: [embeddedImage] });
    expect(embeddedHtml).toContain('内嵌图片转存本地');
  });

  it('disables convert actions and explains why when conversion is unavailable', () => {
    const html = renderManager({
      resources: [embeddedImage],
      canConvert: false,
      convertReason: '当前文档尚未保存到磁盘',
    });

    expect(html).toContain('当前文档尚未保存到磁盘');
    expect(html).toContain('aria-describedby=');
    expect(html).toMatch(/disabled=""[^>]*title="当前文档尚未保存到磁盘"/);
    // The reason is shown inline, not only in a tooltip.
    expect(html.match(/当前文档尚未保存到磁盘/g)?.length).toBeGreaterThanOrEqual(
      2
    );
  });

  it('disables export with an explained reason for missing and loading resources', () => {
    const missingHtml = renderManager({ resources: [missingAttachment] });
    expect(missingHtml).toContain('disabled="" title="资源缺失，无法导出"');
    expect(missingHtml).toContain('资源缺失，无法导出');

    const loadingHtml = renderManager({ resources: [loadingImage] });
    expect(loadingHtml).toContain(
      'disabled="" title="资源仍在载入，暂时无法导出"'
    );
    expect(loadingHtml).toContain('资源仍在载入，暂时无法导出');
  });

  it('disables export for transient resources and shows the expired hint', () => {
    const html = renderManager({ resources: [transientImage] });

    expect(html).toContain('disabled="" title="临时资源已失效，无法导出"');
    expect(html).toContain('临时资源已失效，请重新插入图片');
    expect(html).toContain('data-resource-preview="unavailable"');
  });

  it('disables export for non-http remote resources', () => {
    const javascriptHtml = renderManager({ resources: [unsafeRemoteImage] });
    expect(javascriptHtml).toContain(
      'disabled="" title="仅支持导出 http(s) 远程资源"'
    );

    const ftpHtml = renderManager({ resources: [ftpRemoteImage] });
    expect(ftpHtml).toContain(
      'disabled="" title="仅支持导出 http(s) 远程资源"'
    );
  });

  it('disables export for unsafe embedded image payloads', () => {
    const html = renderManager({ resources: [unsafeEmbeddedImage] });

    expect(html).toContain('disabled="" title="资源地址不安全，无法导出"');
    expect(html).toContain('data-resource-preview="unavailable"');
    expect(html).not.toContain('src="data:text/html');
  });

  it('disables export above the 32 MiB native read limit and shows the size', () => {
    const html = renderManager({ resources: [tooLargeImage] });

    expect(html).toMatch(
      /disabled="" title="资源大小 33\.0 MiB，超过 32 MiB，无法导出"/
    );
    expect(html).toContain('资源大小 33.0 MiB，超过 32 MiB，无法导出');
  });

  it('does not render scheme sources that claim to be local files', () => {
    const html = renderManager({ resources: [unsafeLocalImage] });

    expect(html).toContain('data-resource-preview="unavailable"');
    expect(html).not.toContain('src="javascript:');
    expect(html).toContain('disabled="" title="资源地址不安全，无法导出"');
  });

  it('does not render unsafe remote preview sources', () => {
    const javascriptHtml = renderManager({ resources: [unsafeRemoteImage] });
    expect(javascriptHtml).toContain('data-resource-preview="unavailable"');
    expect(javascriptHtml).not.toContain('src="javascript:');
    expect(javascriptHtml).not.toContain('referrerpolicy="no-referrer"');

    const ftpHtml = renderManager({ resources: [ftpRemoteImage] });
    expect(ftpHtml).toContain('data-resource-preview="unavailable"');
    expect(ftpHtml).not.toContain('src="ftp://');
  });

  it('only renders embedded previews for data:image payloads', () => {
    const unsafeHtml = renderManager({ resources: [unsafeEmbeddedImage] });
    expect(unsafeHtml).toContain('data-resource-preview="unavailable"');
    expect(unsafeHtml).not.toContain('src="data:text/html');

    const safeHtml = renderManager({ resources: [embeddedImage] });
    expect(safeHtml).toContain('data-resource-preview="embedded"');
    expect(safeHtml).toContain('src="data:image/png;base64,QUJD"');
  });

  it('disables resource actions while an operation is busy', () => {
    const html = renderManager({
      resources: [embeddedImage],
      busyId: embeddedImage.id,
    });

    expect(html).toContain('disabled=""');
  });

  it('renders a friendly empty state when the document has no resources', () => {
    const html = renderManager({ resources: [] });

    expect(html).toContain('未发现图片或附件');
    expect(html).toContain('文档中引用的图片与附件会显示在这里');
    expect(html).toContain('共 0 项');
  });

  it('exposes the search and filter controls needed to narrow the list', () => {
    const html = renderManager({ resources: [embeddedImage] });

    // Filtering behaviour itself is covered by the pure helper tests; SSR only
    // proves the interactive controls exist (the Node environment has no DOM
    // to dispatch input events against).
    expect(html).toContain('搜索资源名称或地址...');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('资源类型筛选');
  });

  it('renders refresh progress and error banners', () => {
    const refreshingHtml = renderManager({ isRefreshing: true });
    expect(refreshingHtml).toContain('刷新中...');
    expect(refreshingHtml).toMatch(/disabled=""/);

    const errorHtml = renderManager({ error: '无法扫描文档资源' });
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('无法扫描文档资源');
  });

  it('renders English labels through the i18n provider', () => {
    const html = renderManager({}, 'en-US');

    expect(html).toContain('Resources');
    expect(html).toContain('Search resource name or address...');
    expect(html).toContain('All');
    expect(html).toContain('Images');
    expect(html).toContain('Attachments');
    expect(html).toContain('Missing');
    expect(html).toContain('Export / Save As');
    expect(html).toContain('Move embedded images to assets');

    const blockedHtml = renderManager({ resources: [missingAttachment] }, 'en-US');
    expect(blockedHtml).toContain(
      'title="Resource is missing and cannot be exported"'
    );

    const unsafeHtml = renderManager({ resources: [unsafeRemoteImage] }, 'en-US');
    expect(unsafeHtml).toContain(
      'This resource address is unsafe or cannot be previewed'
    );
  });

  it('renders nothing when closed', () => {
    expect(renderManager({ isOpen: false })).toBe('');
  });
});

describe('Document tools menu availability', () => {
  const documentTab: DocumentTab = {
    id: 'tab-1', title: 'notes.md', filePath: 'D:\\docs\\notes.md',
    content: '', savedContent: '', isDirty: false, cursorLine: 1, cursorCol: 1,
    kind: 'document',
  };

  it('keeps resources, quality and history available for a saved document', () => {
    expect(getDocumentToolAvailability(documentTab)).toEqual({ resources: true, quality: true, history: true });
  });

  it('disables document-bound tools in a diff tab', () => {
    expect(getDocumentToolAvailability({ ...documentTab, kind: 'diff' })).toEqual({ resources: false, quality: false, history: false });
  });

  it('requires a saved local document for history but permits unsaved document tools', () => {
    expect(getDocumentToolAvailability({ ...documentTab, filePath: null })).toEqual({ resources: true, quality: true, history: false });
    expect(getDocumentToolAvailability(undefined)).toEqual({ resources: false, quality: false, history: false });
  });
});
