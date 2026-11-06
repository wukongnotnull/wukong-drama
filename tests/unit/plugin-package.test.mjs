import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const assertDomainEntries = has => {
  for(const file of ['engine/bin/args.mjs','engine/core/compat.mjs'])assert.equal(has(file),false,file);
  for (const [domain,names] of Object.entries({generation:['generation','image-source','image-batches','generation-budget'],delivery:['delivery','final-delivery','delivery-inputs']})) {
    for (const name of names) {
      assert.ok(has(`engine/${domain}/${name}.mjs`),`missing ${domain}/${name}`);
      assert.equal(has(`engine/core/${name}.mjs`),false,`obsolete core/${name}`);
    }
  }
};

test('plugin identities and model-drama metadata agree across host manifests', () => {
  const portable = json('plugin/plugin.json');
  const codex = json('plugin/.codex-plugin/plugin.json');
  const claude = json('plugin/.claude-plugin/plugin.json');
  assert.equal(portable.version, '0.1.0');
  for (const manifest of [portable, codex, claude]) {
    assert.equal(manifest.name, 'wukong-drama');
    assert.equal(manifest.version, portable.version);
    assert.equal(manifest.description, portable.description);
    assert.match(manifest.description, /图片.*视频.*模型|模型.*短剧/);
    assert.equal(manifest.repository, undefined, 'do not claim an uncreated repository');
  }
  const presentation = portable.extensions['com.openai'].interface;
  assert.deepEqual(codex.interface, presentation);
  assert.ok(Array.isArray(presentation.capabilities));
  assert.ok([...presentation.shortDescription].length <= 30);
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].name, portable.name);
  const listing = json('.claude-plugin/marketplace.json');
  assert.equal(listing.metadata.version, portable.version);
  assert.equal(listing.plugins[0].version, portable.version);
  assert.equal(listing.plugins[0].description, portable.description);
  const engine = json('plugin/engine/package.json');
  const lock = json('plugin/engine/package-lock.json');
  assert.equal(engine.bin.wkd, 'bin/wkd.mjs');
  assert.equal(engine.version, portable.version, 'plugin and engine share a release version');
  assert.equal(lock.version, portable.version);
  assert.equal(lock.packages[''].version, portable.version);
});

function zipFiles(bytes) {
  const entries = new Map();
  for (let cursor = 0; bytes.readUInt32LE(cursor) === 0x04034b50;) {
    assert.equal(bytes.readUInt16LE(cursor + 8), 0, 'store-only ZIP');
    const size = bytes.readUInt32LE(cursor + 18);
    const nameLength = bytes.readUInt16LE(cursor + 26);
    const extraLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString();
    const start = cursor + 30 + nameLength + extraLength;
    entries.set(name, bytes.subarray(start, start + size));
    cursor = start + size;
  }
  return entries;
}

