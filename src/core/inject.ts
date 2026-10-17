export const WRAPPER_PATH = '__wrapper/wrapper.js';
const TAG = `<script src="/${WRAPPER_PATH}" defer></script>`;

export function injectTag(html: string): string {
  if (html.includes(WRAPPER_PATH)) return html;
  const m = /<head[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + TAG + html.slice(m.index + m[0].length) : TAG + html;
}

/** Adds the wrapper runtime (back button, external links, toasts, debug screen) to a verified bundle. */
export function injectWrapper(files: Map<string, Uint8Array>, wrapperJs: Uint8Array): void {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  for (const [name, data] of files) {
    if (/\.html?$/i.test(name)) files.set(name, enc.encode(injectTag(dec.decode(data))));
  }
  files.set(WRAPPER_PATH, wrapperJs);
}
