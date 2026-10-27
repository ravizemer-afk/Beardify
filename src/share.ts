// Sharing and saving videos: native share sheet inside the iOS/Android app,
// Web Share API or a download in the browser.

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { fileExtension, type Clip } from './gallery';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const fileName = (clip: Clip) =>
  `beard-${new Date(clip.created).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${fileExtension(clip.video.type)}`;

type Downloads = { save(req: { filename: string; data: Blob }): Promise<unknown> };
type ClaudeHost = { use(name: 'downloads'): Promise<Downloads | null> };

/** Inside a claude.ai Artifact, files go out through the host's save prompt
 *  (the share sheet in the Claude iOS app). */
async function hostDownloads(): Promise<Downloads | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  return host?.use ? host.use('downloads').catch(() => null) : null;
}

export async function shareClip(clip: Clip) {
  const name = fileName(clip);
  const downloads = await hostDownloads();
  if (downloads) {
    await saveVia(downloads, clip);
    return;
  }
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: name,
      data: await blobToBase64(clip.video),
      directory: Directory.Cache,
    });
    // The share sheet also offers "Save Video" (iOS) / save to Files or Photos (Android).
    await Share.share({ title: 'My beard', files: [uri] });
    return;
  }
  const file = new File([clip.video], name, { type: clip.video.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My beard' });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  downloadClip(clip);
}

async function saveVia(downloads: Downloads, clip: Clip) {
  try {
    await downloads.save({ filename: fileName(clip), data: clip.video });
  } catch (e) {
    if ((e as { code?: string }).code !== 'declined') throw new Error((e as Error).message ?? 'Save failed');
  }
}

export async function downloadClip(clip: Clip) {
  const downloads = await hostDownloads();
  if (downloads) return saveVia(downloads, clip);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(clip.video);
  a.download = fileName(clip);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
