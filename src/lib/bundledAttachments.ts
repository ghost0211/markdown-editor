/** XMD attachments are downloaded as inert bytes, never navigated or executed. */
export function bundledAttachmentBlob(url: string): Blob {
  const match = /^data:[^,]*;base64,([\s\S]*)$/i.exec(url);
  if (!match) throw new Error('Invalid bundled attachment / 无效的包内附件');
  const payload = match[1].replace(/\s/g, '');
  if (payload.length > 32 * 1024 * 1024 * 4) throw new Error('Attachment exceeds 32 MiB / 附件超过 32 MiB');
  const binary = atob(payload);
  if (binary.length > 32 * 1024 * 1024) throw new Error('Attachment exceeds 32 MiB / 附件超过 32 MiB');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Do not retain the declared MIME: a package containing HTML must not open it
  // as a same-origin document even if a browser ignores the download attribute.
  return new Blob([bytes], { type: 'application/octet-stream' });
}

export function downloadBundledAttachment(url: string, label: string): void {
  const blob = bundledAttachmentBlob(url);
  const link = document.createElement('a');
  const filename = label.replace(/[<>:"/\\|?*\r\n]/g, ' ').trim();
  link.download = filename || 'attachment.bin';
  link.href = URL.createObjectURL(blob);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
