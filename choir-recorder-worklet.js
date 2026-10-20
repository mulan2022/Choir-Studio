// Captures the mixed output of the synthesizer so the page can write a WAV file.
// It sits between the analyser and the monitor gain, so recording ignores the
// speaker volume and keeps going while the monitor is muted.
const BLOCK_FRAMES = 16384;

class ChoirRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.blocks = [];
    this.block = null;
    this.fill = 0;
    this.frames = 0;
    this.port.onmessage = event => {
      const data = event.data || {};
      if (data.type === 'start') this.start();
      else if (data.type === 'stop') this.stop();
    };
  }

  start() {
    this.blocks = [];
    this.frames = 0;
    this.allocate();
    this.recording = true;
  }

  allocate() {
    this.block = { left: new Float32Array(BLOCK_FRAMES), right: new Float32Array(BLOCK_FRAMES) };
    this.fill = 0;
  }

  push(quantum, frames) {
    let offset = 0;
    while (offset < frames) {
      if (this.fill === BLOCK_FRAMES) {
        this.blocks.push(this.block);
        this.allocate();
      }
      const take = Math.min(BLOCK_FRAMES - this.fill, frames - offset);
      if (quantum) {
        this.block.left.set(quantum[0].subarray(offset, offset + take), this.fill);
        this.block.right.set((quantum[1] || quantum[0]).subarray(offset, offset + take), this.fill);
      }
      this.fill += take;
      this.frames += take;
      offset += take;
    }
  }

  stop() {
    this.recording = false;
    if (this.fill) { this.blocks.push(this.block); this.block = null; this.fill = 0; }
    const left = new Float32Array(this.frames);
    const right = new Float32Array(this.frames);
    let offset = 0;
    for (const block of this.blocks) {
      const take = Math.min(BLOCK_FRAMES, this.frames - offset);
      if (take <= 0) break;
      left.set(block.left.subarray(0, take), offset);
      right.set(block.right.subarray(0, take), offset);
      offset += take;
    }
    this.blocks = [];
    this.port.postMessage({ type: 'done', left, right, sampleRate }, [left.buffer, right.buffer]);
  }

  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input || !input.length) { this.push(null, 128); return true; }
    const frames = input[0].length || 128;
    this.push(input, frames);
    return true;
  }
}

registerProcessor('choir-recorder', ChoirRecorderProcessor);
