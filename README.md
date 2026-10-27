# Beardify

Try on beards live with the selfie camera on iPhone and Android. Pick a style
and a colour, see it on your face in real time, and record a clip (with the
beard) to keep in the app or share.

## Features

- Real-time face tracking on the front camera (MediaPipe Face Landmarker, 478
  points, runs fully on the phone; nothing is uploaded).
- 7 beard styles: Stubble, Short, Full, Chin only, Goatee + mustache,
  Mustache, Chinstrap.
- 10 colours plus a custom colour picker, and a length slider. Changes apply
  instantly.
- Hold the eye button to compare with and without the beard.
- Record up to 20 s. A guide asks you to turn your head slowly left and
  right. The video includes the beard and microphone sound.
- "My videos" gallery stored on the device, with play, share (native share
  sheet, including Save Video to Photos on iOS) and delete.

## How it works

The app is a TypeScript web app (Vite) packaged as native iOS and Android apps
with Capacitor.

- `src/tracker.ts`: face landmarks per camera frame, smoothed with a One Euro
  filter so the beard is steady but keeps up with fast head turns.
- `src/beard.ts`: the beard lives on a ring around the mouth, from the lips
  out to the jaw line and cheeks. Each hair strand is anchored in that ring,
  so it follows the face as it moves, turns and talks. Styles are masks over
  the ring (`src/styles.ts`).
- `src/beard-gl.ts`: draws thousands of tapered hair strands per frame with
  WebGL (Canvas 2D fallback in `beard.ts`).
- `src/recorder.ts`: records the composited canvas with MediaRecorder (MP4 on
  iOS and Android).
- `src/gallery.ts` / `src/share.ts`: IndexedDB storage and native sharing.

## Run it

Requirements: Node 20+.

```bash
npm install          # also copies the MediaPipe runtime into public/
npm run dev          # web version at http://localhost:5173
```

The browser version needs HTTPS for the camera on a phone, so use `localhost`
on a computer, or deploy `dist/` to any HTTPS host.

### Android

Requirements: Android Studio (SDK 34).

```bash
npm run android      # builds, syncs and opens Android Studio
```

Then press Run with a phone connected. The GitHub Actions workflow in
`.github/workflows/android.yml` also builds a debug APK on every push to
`main` (download it from the run's Artifacts).

### iOS

Requirements: a Mac with Xcode 15+ and CocoaPods.

```bash
npm run ios          # builds, syncs and opens Xcode
```

Pick your Team under Signing & Capabilities, then Run on an iPhone (iOS 15+).
Camera, microphone and Photos permission texts are already in `Info.plist`.

## Changing things

- Add or tune a style: add an entry to `STYLES` in `src/styles.ts`. `mask`
  decides where hair grows (u goes around the mouth: 0 = chin, 0.5 = under the
  nose; v goes from the lips (0) to the jaw (1)), `length` sets hair length.
- Colours: `COLORS` in `src/styles.ts`.
- Maximum clip length: `MAX_SECONDS` in `src/main.ts`.
- App id and name: `capacitor.config.ts`.
