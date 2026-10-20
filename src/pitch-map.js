// 音高换算：把五线谱上的“第几个音级”与 midi／升降号互相折算。
// 只做纯计算，不碰 DOM，方便在 Node 里单独测。

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// 调号里升号／降号出现的顺序
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export const MIN_MIDI = 21;
export const MAX_MIDI = 108;

/** 音名 + 八度 → 全音阶序号（C4 = 28）。相邻两个音级差 1，正好是半个线距。 */
export function diatonicOf(step, octave) {
  return (Number(octave) || 0) * 7 + (STEP_INDEX[step] ?? 0);
}

/** 全音阶序号 → 音名 + 八度。 */
export function stepOfDiatonic(diatonic) {
  const octave = Math.floor(diatonic / 7);
  return { step: STEP_NAMES[((diatonic % 7) + 7) % 7], octave };
}

/** 某个音级在给定调号里默认带什么升降号（fifths 为 MusicXML 的 key/fifths）。 */
export function keyAlter(step, fifths) {
  const count = Math.min(7, Math.abs(Number(fifths) || 0));
  if (!count) return 0;
  const order = fifths < 0 ? FLAT_ORDER : SHARP_ORDER;
  return order.slice(0, count).includes(step) ? (fifths < 0 ? -1 : 1) : 0;
}

export function midiOf(step, alter, octave) {
  return (Number(octave) + 1) * 12 + SEMITONES[STEP_INDEX[step] ?? 0] + (Number(alter) || 0);
}

/** C4 / F♯5 / B♭3 这样的显示名。 */
export function pitchName(step, alter, octave) {
  const accidentals = alter > 0 ? '♯'.repeat(Math.min(2, alter)) : alter < 0 ? '♭'.repeat(Math.min(2, -alter)) : '';
  return `${step}${accidentals}${octave}`;
}

export function isPlayableMidi(midi) {
  return Number.isInteger(midi) && midi >= MIN_MIDI && midi <= MAX_MIDI;
}
