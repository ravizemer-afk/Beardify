// Copies the MediaPipe runtime into public/ so the app works offline inside
// the native apps (no CDN needed at run time).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/mediapipe/wasm', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
