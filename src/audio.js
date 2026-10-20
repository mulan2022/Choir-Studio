import { WorkletSynthesizer } from 'spessasynth_lib';
import { beatToSeconds, expressionAt } from './score.js';

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// 16-bit stereo PCM, written byte by byte instead of going through a helper that
// might normalise the peak — the export has to keep the mixer's relative levels.
function encodeWav(left, right, sampleRate) {
  const frames = left.length;
  const bytes = frames * 4;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, bytes, true);
  // Peak-normalise to -1 dBFS: the analyser tap sits well below full scale
  // (the synthesizer spreads its mix over 17 stereo outputs), and a consistent
  // level matters more than the raw absolute one. Relative part balance is
  // untouched because the same factor scales the whole file.
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0.0001 ? 0.89 / peak : 1;
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, clamp(Math.round(left[i] * gain * 32767), -32768, 32767), true);
    view.setInt16(offset + 2, clamp(Math.round(right[i] * gain * 32767), -32768, 32767), true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// The trimmed bank only carries the four "doo" presets and one piano velocity
// layer (see scripts/repack-soundfont.mjs), so a first visit downloads ~32 MB
// instead of ~70 MB. Point VITE_SOUNDFONT_URL at a CDN to move it off the site.
const SOUNDFONT_URL = import.meta.env.VITE_SOUNDFONT_URL || `${import.meta.env.BASE_URL}soundfonts/choir-practice-lite.sf2`;
const PROCESSOR_URL = `${import.meta.env.BASE_URL}spessasynth_processor.min.js`;
const RECORDER_URL = `${import.meta.env.BASE_URL}choir-recorder-worklet.js`;
// Room for the last release and a little reverb tail after the final note.
const EXPORT_TAIL_SECONDS = 1.8;
const SOUNDFONT_CACHE = 'choirsinger-soundfont-v1';

async function readCachedBank(url) {
  try {
    if (!('caches' in globalThis)) return null;
    const cache = await caches.open(SOUNDFONT_CACHE);
    const hit = await cache.match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch { return null; }
}

async function writeCachedBank(url, buffer) {
  try {
    if (!('caches' in globalThis)) return;
    const cache = await caches.open(SOUNDFONT_CACHE);
    await cache.put(url, new Response(buffer.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
  } catch { /* private mode or quota: the next visit just downloads again */ }
}

// The bank buffer is handed to the synthesizer, which transfers it to the
// worker and detaches it. Snapshot it first or the cache write loses the race
// and saves nothing.
function rememberBank(url, buffer) {
  const snapshot = buffer.slice(0);
  writeCachedBank(url, snapshot);
}

async function fetchSoundBank(url, onProgress) {
  const cached = await readCachedBank(url);
  if (cached) {
    onProgress?.({ loaded: cached.byteLength, total: cached.byteLength, cached: true });
    return cached;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`合唱音色下载失败（HTTP ${response.status}）。`);
  const header = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total: header || buffer.byteLength });
    rememberBank(url, buffer);
    return buffer;
  }
  const chunks = [];
  let loaded = 0;
  let lastReport = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastReport > 100) { lastReport = now; onProgress?.({ loaded, total: header }); }
  }
  const buffer = await new Blob(chunks).arrayBuffer();
  onProgress?.({ loaded, total: header || loaded });
  rememberBank(url, buffer);
  return buffer;
}

export class ChoirPlayer {
  constructor(onProgress, onStatus, onDownload) {
    this.onProgress = onProgress;
    this.onStatus = onStatus;
    this.onDownload = onDownload;
    this.score = null;
    this.mode = 'voice';
    this.tempoScale = 1;
    this.position = 0;
    this.playing = false;
    // Keep recognition review literal for now. Expression and ornaments can
    // be enabled after pitch and rhythm have been checked against the source.
    this.expressivePlayback = false;
    this.events = [];
    this.nextEvent = 0;
    this.timer = null;
    this.playVersion = 0;
    this.starting = false;
    this.pendingMidiUntil = 0;
    this.exporting = false;
    this.exportTimer = null;
    this.exportTotal = 0;
    this.exportCancel = false;
    this.recorderReady = false;
    this.monitorMuted = false;
  }

  async initialize() {
    if (this.synth) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.createSynth();
    try { await this.initializing; }
    finally { this.initializing = null; }
  }

