import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';

export interface ImageLightboxHandle {
  open: (src: string, alt: string) => void;
}

/**
 * Full-window image viewer. Opened imperatively so the preview that hosts it
 * does not have to re-render its whole Markdown tree just to show an overlay.
 * Clicking anywhere or pressing Escape closes it.
 */
export const ImageLightbox = forwardRef<ImageLightboxHandle>((_props, ref) => {
  const { t } = useI18n();
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);

  useImperativeHandle(ref, () => ({ open: (src, alt) => setImage({ src, alt }) }), []);

  const close = useCallback(() => setImage(null), []);

  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [image, close]);

  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || t('preview.imageViewer')}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
      onClick={close}
    >
      <img
        src={image.src}
        alt={image.alt}
        className="max-w-[94vw] max-h-[92vh] object-contain rounded shadow-2xl bg-white/5"
        onClick={close}
      />
      <button
        type="button"
        onClick={close}
        aria-label={t('preview.imageViewerClose')}
        title={t('preview.imageViewerClose')}
        className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

ImageLightbox.displayName = 'ImageLightbox';
