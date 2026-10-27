// On-device face tracking with MediaPipe Face Landmarker (478 landmarks), plus
// a One Euro filter so the beard stays steady when still but keeps up with
// quick head turns.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
/** Built for a claude.ai Artifact, where scripts may only load from public CDNs. */
const ARTIFACT = import.meta.env.VITE_ARTIFACT === '1';
// Artifacts only serve web file types, so the model ships with a .wasm name there.
const MODEL_PATH = `${BASE}models/face_landmarker.${ARTIFACT ? 'model.wasm' : 'task'}`;
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

export class FaceTracker {
  private landmarker!: FaceLandmarker;
  private filters: OneEuro[] = [];
  private lastTime = -1;
  private missed = 0;
  /** Smoothed landmarks in normalized video coordinates, or null when no face. */
  points: Float32Array | null = null;

  async init() {
    const fileset = ARTIFACT
      ? {
          wasmLoaderPath: `${MEDIAPIPE_CDN}/vision_wasm_internal.js`,
          wasmBinaryPath: `${BASE}mediapipe/wasm/vision_wasm_internal.wasm`,
        }
      : await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await make('GPU');
    } catch (e) {
      console.warn('GPU delegate unavailable, using CPU', e);
      this.landmarker = await make('CPU');
    }
  }

  detect(video: HTMLVideoElement | HTMLImageElement, nowMs: number) {
    // detectForVideo needs strictly increasing timestamps.
    const t = Math.max(nowMs, this.lastTime + 1);
    this.lastTime = t;
    const res = this.landmarker.detectForVideo(video, t);
    const face = res.faceLandmarks[0];
    if (!face) {
      // Hold the last pose for a few frames to hide brief tracking drops.
      if (++this.missed > 6) {
        this.points = null;
        this.filters = [];
      }
      return;
    }
    this.missed = 0;
    if (!this.points || this.points.length !== face.length * 2) {
      this.points = new Float32Array(face.length * 2);
      this.filters = Array.from({ length: face.length * 2 }, () => new OneEuro(1.2, 6));
    }
    const sec = t / 1000;
    for (let i = 0; i < face.length; i++) {
      this.points[i * 2] = this.filters[i * 2].filter(face[i].x, sec);
      this.points[i * 2 + 1] = this.filters[i * 2 + 1].filter(face[i].y, sec);
    }
  }
}

/** One Euro filter (Casiez et al. 2012) for a single value. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, t: number) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
