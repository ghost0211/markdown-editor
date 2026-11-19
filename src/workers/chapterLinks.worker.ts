import { documentBacklinks, type ReferenceDocument } from '@/lib/chapterLinks';

self.onmessage = (event: MessageEvent<{ target: ReferenceDocument; sources: ReferenceDocument[] }>) => {
  try {
    self.postMessage({ results: documentBacklinks(event.data.target, event.data.sources) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
