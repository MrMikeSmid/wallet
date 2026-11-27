import decodeQR from '@paulmillr/qr/decode.js';

/** Opent de camera en leest een QR-code. Geeft een stop-functie terug. */
export async function startScan(video: HTMLVideoElement, onResult: (text: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  const tick = () => {
    if (stopped) return;
    if (video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const text = decodeQR(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (text) { stop(); onResult(text); return; }
      } catch { /* nog geen code gevonden */ }
    }
    setTimeout(tick, 250);
  };
  tick();
  return stop;
}
