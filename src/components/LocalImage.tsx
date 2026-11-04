import React, { useEffect, useState } from 'react';
import { isTauri, readBinaryFile } from '@/lib/native';
import { resolveLocalImagePath } from '@/lib/previewImages';
import { useI18n } from '@/i18n';

interface LocalImageProps extends React.ComponentPropsWithoutRef<'img'> {
  /** Path of the Markdown document containing the image. */
  sourcePath?: string | null;
}

function mimeTypeForImage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
  };
  return types[extension || ''] || 'application/octet-stream';
}

/**
 * Loads document-relative images through the native read command. The WebView
 * cannot fetch `C:/...` or `assets/...` relative to the app bundle, and enabling
 * a global asset-protocol scope would expose more of the filesystem than the
 * preview needs. Blob URLs are scoped to and revoked by this component.
 */
export const LocalImage: React.FC<LocalImageProps> = ({
  src,
  sourcePath,
  alt = '',
  loading = 'lazy',
  ...props
}) => {
  const { t } = useI18n();
  const rawSrc = typeof src === 'string' ? src : undefined;
  const localPath = resolveLocalImagePath(rawSrc, sourcePath);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!localPath || !isTauri()) return;

    let cancelled = false;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    setFailed(false);

    readBinaryFile(localPath)
      .then((bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeTypeForImage(localPath) });
        createdUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(createdUrl);
        } else {
          setObjectUrl(createdUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [localPath]);

  if (localPath && isTauri()) {
    if (failed) {
      return (
        <span role="img" aria-label={alt} className="md-image-error">
          {t('preview.imageLoadFailed', { name: alt || localPath })}
        </span>
      );
    }
    if (!objectUrl) {
      return <span className="md-image-loading" aria-label={alt} aria-busy="true" />;
    }
    return <img {...props} src={objectUrl} alt={alt} loading={loading} />;
  }

  return <img {...props} src={rawSrc} alt={alt} loading={loading} />;
};
