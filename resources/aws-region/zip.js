// A function's deployment package, built from its node directory the way `zip -r` would,
// with every entry stored rather than deflated: the emulator unpacks it once per code
// hash, and a handler's node_modules are mostly already-compressed text at a size where
// the copy costs more than the bytes. Only what a zip reader needs is written.
import fs from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
// "Version made by" 3 = Unix, so the mode in the external attributes is honoured
const UNIX_ZIP_VERSION = (3 << 8) | 20;

// files: [{ name, contents, mode }], names with forward slashes, no leading slash
export function storedZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, contents, mode } of files) {
    const fileName = Buffer.from(name);
    const crc = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, contents);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL_HEADER, 0);
    entry.writeUInt16LE(UNIX_ZIP_VERSION, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(contents.length, 20);
    entry.writeUInt32LE(contents.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE((mode & 0o777) << 16, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, fileName);
    offset += local.length + fileName.length + contents.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// Regular files only, in a fixed order so the same tree hashes the same: a symlink has no
// target on Lambda, and node_modules/.bin is nothing but symlinks
async function walk(root, relative = '', files = []) {
  const entries = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(root, name, files);
    } else if (entry.isFile()) {
      const file = path.join(root, name);
      const { mode } = await fs.promises.stat(file);
      files.push({ name, contents: await fs.promises.readFile(file), mode });
    }
  }
  return files;
}

// Read without blocking: the region serves every AWS request from this one process
export const zipDirectory = async (root) => storedZip(await walk(root));
