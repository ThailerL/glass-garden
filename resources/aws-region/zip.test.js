import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { storedZip, zipDirectory } from './zip.js';

// Reads the central directory back, which is all a zip reader trusts
function entriesOf(zip) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const size = zip.readUInt32LE(at + 24);
    const localNameLength = zip.readUInt16LE(offset + 26);
    entries.push({
      name: zip.subarray(at + 46, at + 46 + nameLength).toString(),
      crc: zip.readUInt32LE(at + 16),
      mode: zip.readUInt32LE(at + 38) >>> 16,
      contents: zip.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + size)
    });
    at += 46 + nameLength;
  }
  return entries;
}

describe('storedZip', () => {
  it('writes each file once, findable from the central directory, with its mode', () => {
    const contents = Buffer.from('export const handler = async () => 1;\n');
    const zip = storedZip([
      { name: 'index.mjs', contents, mode: 0o100644 },
      { name: 'bin/tool', contents: Buffer.from('#!/bin/sh\n'), mode: 0o100755 }
    ]);
    const [index, tool] = entriesOf(zip);
    expect(index).toMatchObject({ name: 'index.mjs', crc: crc32(contents), mode: 0o644 });
    expect(index.contents.equals(contents)).toBe(true);
    expect(tool).toMatchObject({ name: 'bin/tool', mode: 0o755 });
  });

  it('makes an empty package for no files', () => {
    expect(entriesOf(storedZip([]))).toEqual([]);
  });
});

describe('zipDirectory', () => {
  it('walks the tree in name order, keeps the relative path, and skips symlinks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-zip-'));
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.mjs'), 'b');
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'c');
    fs.writeFileSync(path.join(root, 'README.md'), 'a');
    fs.symlinkSync(path.join(root, 'index.mjs'), path.join(root, 'link.mjs'));
    const names = entriesOf(await zipDirectory(root)).map((entry) => entry.name);
    expect(names).toEqual(['README.md', 'index.mjs', 'node_modules/dep/index.js']);
    // The same tree makes the same bytes, which is what the code hash relies on
    expect((await zipDirectory(root)).equals(await zipDirectory(root))).toBe(true);
    fs.rmSync(root, { recursive: true });
  });
});
