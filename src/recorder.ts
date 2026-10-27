// Records the composited canvas (camera + beard) together with the microphone.

const MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  get recording() {
    return this.recorder?.state === 'recording';
  }
  get elapsed() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(canvas: HTMLCanvasElement, audio: MediaStreamTrack | null) {
    const stream = canvas.captureStream(30);
    if (audio) stream.addTrack(audio);
    const mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
    });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();
  }

  /** Stops recording and resolves with the finished video. */
  stop(): Promise<{ blob: Blob; duration: number }> {
    const rec = this.recorder;
    if (!rec) return Promise.reject(new Error('Not recording'));
    const duration = this.elapsed;
    return new Promise((resolve) => {
      rec.onstop = () => {
        // Release the canvas capture track; the shared microphone track stays alive.
        rec.stream.getVideoTracks().forEach((t) => t.stop());
        const type = rec.mimeType || this.chunks[0]?.type || 'video/webm';
        resolve({ blob: new Blob(this.chunks, { type }), duration });
        this.recorder = null;
      };
      rec.stop();
    });
  }
}
