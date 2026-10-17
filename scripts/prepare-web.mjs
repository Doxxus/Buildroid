// After `vite build` (which emits dist/__wrapper/wrapper.js): copy the bundled site into dist/ and inject the wrapper tag.
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG = '<script src="/__wrapper/wrapper.js" defer></script>';
const src = 'bundled-site';
if (!existsSync(join(src, 'index.html'))) throw new Error('bundled-site/index.html is required');
if (!existsSync(join('dist', '__wrapper', 'wrapper.js'))) throw new Error('dist/__wrapper/wrapper.js missing; run vite build');
cpSync(src, 'dist', { recursive: true });

function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== '__wrapper') walk(p);
    } else if (/\.html?$/i.test(n)) {
      const html = readFileSync(p, 'utf8');
      if (html.includes('__wrapper/wrapper.js')) continue;
      const m = /<head[^>]*>/i.exec(html);
      writeFileSync(p, m ? html.slice(0, m.index + m[0].length) + TAG + html.slice(m.index + m[0].length) : TAG + html);
    }
  }
}
walk('dist');
console.log('dist/ prepared');
