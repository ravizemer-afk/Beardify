import './style.css';
import { BeardFrame, CANONICAL, FACE_OVAL, buildStrands, drawBeard, type Pt } from './beard';
import { COLORS, STYLES, type BeardStyle } from './styles';
import { BeardGL } from './beard-gl';
import { FaceTracker } from './tracker';
import { CanvasRecorder } from './recorder';
import { deleteClip, listClips, saveClip, type Clip } from './gallery';
import { downloadClip, shareClip } from './share';

const MAX_SECONDS = 20;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;
const video = $<HTMLVideoElement>('camera');

const state = {
  style: STYLES[2],
  color: COLORS[1].hex,
  length: 1,
  compare: false,
  strands: buildStrands(STYLES[2], 1),
};

const tracker = new FaceTracker();
const frame = new BeardFrame();
const beardGL = new URLSearchParams(location.search).has('canvas2d') ? null : BeardGL.create();
const recorder = new CanvasRecorder();
let micTrack: MediaStreamTrack | null = null;
let micAsked = false;

// ---------- Style and colour pickers ----------

const styleTiles = new Map<string, HTMLCanvasElement>();

function renderPreview(c: HTMLCanvasElement, style: BeardStyle) {
  const dpr = 2, size = 64 * dpr;
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const k = size / 21, cx = size / 2, cy = size * 0.4;
  const p = (i: number): Pt => ({ x: cx + CANONICAL[i][0] * k, y: cy + CANONICAL[i][1] * k });
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#e9c3a0';
  g.beginPath();
  FACE_OVAL.forEach((i, n) => (n ? g.lineTo(p(i).x, p(i).y) : g.moveTo(p(i).x, p(i).y)));
  g.fill();
  g.fillStyle = '#3a2a20';
  for (const [a, b] of [[33, 133], [362, 263]]) {
    const pa = p(a), pb = p(b);
    g.beginPath();
    g.ellipse((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, Math.abs(pb.x - pa.x) / 3, k * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#a5614f';
  g.lineWidth = k * 0.45;
  g.beginPath();
  g.moveTo(p(61).x, p(61).y);
  g.quadraticCurveTo(p(13).x, p(14).y, p(291).x, p(291).y);
  g.stroke();
  frame.update(p);
  drawBeard(g, frame, style, buildStrands(style, 0.35), state.color, 1);
}

function buildPickers() {
  const styles = $('styles');
  for (const s of STYLES) {
    const tile = document.createElement('button');
    tile.className = 'style-tile';
    tile.setAttribute('role', 'option');
    const c = document.createElement('canvas');
    styleTiles.set(s.id, c);
    tile.append(c, document.createTextNode(s.name));
    tile.onclick = () => selectStyle(s);
    tile.dataset.id = s.id;
    styles.append(tile);
  }
  const colors = $('colors');
  for (const col of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = col.hex;
    b.dataset.hex = col.hex;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', col.name);
    b.onclick = () => selectColor(col.hex);
    colors.append(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.setAttribute('aria-label', 'Custom colour');
  const input = document.createElement('input');
  input.type = 'color';
  input.value = state.color;
  input.oninput = () => selectColor(input.value);
  custom.append(input);
  colors.append(custom);

  $<HTMLInputElement>('length').oninput = (e) => {
    state.length = Number((e.target as HTMLInputElement).value);
  };
  refreshPickers();
}

function refreshPickers() {
  document.querySelectorAll<HTMLElement>('.style-tile').forEach((t) =>
    t.setAttribute('aria-selected', String(t.dataset.id === state.style.id)),
  );
  document.querySelectorAll<HTMLElement>('.swatch').forEach((t) =>
    t.setAttribute('aria-selected', String(t.dataset.hex === state.color || (t.classList.contains('custom') && !COLORS.some((c) => c.hex === state.color)))),
  );
  for (const s of STYLES) renderPreview(styleTiles.get(s.id)!, s);
}

function selectStyle(s: BeardStyle) {
  state.style = s;
  state.strands = buildStrands(s, 1);
  refreshPickers();
  document.querySelector(`.style-tile[data-id="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function selectColor(hex: string) {
  state.color = hex;
  refreshPickers();
}

// ---------- Camera and render loop ----------

const crop = { sx: 0, sy: 0, sw: 1, sh: 1 };

/** What is shown: the selfie camera (mirrored) or a photo or video the user picked. */
const source = {
  el: video as HTMLVideoElement | HTMLImageElement,
  mirror: true,
  get width() {
    return this.el instanceof HTMLVideoElement ? this.el.videoWidth : this.el.naturalWidth;
  },
  get height() {
    return this.el instanceof HTMLVideoElement ? this.el.videoHeight : this.el.naturalHeight;
  },
  get ready() {
    return this.el instanceof HTMLVideoElement ? this.el.readyState >= 2 : this.el.complete && this.el.naturalWidth > 0;
  },
};

function layout() {
  const vw = source.width, vh = source.height;
  if (!vw || !vh) return;
  const aspect = innerWidth / innerHeight;
  let sw = vw, sh = vh;
  if (vw / vh > aspect) sw = vh * aspect;
  else sh = vw / aspect;
  crop.sx = (vw - sw) / 2;
  crop.sy = (vh - sh) / 2;
  crop.sw = sw;
  crop.sh = sh;
  // Even dimensions keep video encoders happy.
  canvas.width = Math.round(sw / 2) * 2;
  canvas.height = Math.round(sh / 2) * 2;
}

async function startCamera() {
  // Ask for a frame in the screen's orientation so little of it is cropped away.
  const portrait = innerHeight > innerWidth;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: portrait ? 720 : 1280 },
      height: { ideal: portrait ? 1280 : 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  source.el = video;
  source.mirror = true;
  layout();
}

/** Tries the beards on a photo or video from the device instead of the camera. */
async function useFile(file: File) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.muted = v.loop = v.playsInline = true;
    v.src = url;
    await v.play();
    if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    source.el = v;
  } else {
    const img = new Image();
    img.src = url;
    await img.decode();
    source.el = img;
  }
  source.mirror = false;
  layout();
}
addEventListener('resize', layout);

let lastVideoTime = -1;
const landmark = (i: number): Pt => {
  const pts = tracker.points!;
  const v = view();
  const x = v.dx + pts[i * 2] * v.dw;
  return {
    // Mirror horizontally to match the selfie preview.
    x: source.mirror ? canvas.width - x : x,
    y: v.dy + pts[i * 2 + 1] * v.dh,
  };
};

// ---------- Lighting ----------
// Every few frames, read how bright the cheeks and forehead are and dim or
// brighten the beard a little to match. Kept mild so skin tone barely matters.

let light = 1, lightFrame = 0;
const LIGHT_POINTS = [50, 280, 9];

function sampleLight() {
  if (lightFrame++ % 8) return;
  let sum = 0, n = 0;
  for (const i of LIGHT_POINTS) {
    const p = landmark(i);
    const x = Math.round(p.x) - 3, y = Math.round(p.y) - 3;
    if (x < 0 || y < 0 || x + 6 > canvas.width || y + 6 > canvas.height) continue;
    const d = ctx.getImageData(x, y, 6, 6).data;
    for (let k = 0; k < d.length; k += 4) sum += (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
    n += d.length / 4;
  }
  if (!n) return;
  const target = Math.min(1.15, Math.max(0.65, Math.pow(sum / n / 0.45, 0.35)));
  light += (target - light) * 0.3;
}

// ---------- Zoom ----------
// At 1x the picture fills the screen (edges cropped). Below 1x the whole camera
// frame shrinks into view, like a wider lens, so more of you and the room fits.

const ZOOM_MIN = 0.5, ZOOM_MAX = 2;
let zoom = 1;

/** Where the source picture sits on the canvas at the current zoom. */
function view() {
  const k = (canvas.width / crop.sw) * zoom;
  const dw = source.width * k, dh = source.height * k;
  return { dx: (canvas.width - dw) / 2, dy: (canvas.height - dh) / 2, dw, dh };
}

function setZoom(z: number) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const label = $('zoomLabel');
  label.textContent = `${zoom < 1 ? zoom.toFixed(1).replace(/^0/, '') : Math.round(zoom * 10) / 10}x`;
  document.querySelectorAll<HTMLElement>('.zoom button[data-zoom]').forEach((b) =>
    b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.zoom) - zoom) < 0.05)),
  );
}

document.querySelectorAll<HTMLElement>('.zoom button[data-zoom]').forEach((b) => {
  b.onclick = () => setZoom(Number(b.dataset.zoom));
});

// Pinch with two fingers anywhere on the picture.
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart = 0, zoomStart = 1;
const spread = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    pinchStart = spread();
    zoomStart = zoom;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinchStart > 0) setZoom((zoomStart * spread()) / pinchStart);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  canvas.addEventListener(type, (e) => {
    pointers.delete(e.pointerId);
    pinchStart = 0;
  });
}

function loop() {
  requestAnimationFrame(loop);
  if (!source.ready) return;
  const el = source.el;
  // A still photo is tracked every frame so the smoothing settles on it.
  const time = el instanceof HTMLVideoElement ? el.currentTime : -2;
  if (time !== lastVideoTime || time === -2) {
    lastVideoTime = time;
    tracker.detect(el, performance.now());
  }
  ctx.save();
  if (source.mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  const v = view();
  if (v.dx > 0 || v.dy > 0) {
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(el, v.dx, v.dy, v.dw, v.dh);
  ctx.restore();

  const hasFace = !!tracker.points;
  $('hint').hidden = hasFace;
  if (hasFace && !state.compare) {
    frame.update(landmark);
    if (beardGL) {
      sampleLight();
      beardGL.render(canvas.width, canvas.height, frame, state.style, state.strands, state.color, state.length, light);
      ctx.drawImage(beardGL.canvas, 0, 0);
    } else {
      drawBeard(ctx, frame, state.style, state.strands, state.color, state.length);
    }
  }
  if (recorder.recording) updateRecordingUi();
}

// ---------- Recording ----------

const recordBtn = $<HTMLButtonElement>('recordBtn');
const progress = $('recProgress') as unknown as SVGCircleElement;

async function getMic() {
  if (micAsked) return micTrack;
  micAsked = true;
  // Artifacts cannot use the microphone; record silently without a warning.
  if (import.meta.env.VITE_ARTIFACT === '1') return null;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    micTrack = s.getAudioTracks()[0] ?? null;
  } catch {
    toast('No microphone access: recording without sound');
  }
  return micTrack;
}

async function toggleRecording() {
  if (recorder.recording) return finishRecording();
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
    toast('Recording is not supported on this device');
    return;
  }
  recordBtn.disabled = true;
  const mic = await getMic();
  recordBtn.disabled = false;
  recorder.start(canvas, mic);
  recordBtn.classList.add('on');
  recordBtn.setAttribute('aria-label', 'Stop recording');
  $('panel').classList.add('recording');
  $('recTimer').hidden = false;
  $('guide').hidden = false;
}

function updateRecordingUi() {
  const t = recorder.elapsed;
  $('recTime').textContent = `0:${String(Math.floor(t)).padStart(2, '0')}`;
  progress.style.strokeDashoffset = String(289 * (1 - t / MAX_SECONDS));
  progress.style.stroke = '#ff3b4e';
  if (t >= MAX_SECONDS) finishRecording();
}

let finishing = false;
async function finishRecording() {
  if (finishing) return;
  finishing = true;
  const thumb = await snapshot();
  const { blob, duration } = await recorder.stop();
  recordBtn.classList.remove('on');
  recordBtn.setAttribute('aria-label', 'Record');
  progress.style.strokeDashoffset = '0';
  progress.style.stroke = '';
  $('panel').classList.remove('recording');
  $('recTimer').hidden = true;
  $('guide').hidden = true;
  finishing = false;
  const clip: Clip = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    created: Date.now(),
    duration,
    style: state.style.name,
    color: state.color,
    video: blob,
    thumb,
  };
  try {
    await saveClip(clip);
  } catch (e) {
    console.error(e);
    toast('Could not save the video on this device');
  }
  refreshGalleryButton();
  openPlayer(clip);
}

function snapshot(): Promise<Blob> {
  const w = 240, h = Math.round((240 * canvas.height) / canvas.width);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.8));
}

// ---------- Player and gallery ----------

let current: Clip | null = null;
let playerUrl = '';

function openPlayer(clip: Clip) {
  current = clip;
  const v = $<HTMLVideoElement>('playerVideo');
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(clip.video);
  v.src = playerUrl;
  $('player').hidden = false;
  v.play().catch(() => {});
}

function closePlayer() {
  const v = $<HTMLVideoElement>('playerVideo');
  v.pause();
  v.removeAttribute('src');
  v.load();
  $('player').hidden = true;
  current = null;
}

const thumbUrls: string[] = [];
async function openGallery() {
  const clips = await listClips();
  const grid = $('grid');
  thumbUrls.splice(0).forEach(URL.revokeObjectURL);
  grid.replaceChildren(
    ...clips.map((clip) => {
      const b = document.createElement('button');
      const img = document.createElement('img');
      const url = URL.createObjectURL(clip.thumb);
      thumbUrls.push(url);
      img.src = url;
      img.alt = `${clip.style} beard, ${new Date(clip.created).toLocaleString()}`;
      const d = document.createElement('span');
      d.className = 'dur';
      d.textContent = `0:${String(Math.round(clip.duration)).padStart(2, '0')}`;
      b.append(img, d);
      b.onclick = () => openPlayer(clip);
      return b;
    }),
  );
  $('empty').hidden = clips.length > 0;
  $('gallery').hidden = false;
}

async function refreshGalleryButton() {
  const clips = await listClips().catch(() => []);
  const count = $('galleryCount');
  count.hidden = clips.length === 0;
  count.textContent = String(clips.length);
  const img = $<HTMLImageElement>('galleryThumb');
  if (img.src) URL.revokeObjectURL(img.src);
  if (clips[0]) {
    img.src = URL.createObjectURL(clips[0].thumb);
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
  }
}

function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('app').append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- Wiring ----------

recordBtn.onclick = toggleRecording;
$('galleryBtn').onclick = openGallery;
$('closeGallery').onclick = () => ($('gallery').hidden = true);
$('closePlayer').onclick = closePlayer;
$('shareBtn').onclick = () => current && shareClip(current).catch((e) => toast(`Could not share: ${e.message ?? e}`));
$('saveBtn').onclick = () => current && downloadClip(current)?.catch((e) => toast(`Could not save: ${e.message ?? e}`));
$('deleteBtn').onclick = async () => {
  const btn = $('deleteBtn');
  // Two taps instead of confirm(), which some web views block.
  if (!current) return;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Tap to confirm';
    setTimeout(() => {
      btn.dataset.armed = '';
      btn.textContent = 'Delete';
    }, 3000);
    return;
  }
  btn.dataset.armed = '';
  btn.textContent = 'Delete';
  await deleteClip(current.id);
  closePlayer();
  refreshGalleryButton();
  if (!$('gallery').hidden) openGallery();
};
const compareBtn = $('compareBtn');
const setCompare = (on: boolean) => {
  state.compare = on;
  compareBtn.classList.toggle('active', on);
};
compareBtn.onpointerdown = () => setCompare(true);
compareBtn.onpointerup = compareBtn.onpointerleave = compareBtn.onpointercancel = () => setCompare(false);
$('randomBtn').onclick = () => {
  const others = STYLES.filter((s) => s !== state.style);
  state.color = COLORS[Math.floor(Math.random() * COLORS.length)].hex;
  selectStyle(others[Math.floor(Math.random() * others.length)]);
};

async function boot() {
  buildPickers();
  refreshGalleryButton();
  const start = $<HTMLButtonElement>('startBtn');
  const showError = (msg: string) => {
    const e = $('error');
    e.textContent = msg;
    e.hidden = false;
  };
  try {
    await tracker.init();
  } catch (e) {
    console.error(e);
    showError('Could not load the face tracker. Check your connection and reopen the app.');
    start.textContent = 'Retry';
    start.disabled = false;
    start.onclick = () => location.reload();
    return;
  }
  let running = false;
  const enter = () => {
    $('splash').classList.add('gone');
    if (!running) loop();
    running = true;
  };
  start.disabled = false;
  start.textContent = 'Start camera';
  if (import.meta.env.VITE_ARTIFACT === '1') {
    // The camera is usually blocked inside claude.ai, so lead with files.
    $('fileBtn').className = 'primary wide';
    $('fileBtn').textContent = 'Choose a photo or video';
    start.className = 'ghost wide';
    start.textContent = 'Try the camera';
    $('splashText').textContent =
      'Try on beards using a photo or a short video of your face. Pick a style and colour, then record a clip.';
    $('fileBtn').after(start);
  }
  start.onclick = async () => {
    start.disabled = true;
    try {
      await startCamera();
      enter();
    } catch (e) {
      console.error(e);
      start.disabled = false;
      showError('The camera is not available here. Allow camera access, or try a photo or video instead.');
    }
  };
  const fileInput = $<HTMLInputElement>('fileInput');
  const pickFile = () => fileInput.click();
  $('fileBtn').onclick = pickFile;
  $('sourceBtn').onclick = pickFile;
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await useFile(file);
      enter();
    } catch (e) {
      console.error(e);
      showError('Could not open that file. Try a JPG or PNG photo, or an MP4 video.');
    }
  };
  if (new URLSearchParams(location.search).has('autostart')) start.click();
}

boot();
