import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = dirname(import.meta.dir);
const extensionDir = join(root, 'dist');
const manifestPath = join(extensionDir, 'manifest.json');
const downloadsDir = join(root, 'landing', 'public', 'downloads');

function fail(message: string): never {
  console.error(`[AIRA release] ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) fail('dist/manifest.json tidak ditemukan. Jalankan build ekstensi terlebih dahulu.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string };
if (!manifest.name || !manifest.version) fail('Manifest tidak memiliki name atau version yang valid.');

const requiredEntries = ['manifest.json', 'background', 'content', 'popup', 'icons'];
for (const entry of requiredEntries) {
  if (!existsSync(join(extensionDir, entry))) fail(`Artefak ekstensi tidak lengkap: ${entry} tidak ditemukan.`);
}

mkdirSync(downloadsDir, { recursive: true });
for (const file of ['aira-extension.zip', `aira-extension-v${manifest.version}.zip`]) {
  const target = join(downloadsDir, file);
  if (existsSync(target)) rmSync(target, { force: true });
}

const output = join(downloadsDir, 'aira-extension.zip');
const versionedOutput = join(downloadsDir, `aira-extension-v${manifest.version}.zip`);

function collectFiles(relativePath: string): string[] {
  const absolutePath = join(extensionDir, relativePath);
  if (statSync(absolutePath).isFile()) return [relativePath];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = join(relativePath, entry.name);
    return entry.isDirectory() ? collectFiles(child) : [child];
  });
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(): Buffer {
  const files = requiredEntries.flatMap(collectFiles).sort();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = file.replaceAll('\\', '/');
    const nameBytes = Buffer.from(name);
    const source = readFileSync(join(extensionDir, file));
    const compressed = deflateRawSync(source, { level: 9 });
    const method = compressed.length < source.length ? 8 : 0;
    const payload = method === 8 ? compressed : source;
    const checksum = crc32(source);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, payload);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);

    offset += local.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

try {
  writeFileSync(output, createZip());
} catch (error) {
  fail(`Gagal membuat ZIP: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  copyFileSync(output, versionedOutput);
} catch {
  fail('Gagal membuat salinan ZIP versi.');
}

console.log(`[AIRA release] ✓ ${output.replace(`${root}/`, '')}`);
console.log(`[AIRA release] ✓ ${versionedOutput.replace(`${root}/`, '')}`);