  async createSynth() {
    this.onStatus('正在载入合唱音色…');
    const context = new AudioContext();
    await context.audioWorklet.addModule(PROCESSOR_URL);
    let bank;
    try {
      bank = await fetchSoundBank(SOUNDFONT_URL, progress => this.onDownload?.(progress));
    } catch (error) {
      throw new Error(`合唱音色载入失败：${error.message}`);
    }
    const synth = new WorkletSynthesizer(context);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    synth.connect(analyser);
    const masterGain = context.createGain();
    masterGain.gain.value = 0;
    analyser.connect(masterGain).connect(context.destination);
    await synth.soundBankManager.addSoundBank(bank, 'choir');
    await synth.isReady;
    this.context = context;
    this.synth = synth;
    this.analyser = analyser;
    this.masterGain = masterGain;
    this.onStatus('音色已就绪');
    this.onDownload?.({ done: true });
  }

  setScore(score) {
    this.pause();
    this.score = score;
    this.position = 0;
    this.onProgress(0, this.duration);
  }

  get duration() { return this.score ? beatToSeconds(this.score, this.score.totalBeats, this.tempoScale) : 0; }

  currentSeconds() {
    return this.playing ? clamp(this.offsetSeconds + (this.context.currentTime - this.startTime), 0, this.duration) : beatToSeconds(this.score, this.position, this.tempoScale);
  }

  secondsToBeat(seconds) {
    let lo = 0, hi = this.score.totalBeats;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (beatToSeconds(this.score, mid, this.tempoScale) < seconds) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  setMode(mode) { this.mode = mode; this.restartIfPlaying(); }
  setTempo(scale) {
    const wasPlaying = this.playing;
    const beat = this.secondsToBeatSafe(this.currentSeconds());
    this.pause(false);
    this.position = beat;
    this.tempoScale = scale;
    if (wasPlaying) this.play(beat);
    this.onProgress(this.currentSeconds(), this.duration);
  }
  secondsToBeatSafe(seconds) { return this.score ? this.secondsToBeat(seconds) : 0; }
  updateMix() { this.restartIfPlaying(); }
  restartIfPlaying() { if (this.playing) { const at = this.position = this.secondsToBeat(this.currentSeconds()); this.pause(false); this.play(at); } }

  seek(seconds) {
    if (!this.score) return;
    const wasPlaying = this.playing;
    this.pause(false);
    this.position = this.secondsToBeat(clamp(seconds, 0, this.duration));
    this.onProgress(this.currentSeconds(), this.duration);
    if (wasPlaying) this.play();
  }

  pause(updatePosition = true) {
    if (this.exporting) { this.exportCancel = true; this.stopExportSampling(); }
    this.playVersion++;
    this.starting = false;
    if (updatePosition && this.playing) this.position = this.secondsToBeat(this.currentSeconds());
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
    }
    this.synth?.stopAll(true);
    if (this.score) this.onProgress(this.currentSeconds(), this.duration);
  }

