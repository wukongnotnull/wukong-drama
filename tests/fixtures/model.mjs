// Local imported model assets: real media, no network or paid generation.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Generic imported video fixtures are silent; native-audio cases create their own audio-bearing clips.
export const generation = { image: { provider: 'openai' }, video: {generate_audio:false, provider: 'seedance' } };
export function writeModelShot(file, { color = '#F2EDE3', duration = 4, size = [320, 180], fps = 30, filter, revision = 'fixture' } = {}) {
  const filmDir = path.basename(path.dirname(file)) === 'shots' ? path.dirname(path.dirname(file)) : path.dirname(file);
  const base = path.basename(file, '.json'), assets = path.join(filmDir, 'assets', 'fixture');
  fs.mkdirSync(assets, { recursive: true }); fs.mkdirSync(path.dirname(file), { recursive: true });
  const video = path.join(assets, base + '.mp4'), image = path.join(assets, base + '.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size.join('x')}:r=${fps}:d=${duration}`, ...(filter ? ['-vf', filter] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-frames:v', '1', image]);
  const definition = { image: path.relative(filmDir, image), video: path.relative(filmDir, video), revision };
  fs.writeFileSync(file, JSON.stringify(definition)); return definition;
}
export const sfxManifest = {
  license: 'Synthetic test sound fixtures', base: 'https://example.invalid/sfx',
  sounds: {
    ding: { id: 1, ext: 'wav', title: 'Bell fixture', role: 'accent', maxSeconds: 1.5, level: 0.37 },
    click: { id: 2, ext: 'wav', title: 'Click fixture', role: 'accent', maxSeconds: 0.25, level: 0.6 },
  },
};
export function writeSfxStyle(home) {
  const dir = path.join(home, 'styles', 'sound-fixture'); fs.mkdirSync(dir, { recursive: true });
  const style = { id: 'sound-fixture', name: 'Sound fixture', category: 'custom', order: 101, engine: '>=0.1.0', pipeline: 'generation', fps: 30, keywords: ['test'], sfx: 'sfx.json', loudness: -14 };
  fs.writeFileSync(path.join(dir, 'style.json'), JSON.stringify(style));
  fs.writeFileSync(path.join(dir, 'sfx.json'), JSON.stringify(sfxManifest));
  return { ...style, dir };
}
