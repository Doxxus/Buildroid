import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { extractZip, inspectZip } from '../src/core/zip';
import { enc } from './helpers';

const limits = { maxFiles: 5, maxTotalBytes: 10_000, maxFileBytes: 5_000 };
const html = enc('<html></html>');

describe('zip safety', () => {
  it('extracts a normal bundle', () => {
    const files = extractZip(zipSync({ 'index.html': html, 'a/b.js': enc('x') }), limits);
    expect([...files.keys()].sort()).toEqual(['a/b.js', 'index.html']);
  });

  it.each([
    ['parent traversal', '../evil.txt'],
    ['nested traversal', 'a/../../evil.txt'],
    ['absolute path', '/etc/passwd'],
    ['windows drive', 'C:/x.txt'],
    ['backslash', 'a\\b.txt'],
  ])('rejects zip-slip: %s', (_n, name) => {
    expect(() => inspectZip(zipSync({ 'index.html': html, [name]: enc('x') }), limits)).toThrow(/zip-|escapes|absolute|invalid/i);
  });

  it('rejects symlinks', () => {
    const z = zipSync({ 'index.html': html, link: [enc('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
    expect(() => inspectZip(z, limits)).toThrow(/symlink/);
  });

  it('rejects too many files', () => {
    const many: Record<string, Uint8Array> = { 'index.html': html };
    for (let i = 0; i < 6; i++) many[`f${i}`] = enc('x');
    expect(() => inspectZip(zipSync(many), limits)).toThrow(/more than/);
  });

  it('rejects a zip bomb by total size and per-file size', () => {
    const big = new Uint8Array(6_000);
    expect(() => inspectZip(zipSync({ 'index.html': html, big }), limits)).toThrow(/per-file/);
    const l = { ...limits, maxFileBytes: 5_000, maxTotalBytes: 8_000 };
    const z = zipSync({ 'index.html': html, a: new Uint8Array(4_900), b: new Uint8Array(4_900) });
    expect(() => inspectZip(z, l)).toThrow(/uncompressed size/);
  });

  it('rejects headers that lie about the uncompressed size', () => {
    const z = zipSync({ 'index.html': html, big: new Uint8Array(4_000) });
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // patch central-directory uncompressed size of every entry to 1 byte
    for (let i = 0; i < z.length - 46; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 1, true);
    expect(() => extractZip(z, limits)).toThrow();
  });

  it('requires index.html at the root', () => {
    expect(() => inspectZip(zipSync({ 'sub/index.html': html }), limits)).toThrow(/index\.html/);
  });

  it('rejects the reserved wrapper directory and duplicates', () => {
    expect(() => inspectZip(zipSync({ 'index.html': html, '__wrapper/wrapper.js': enc('x') }), limits)).toThrow(/reserved/);
    expect(() => inspectZip(zipSync({ 'index.html': html, 'A.js': enc('1'), 'a.js': enc('2') }), limits)).toThrow(/duplicate/);
  });

  it('rejects garbage', () => {
    expect(() => inspectZip(enc('not a zip'), limits)).toThrow(/valid zip/);
  });
});