  async play(at = this.position) {
    if (!this.score) return;
    const version = ++this.playVersion;
    this.starting = true;
    this.onProgress(this.currentSeconds(), this.duration);
    await this.initialize();
    if (version !== this.playVersion) return;
    await this.context.resume();
    if (version !== this.playVersion) return;
    const staleWait = Math.max(0, this.pendingMidiUntil - this.context.currentTime + 0.02);
    if (staleWait) await new Promise(resolve => setTimeout(resolve, staleWait * 1000));
    if (version !== this.playVersion) return;
    this.synth.stopAll(true);
    this.pendingMidiUntil = 0;
    this.position = at;
    this.offsetSeconds = beatToSeconds(this.score, at, this.tempoScale);
    this.startTime = this.context.currentTime + 0.06;
    if (this.masterGain) {
      const gain = this.masterGain.gain;
      gain.cancelScheduledValues(this.context.currentTime);
      gain.setValueAtTime(0, this.context.currentTime);
      if (!this.monitorMuted) gain.linearRampToValueAtTime(1, this.startTime + 0.015);
    }
    this.events = this.buildEvents().filter(e => e.seconds >= this.offsetSeconds - 0.001);
    for (const track of this.score.tracks.filter(t => t.enabled)) {
      for (const note of this.performanceNotes(track)) {
        if (note.beat < at - 0.001 && note.end > at + 0.001) {
          this.events.push({ seconds: this.offsetSeconds, send: (s, time) => {
            s.noteOn(track.channel, note.midi, note.velocity, { time });
            this.pendingMidiUntil = Math.max(this.pendingMidiUntil, time);
          } });
        }
      }
    }
    this.events.sort((a, b) => a.seconds - b.seconds);
    this.nextEvent = 0;
    this.lastMix = this.score.tracks.map(track => ({
      channel: track.channel,
      program: this.mode === 'piano' ? 21 : track.program,
      volume: Math.round(track.volume * 127),
    }));
    for (const track of this.score.tracks) {
      this.synth.programChange(track.channel, this.mode === 'piano' ? 21 : track.program);
      this.synth.pitchWheelRange(track.channel, 12);
      this.synth.controllerChange(track.channel, 7, Math.round(track.volume * 127));
      this.synth.controllerChange(track.channel, 11, this.expressivePlayback ? expressionAt(track, at) : 100);
    }
    this.playing = true;
    this.starting = false;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30);
  }

  tick() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    // OSMD layout and page scrolling can briefly occupy the main thread.
    // Queue MIDI events well ahead of the visual cursor so barlines stay on time.
    while (this.nextEvent < this.events.length && this.startTime + this.events[this.nextEvent].seconds - this.offsetSeconds < now + 0.18) {
      const event = this.events[this.nextEvent++];
      const time = Math.max(now, this.startTime + event.seconds - this.offsetSeconds);
      if (event.startsNote && event.endSeconds <= this.offsetSeconds + now - this.startTime) continue;
      event.send(this.synth, time);
      this.pendingMidiUntil = Math.max(this.pendingMidiUntil, time);
    }
    const elapsed = this.currentSeconds();
    this.onProgress(elapsed, this.duration);
    if (this.exporting) {
      const live = this.offsetSeconds + (this.context.currentTime - this.startTime);
      if (live >= this.exportTotal) this.stopExportSampling();
      return;
    }
    if (elapsed >= this.duration) { this.pause(false); this.position = 0; this.onProgress(0, this.duration); }
  }

  // Renders what you currently hear — enabled parts only, at their mixer
  // volumes, in the selected voice/piano mode and tempo — by playing it into a
  // recorder worklet and writing the result as a WAV file.
  async exportAudio({ onProgress } = {}) {
    if (!this.score) throw new Error('先打开一份乐谱再导出。');
    if (this.exporting) throw new Error('已经在导出了。');
    await this.initialize();
    if (!this.recorderReady) {
      await this.context.audioWorklet.addModule(RECORDER_URL);
      this.recorderReady = true;
    }
    await this.context.resume();
    const recorder = new AudioWorkletNode(this.context, 'choir-recorder');
    this.recorder = recorder;
    this.exportCancel = false;
    const result = new Promise((resolve, reject) => {
      recorder.port.onmessage = event => {
        const data = event.data || {};
        if (data.type !== 'done') return;
        if (this.exportCancel) { reject(new Error('导出已取消。')); return; }
        resolve({ blob: encodeWav(data.left, data.right, data.sampleRate), seconds: data.left.length / data.sampleRate, sampleRate: data.sampleRate });
      };
    });
    // Tap the mix before the monitor gain so the file is independent of the
    // speaker level, then mute the monitor for the duration of the render.
    this.analyser.disconnect();
    this.analyser.connect(recorder);
    recorder.connect(this.masterGain);
    this.monitorMuted = true;
    this.exportTotal = this.duration + EXPORT_TAIL_SECONDS;
    this.exporting = true;
    try {
      recorder.port.postMessage({ type: 'start' });
      this.exportTimer = setInterval(() => {
        const live = this.offsetSeconds + (this.context.currentTime - this.startTime);
        onProgress?.(clamp(live / this.exportTotal, 0, 1), clamp(live, 0, this.exportTotal), this.exportTotal);
      }, 250);
      await this.play(0);
      return await result;
    } finally {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
      this.exporting = false;
      this.monitorMuted = false;
      this.recorder = null;
      this.analyser.disconnect(recorder);
      this.analyser.connect(this.masterGain);
      this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
      this.masterGain.gain.setValueAtTime(0, this.context.currentTime);
      this.onProgress(this.currentSeconds(), this.duration);
    }
  }

  cancelExport() {
    if (!this.exporting) return;
    this.exportCancel = true;
    this.stopExportSampling();
  }

  stopExportSampling() {
    this.playVersion++;
    this.starting = false;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.synth?.stopAll(true);
    this.recorder?.port.postMessage({ type: 'stop' });
  }

  buildEvents() {
    const result = [];
    const add = (beat, send) => result.push({ seconds: beatToSeconds(this.score, beat, this.tempoScale), send });
    for (const track of this.score.tracks.filter(t => t.enabled)) {
      const ch = track.channel;
      const notes = track.notes;
      if (this.expressivePlayback) {
        // Shape the volume through long notes as well as between notes.
        for (let beat = 0; beat <= this.score.totalBeats; beat += 0.25) {
          const expr = expressionAt(track, beat);
          add(beat, (s, time) => s.controllerChange(ch, 11, expr, { time }));
        }
      }
      const performedNotes = this.performanceNotes(track);
      for (let i = 0; i < performedNotes.length; i++) {
        const performed = performedNotes[i];
        const next = this.mode === 'voice' && track.role !== 'P'
          ? performedNotes.slice(i + 1).find(candidate => candidate.source.voice === performed.source.voice && candidate.beat > performed.beat + 0.001)
          : null;
        const legato = next && next.midi !== performed.midi && Math.abs(next.beat - performed.end) < 0.005 ? 0.06 : 0;
        result.push({ seconds: beatToSeconds(this.score, performed.beat, this.tempoScale), endSeconds: beatToSeconds(this.score, performed.end, this.tempoScale), startsNote: true, send: (s, time) => s.noteOn(ch, performed.midi, performed.velocity, { time }) });
        result.push({ seconds: beatToSeconds(this.score, performed.end, this.tempoScale) + legato, send: (s, time) => s.noteOff(ch, performed.midi, { time }) });
      }
      for (const performed of this.expressivePlayback ? performedNotes : []) {
        const note = performed.source;
        const end = performed.end;
        if (note.glissStart) {
          const target = notes.slice(notes.indexOf(note) + 1).find(n => n.glissStop);
          if (target && target.beat <= end + 0.03) {
            const delta = clamp(target.midi - note.midi, -12, 12);
            const slideStart = note.beat + (end - note.beat) * 0.45;
            for (let k = 1; k <= 18; k++) {
              const bend = clamp(Math.round(8192 + delta / 12 * 8192 * k / 18), 0, 16383);
              const b = slideStart + (end - slideStart) * k / 18;
              add(b, (s, time) => s.pitchWheel(ch, bend, { time }));
            }
            add(end + 0.001, (s, time) => s.pitchWheel(ch, 8192, { time }));
          }
        }
      }
    }
    return result.sort((a, b) => a.seconds - b.seconds);
  }

  sustainedNotes(track) {
    const result = [];
    const pending = new Map();
    for (const note of track.notes) {
      const measureEnd = this.score.measureStarts[note.measure + 1] ?? this.score.totalBeats;
      const end = Math.min(note.beat + note.duration, measureEnd);
      if (end <= note.beat + 0.001) continue;
      // Voice numbers matter inside a staff: chord tones can be interleaved
      // with other pitches, and two voices may sing the same pitch.
      const key = JSON.stringify([note.partId, note.staff, note.voice, note.midi]);
      const previous = pending.get(key);
      let sustained;
      if (note.tieStop && previous && Math.abs(previous.end - note.beat) < 0.002) {
        sustained = previous;
        sustained.end = end;
        sustained.segments.push(note);
      } else {
        // An unmatched stop is still audible, including when OMR lost its start.
        sustained = { beat: note.beat, end, midi: note.midi, source: note, segments: [note] };
        result.push(sustained);
      }
      if (note.tieStart) pending.set(key, sustained);
      else pending.delete(key);
    }
    return result;
  }

  performanceNotes(track) {
    if (!this.expressivePlayback) {
      return this.sustainedNotes(track).map(note => ({ ...note, velocity: 82, ornament: note.source.breath ? 'breath' : '' }));
    }
    const performed = [];
    this.sustainedNotes(track).forEach(sustained => {
      const note = sustained.source;
      const end = note.staccato ? note.beat + (sustained.end - note.beat) * 0.55 : sustained.end;
      const velocity = note.accent ? 104 : 82;
      if (note.breath) {
        performed.push({ beat: note.beat, end, midi: note.midi, velocity, source: note, ornament: 'breath' });
        return;
      }
      if (note.trill && end - note.beat >= 0.25) {
        const segment = Math.min(0.25, (end - note.beat) / 4);
        let n = 0;
        for (let beat = note.beat; beat < end - 0.02; beat += segment, n++) {
          performed.push({ beat, end: Math.min(end, beat + segment * 0.94), midi: note.midi + (n % 2 ? 2 : 0), velocity, source: note, ornament: 'trill' });
        }
      } else performed.push({ beat: note.beat, end, midi: note.midi, velocity, source: note, ornament: note.glissStart ? 'gliss' : note.staccato ? 'staccato' : '' });
    });
    return performed;
  }
}
