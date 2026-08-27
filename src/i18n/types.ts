export type Language = 'zh-CN' | 'en-US';

export type TranslationParams = Record<string, string | number>;

export type NestedDictionary = {
  [key: string]: string | NestedDictionary;
};

// Helper types to extract dot-delimited key paths from dictionary object
type Prev = [never, 0, 1, 2, 3, 4, 5, ...never[]];

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never;

export type Leaves<T, D extends number = 4> = [D] extends [never]
  ? never
  : T extends object
  ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
  : '';
