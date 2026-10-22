import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

function applyEvent(synth, event) {
  const [channel, a, b] = event.args;
  if (event.type === 'pitchWheelRange') {
    synth.controllerChange(channel, 101, 0);
    synth.controllerChange(channel, 100, 0);
    synth.controllerChange(channel, 6, a);
    synth.controllerChange(channel, 101, 127);
    synth.controllerChange(channel, 100, 127);
    synth.controllerChange(channel, 6, 0);
  } else {
    synth[event.type](channel, a, b);
  }
}

self.onmessage = async ({ data }) => {
  try {
    const { bank, events, sampleRate, seconds } = data;
    const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
    await synth.processorInitialized;
    const soundBank = SoundBankLoader.fromArrayBuffer(bank);
    synth.soundBankManager.addSoundBank(soundBank, 'choir');
    synth.setSystemParameter('autoAllocateVoices', true);

    const frames = Math.ceil(seconds * sampleRate);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const dryLeft = new Float32Array(128);
    const dryRight = new Float32Array(128);
    const wetLeft = new Float32Array(128);
    const wetRight = new Float32Array(128);
    const dry = [[dryLeft, dryRight]];
    const scheduled = events.map(event => ({ ...event, frame: Math.max(0, Math.round(event.seconds * sampleRate)) }));
    let frame = 0;
    let index = 0;
    let lastReport = 0;
    while (frame < frames) {
      while (index < scheduled.length && scheduled[index].frame <= frame) applyEvent(synth, scheduled[index++]);
      const nextFrame = index < scheduled.length ? scheduled[index].frame : frames;
      const count = Math.min(128, frames - frame, Math.max(1, nextFrame - frame));
      dryLeft.fill(0); dryRight.fill(0); wetLeft.fill(0); wetRight.fill(0);
      synth.processSplit(dry, wetLeft, wetRight, 0, count);
      for (let i = 0; i < count; i++) {
        left[frame + i] = dryLeft[i] + wetLeft[i];
        right[frame + i] = dryRight[i] + wetRight[i];
      }
      frame += count;
      if (frame - lastReport >= sampleRate / 4 || frame === frames) {
        lastReport = frame;
        self.postMessage({ type: 'progress', fraction: frame / frames, seconds: frame / sampleRate });
        // Let the browser deliver a cancellation message between render batches.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    self.postMessage({ type: 'done', left, right, sampleRate, seconds: frames / sampleRate }, [left.buffer, right.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
};
