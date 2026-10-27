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

export async function shareClip(clip: Clip) {
  const name = fileName(clip);
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

export function downloadClip(clip: Clip) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(clip.video);
  a.download = fileName(clip);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
