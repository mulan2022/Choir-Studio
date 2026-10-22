import { Mp3Encoder } from '@breezystack/lamejs';

const BITRATE_KBPS = 192;
const SAMPLES_PER_FRAME = 1152;

self.onmessage = event => {
  try {
    const { left, right, sampleRate } = event.data;
    const encoder = new Mp3Encoder(2, sampleRate, BITRATE_KBPS);
    const chunks = [];
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    // Match the WAV export's -1 dBFS peak normalization.
    const gain = peak > 0.0001 ? 0.89 / peak : 1;
    for (let offset = 0; offset < left.length; offset += SAMPLES_PER_FRAME) {
      const length = Math.min(SAMPLES_PER_FRAME, left.length - offset);
      const pcmLeft = new Int16Array(length);
      const pcmRight = new Int16Array(length);
      for (let i = 0; i < length; i++) {
        pcmLeft[i] = Math.max(-32768, Math.min(32767, Math.round(left[offset + i] * gain * 32767)));
        pcmRight[i] = Math.max(-32768, Math.min(32767, Math.round(right[offset + i] * gain * 32767)));
      }
      const encoded = encoder.encodeBuffer(pcmLeft, pcmRight);
      if (encoded.length) chunks.push(encoded);
      if (offset % (SAMPLES_PER_FRAME * 64) === 0) {
        self.postMessage({ type: 'progress', fraction: offset / left.length });
      }
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(tail);
    self.postMessage({ type: 'done', blob: new Blob(chunks, { type: 'audio/mpeg' }) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
};
