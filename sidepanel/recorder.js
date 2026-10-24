// Screen recording from the side panel: Chrome's picker for a screen, window or tab, so the mouse
// pointer shows like a normal screen recording. Saves MP4 when Chrome can, otherwise WebM. While recording,
// a few frames are kept so the AI can read the video without uploading it.

export const MAX_MS = 5 * 60 * 1000;

export function pickMime() {
  const want = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return want.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
}
export const extFor = (mime) => (/mp4/.test(mime) ? 'mp4' : 'webm');

const VIDEO = { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 };

async function streamFor() {
  const id = await new Promise((resolve) => chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (sid) => resolve(sid)));
  if (!id) { const e = new Error('cancelled'); e.cancelled = true; throw e; }
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, ...VIDEO } } });
}

/**
 * Starts recording. Returns { stop(), stream, mime }; stop() resolves to
 * { blob, mime, ms, frames: [jpeg data URLs], thumb }. onEnd fires when sharing stops by itself.
 * `getStream` lets tests hand in a stream.
 */
export async function startRecording(kind, tab, { onEnd, getStream } = {}) {
  const stream = getStream ? await getStream() : await streamFor();
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);

  // live frames: one shortly after start, then one every few seconds; keep first, middle and last
  const video = document.createElement('video');
  video.muted = true; video.srcObject = stream; video.play().catch(() => {});
  const frames = [];
  const grab = () => {
    if (!video.videoWidth) return;
    const scale = Math.min(1, 1280 / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    frames.push({ at: Date.now(), url: c.toDataURL('image/jpeg', 0.8) });
  };
  const first = setTimeout(grab, 700);
  const every = setInterval(grab, 4000);

  const started = Date.now();
  let done = null;
  const finish = () => {
    if (done) return done;
    done = new Promise((resolve) => {
      clearTimeout(first); clearInterval(every); clearTimeout(cap);
      grab();
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        const pick = frames.length <= 3 ? frames : [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]];
        resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime: mime.split(';')[0], ms: Date.now() - started, frames: pick.map((f) => f.url), thumb: (frames[0] || {}).url || '' });
      };
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop();
    });
    return done;
  };
  const cap = setTimeout(() => { finish(); onEnd && onEnd('limit'); }, MAX_MS);
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { finish(); onEnd && onEnd('ended'); });
  rec.start(1000);
  return { stop: finish, stream, mime, started };
}

export const fmtDur = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
