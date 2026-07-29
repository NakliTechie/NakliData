/** Save HTML through the shared text-file path. */
export async function saveHtmlFile(html: string, suggestedName: string): Promise<string> {
  return saveTextFile(html, suggestedName, {
    mime: 'text/html',
    description: 'HTML',
    extensions: ['.html'],
  });
}

/**
 * Save a text artifact with File System Access when available, or a normal
 * browser download otherwise. An empty return value means the user cancelled.
 */
export async function saveTextFile(
  text: string,
  suggestedName: string,
  opts: { mime: string; description: string; extensions: string[] },
): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  type Picker = (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: opts.description, accept: { [opts.mime]: opts.extensions } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([new Uint8Array(bytes)], { type: opts.mime }));
      await writable.close();
      return handle.name;
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return '';
      throw error;
    }
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: opts.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return suggestedName;
}
