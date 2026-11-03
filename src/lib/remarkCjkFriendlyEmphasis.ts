import type { Root } from 'mdast';
import type { Extension } from 'micromark-util-types';
import type { Plugin } from 'unified';

// CommonMark treats a delimiter between a CJK character and an opening quote
// as intraword punctuation, so text such as `其中**“标题”**后文` is left as
// plain text. These paired punctuation characters are valid emphasis
// boundaries in Chinese prose, including when they close the emphasized text.
const CJK_PAIRED_PUNCTUATION =
  '‘’“”「」『』《》〈〉【】〔〕〖〗〘〙〚〛〝〞〟（）［］｛｝';

const cjkFriendlyEmphasisExtension: Extension = {
  attentionMarkers: {
    null: Array.from(CJK_PAIRED_PUNCTUATION, (character) => character.codePointAt(0)!),
  },
};

/** Adds CJK quote/bracket-aware emphasis parsing without rewriting the source. */
export const remarkCjkFriendlyEmphasis: Plugin<[], string, Root> = function () {
  const data = this.data();
  const micromarkExtensions =
    data.micromarkExtensions || (data.micromarkExtensions = []);

  micromarkExtensions.push(cjkFriendlyEmphasisExtension);
};