test('native archive contains one portable plugin and excludes local runtime state', async t => {
  const modulePath = path.join(root, 'tools/build-plugin.mjs');
  assert.ok(fs.existsSync(modulePath), 'native plugin builder must exist');
  const { buildPlugin } = await import(pathToFileURL(modulePath));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-package-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const write = (file, data) => {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };
  write('plugin/plugin.json', JSON.stringify(json('plugin/plugin.json')));
  write('plugin/skills/film/SKILL.md', '---\nname: film\ndescription: Make a drama\n---\nMake a drama.\n');
  write('plugin/engine/bin/wkd.mjs', 'console.log("wkd");\n');
  write('LICENSE', 'MIT fixture\n');
  write('LICENSE-MEDIA', 'Curated demonstration media attribution\n');
  write('docs/UPSTREAM.md', 'Upstream provenance\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: fixture, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','base'], {cwd:fixture,stdio:'ignore'});
  // Newly authored runtime source belongs in the archive even before commit.
  write('plugin/engine/providers/new-provider.mjs', 'export const name = "new";\n');
  const example = 'skills/cinematic/examples/stealing-kitten/media';
  write(`plugin/${example}/final/portrait.mp4`, 'approved demonstration video');
  write(`plugin/${example}/audio/bgm.wav`, 'approved demonstration audio');
  write('plugin/skills/cinematic/examples/other/media/clip.mp4', 'unrelated film must not ship');
  write(`plugin/${example}/generated/task.mp4`, 'generation state must not ship');
  for (const file of ['plugin/.env', 'plugin/.env.local', 'plugin/engine/node_modules/pkg/index.js', 'plugin/engine/.cache/task.json', 'plugin/skills/film/outputs/response.json', 'plugin/skills/film/review/review.json', 'plugin/skills/film/clip.mp4', 'plugin/private-key.pem']) write(file, 'must not ship');
  const first = buildPlugin({ root: fixture, out: path.join(fixture, 'dist'), mode:'development' });
  const bytes = fs.readFileSync(first.archive);
  const files = zipFiles(bytes);
  assert.equal(path.basename(first.archive), `wukong-drama-plugin-v${json('plugin/plugin.json').version}-development.zip`);
  assert.equal(JSON.parse(files.get('plugin.json')).name, 'wukong-drama');
  assert.ok(files.has('skills/film/SKILL.md'));
  assert.ok(files.has('engine/bin/wkd.mjs'));
  assert.ok(files.has('engine/providers/new-provider.mjs'));
  assert.ok(files.has('LICENSE'));
  assert.ok(files.has('UPSTREAM.md'));
  assert.ok(files.has('LICENSE-MEDIA'));
  assert.equal(JSON.parse(files.get('build-info.json')).buildMode,'development');
  assert.equal(files.get(`${example}/final/portrait.mp4`).toString(), 'approved demonstration video');
  assert.equal(files.get(`${example}/audio/bgm.wav`).toString(), 'approved demonstration audio');
  assert.ok(!files.has('skills/cinematic/examples/other/media/clip.mp4'));
  assert.ok(!files.has(`${example}/generated/task.mp4`));
  assert.equal(files.size, 10);
  assert.ok([...files.keys()].every(name => !name.startsWith('plugin/')));
  const second = buildPlugin({ root: fixture, out: path.join(fixture, 'dist'), mode:'development' });
  assert.deepEqual(fs.readFileSync(second.archive), bytes, 'identical sources produce identical archives');
  assert.equal(fs.readFileSync(second.checksum, 'utf8'), `${second.sha256}  ${path.basename(second.archive)}\n`);
});

test('native archive ships every authored skill, model provider and film schema', async t => {
  const { buildPlugin } = await import('../../tools/build-plugin.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-runtime-package-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const result = buildPlugin({ root, out, mode:'development' });
  const files = zipFiles(fs.readFileSync(result.archive));
  assert.equal(JSON.parse(files.get('plugin.json')).version, result.version);
  assert.equal(JSON.parse(files.get('engine/package.json')).version, result.version);
  const skills = fs.readdirSync(path.join(root, 'plugin/skills')).filter(name => fs.existsSync(path.join(root, 'plugin/skills', name, 'SKILL.md')));
  for (const skill of skills) assert.ok(files.has(`skills/${skill}/SKILL.md`), skill);
  const providers = fs.readdirSync(path.join(root, 'plugin/engine/providers')).filter(name => name.endsWith('.mjs'));
  for (const file of providers) assert.ok(files.has(`engine/providers/${file}`), file);
  assert.ok(files.has('engine/pipelines/generation/index.mjs'));
  assertDomainEntries(file=>files.has(file));
  assert.ok(files.has('skills/ink-wash/examples/demo/shots/s01.json'));
  assert.ok([...files.keys()].every(file => !/^(engine\/(runtime|kits)\/|engine\/pipelines\/(browser|remotion|manim)\/|skills\/keynote\/)/.test(file)));
  assert.deepEqual(JSON.parse(files.get('catalog.json')).styles.map(style => style.id).sort(), ['anime', 'cinematic', 'ink-wash']);
  assert.ok(JSON.parse(files.get('engine/schemas/film.schema.json')).properties.generation);
});

test('portable bundle preserves upstream attribution and all tracked provider sources', async t => {
  const { build } = await import('../../tools/build-portable.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-portable-package-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const result = build(out,{mode:'development'});
  const manifest = JSON.parse(fs.readFileSync(path.join(result.bundle, 'bundle.json'), 'utf8'));
  assert.equal(manifest.pluginVersion, json('plugin/plugin.json').version);
  assert.equal(manifest.engineVersion, manifest.pluginVersion);
  assert.equal(path.basename(result.archive), `wukong-drama-agent-skills-v${manifest.pluginVersion}-development.zip`);
  assert.ok(fs.existsSync(path.join(result.bundle, 'UPSTREAM.md')), 'portable packages must retain upstream provenance');
  assert.ok(fs.existsSync(path.join(result.bundle, 'LICENSE-MEDIA')), 'portable packages must retain media attribution');
  assertDomainEntries(file=>fs.existsSync(path.join(result.bundle,file)));
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'plugin/engine/providers'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of tracked) assert.ok(fs.existsSync(path.join(result.bundle, file.slice('plugin/'.length))), file);
});
