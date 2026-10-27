// Packs the artifact build into one HTML page (CSS and JS inline) plus the two
// binary files it fetches: the MediaPipe wasm and the face model.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dist = 'dist-artifact';
const out = 'artifact';
const html = readFileSync(`${dist}/index.html`, 'utf8');
const assets = readdirSync(`${dist}/assets`);
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`${dist}/assets/${f}`, 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`${dist}/assets/${f}`, 'utf8')).join('\n');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

mkdirSync(`${out}/mediapipe/wasm`, { recursive: true });
mkdirSync(`${out}/models`, { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', `${out}/mediapipe/wasm/vision_wasm_internal.wasm`);
cpSync('public/models/face_landmarker.task', `${out}/models/face_landmarker.model.wasm`);
writeFileSync(
  `${out}/index.html`,
  `<title>Beardify</title>\n<style>\n${css}\n</style>\n${body.trim()}\n<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>\n`,
);
console.log('artifact/index.html', (readFileSync(`${out}/index.html`).length / 1024).toFixed(0), 'KB');
