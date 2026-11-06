#!/usr/bin/env node
// Native private plugin archive. No network, installation, or dependency bundling.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectResources, assertResourcesUnchanged, LICENSE_FILES, buildOptions } from './lib/package-resources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Store-only, deterministic ZIP: fixed DOS date, UTF-8 paths, no OS metadata.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), crc = crc32(data);
    const header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(record, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function buildPlugin({ root = ROOT, out = path.join(root, 'dist'), mode = 'release' } = {}) {
  root = path.resolve(root); out = path.resolve(out);
  if (out === path.join(root, 'plugin') || out.startsWith(path.join(root, 'plugin') + path.sep)) throw new Error('Archive output must be outside plugin/');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin/plugin.json'), 'utf8'));
  if (manifest.name !== 'wukong-drama' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Invalid wukong-drama plugin identity/version');
  if (manifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') throw new Error('Missing portable plugin schema');
  const resources = collectResources({root,target:'native',mode});
  const sources = resources.files;
  const entries = sources.map(file => {
    const source = path.join(root, file);
    if (!fs.lstatSync(source).isFile()) throw new Error('Plugin source must be a regular file: ' + file);
    return [file.slice('plugin/'.length), fs.readFileSync(source)];
  });
  if (!entries.some(([name]) => /^skills\/[^/]+\/SKILL\.md$/.test(name))) throw new Error('Plugin has no usable skill entrypoint');
  for (const [file, name] of LICENSE_FILES) entries.push([name, fs.readFileSync(path.join(root, file))]);
  entries.push(['build-info.json',Buffer.from(JSON.stringify({schemaVersion:1,buildMode:mode,sourceCommit:resources.sourceCommit,files:entries.map(([name,data])=>({path:name,sha256:crypto.createHash('sha256').update(data).digest('hex')}))},null,2)+'\n')]);
  assertResourcesUnchanged(resources);
  entries.sort(([a], [b]) => a.localeCompare(b, 'en'));
  fs.mkdirSync(out, { recursive: true });
  const name = `wukong-drama-plugin-v${manifest.version}${mode==='development'?'-development':''}.zip`;
  const archive = path.join(out, name), checksum = archive + '.sha256';
  const bytes = zip(entries), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const part = archive + '.part';
  try { fs.writeFileSync(part, bytes); fs.renameSync(part, archive); }
  finally { fs.rmSync(part, { force: true }); }
  fs.writeFileSync(checksum, `${sha256}  ${name}\n`);
  return { buildMode:mode, sourceCommit:resources.sourceCommit, archive, checksum, version: manifest.version, files: entries.length, bytes: bytes.length, sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options=buildOptions(process.argv.slice(2));
    console.log(JSON.stringify(buildPlugin({...options,...(options.out?{}:{out:path.join(ROOT,'dist')})}),null,2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
