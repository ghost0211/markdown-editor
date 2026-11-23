/** XMD metadata lives in valid, single-line Markdown comments. */
export function writeXmdComment(prefix: string, data: object): string {
  const json = JSON.stringify(data).replace(/[-<>&]/g, (char) =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  return prefix + json + ' -->';
}

export function readXmdComment(value: string, prefix: string, limit: number): Record<string, unknown> | undefined {
  if (!value.startsWith(prefix) || !value.endsWith(' -->') || value.length > limit || /[\r\n]/.test(value)) return;
  try {
    const data: unknown = JSON.parse(value.slice(prefix.length, -4));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* Unknown or malformed metadata remains a Markdown comment. */ }
}
