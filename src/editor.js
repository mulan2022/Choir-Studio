import { keyAlter } from './pitch-map.js';

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const RHYTHMS = [
  [8, 'breve', 0], [6, 'whole', 1], [4, 'whole', 0], [3, 'half', 1],
  [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
  [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1],
  [0.25, '16th', 0], [0.1875, '32nd', 1], [0.125, '32nd', 0],
];
const REST_RHYTHMS = [...RHYTHMS, [0.0625, '64th', 0]];
export const RHYTHM_OPTIONS = RHYTHMS.map(([beats, type, dots]) => ({ beats, type, dots, label: `${type === 'breve' ? '倍全音符' : type === 'whole' ? '全音符' : type === 'half' ? '二分音符' : type === 'quarter' ? '四分音符' : type === 'eighth' ? '八分音符' : type === '16th' ? '十六分音符' : '三十二分音符'}${dots ? '·附点' : ''}` }));

const direct = (parent, name) => Array.from(parent?.children || []).find(node => node.localName === name);
const children = (parent, name) => Array.from(parent?.children || []).filter(node => node.localName === name);
const get = (parent, name, fallback = '') => direct(parent, name)?.textContent?.trim() || fallback;
const int = (parent, name, fallback = 0) => Number(get(parent, name, fallback));
const close = (a, b) => Math.abs(a - b) < 0.002;
const element = (parent, name) => parent.ownerDocument.createElementNS(parent.namespaceURI, name);
class RhythmFitError extends Error {}

function upsert(parent, name, text, before = null) {
  let node = direct(parent, name);
  if (!node) {
    node = element(parent, name);
    parent.insertBefore(node, before);
  }
  node.textContent = String(text);
  return node;
}

function timeOf(measures, index) {
  for (let i = index; i >= 0; i--) {
    const time = direct(direct(measures[i], 'attributes'), 'time');
    if (time) return { beats: Number(get(time, 'beats', '4')), beatType: Number(get(time, 'beat-type', '4')) };
  }
  return { beats: 4, beatType: 4 };
}

function durationNotation(beats) {
  return RHYTHMS.find(([value]) => close(value, beats));
}

function restNotation(beats) {
  return REST_RHYTHMS.find(([value]) => close(value, beats));
}

function appendText(parent, name, value) {
  const node = element(parent, name);
  node.textContent = String(value);
  parent.append(node);
  return node;
}

function makeRest(parent, units, divisions, voice, staff, wholeMeasure = false) {
  const note = element(parent, 'note');
  const rest = element(note, 'rest');
  if (wholeMeasure) rest.setAttribute('measure', 'yes');
  note.append(rest);
  appendText(note, 'duration', units);
  appendText(note, 'voice', voice);
  if (!wholeMeasure) {
    const notation = restNotation(units / divisions);
    if (!notation) throw new Error('剩余拍数无法写成常规休止符。');
    appendText(note, 'type', notation[1]);
    if (notation[2]) note.append(element(note, 'dot'));
  }
  appendText(note, 'staff', staff);
  return note;
}

function splitRests(parent, units, divisions, voice, staff) {
  const rests = [];
  let remaining = units;
  while (remaining > 0) {
    const notation = REST_RHYTHMS.find(([beats]) => {
      const value = Math.round(beats * divisions);
      return value > 0 && close(value / divisions, beats) && value <= remaining;
    });
    if (!notation) throw new Error('剩余拍数无法用当前乐谱的时值精度表示。');
    const value = Math.round(notation[0] * divisions);
    rests.push(makeRest(parent, value, divisions, voice, staff));
    remaining -= value;
  }
  return rests;
}

function simpleRest(node) {
  return children(node, 'rest').length === 1 && Array.from(node.children).every(child =>
    ['rest', 'duration', 'voice', 'type', 'dot', 'staff'].includes(child.localName));
}

function setDuration(record, units, divisions) {
  const beats = units / divisions;
  const notation = durationNotation(beats);
  if (!notation && !record.isMeasureRest) throw new Error(`无法把 ${beats} 拍写成常规音符。`);
  for (const node of record.members) {
    upsert(node, 'duration', units, direct(node, 'voice'));
    if (record.isMeasureRest) continue;
    upsert(node, 'type', notation[1], direct(node, 'stem') || direct(node, 'notehead') || direct(node, 'notations'));
    for (const dot of children(node, 'dot')) dot.remove();
    if (notation[2]) node.insertBefore(element(node, 'dot'), direct(node, 'stem') || direct(node, 'notehead') || direct(node, 'notations'));
    for (const beam of children(node, 'beam')) beam.remove();
    if (direct(node, 'rest')) direct(node, 'rest').removeAttribute('measure');
  }
}

function backupTargets(measure) {
  const targets = new Map();
  let cursor = 0;
  for (const node of Array.from(measure.children)) {
    if (node.localName === 'note' && !direct(node, 'chord')) cursor += int(node, 'duration');
    else if (node.localName === 'forward') cursor += int(node, 'duration');
    else if (node.localName === 'backup') {
      cursor -= int(node, 'duration');
      targets.set(node, cursor);
    }
  }
  return targets;
}

function repairBackups(measure, targets) {
  let cursor = 0;
  for (const node of Array.from(measure.children)) {
    if (node.localName === 'note' && !direct(node, 'chord')) cursor += int(node, 'duration');
    else if (node.localName === 'forward') cursor += int(node, 'duration');
    else if (node.localName === 'backup') {
      const target = targets.get(node);
      const duration = cursor - target;
      if (!(duration > 0)) throw new Error('此小节的复调回退时值无法保持，修改已撤销。');
      upsert(node, 'duration', duration);
      cursor = target;
    }
  }
}

function chooseDurations(records, targetUnits, divisions, fixedId = null, fixedUnits = null) {
  const candidates = RHYTHMS.map(([beats]) => Math.round(beats * divisions)).filter(units => units > 0 && units <= targetUnits);
  let states = new Map([[0, { cost: 0, values: [] }]]);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.id === fixedId && record.members.some(node => direct(node, 'time-modification'))) throw new Error('请先移除这个音符的连音组，再单独修改时值。');
    const choices = record.id === fixedId ? [fixedUnits] : record.members.some(node => direct(node, 'time-modification')) ? [record.durationUnits] : record.isMeasureRest ? [targetUnits] : record.rest && simpleRest(record.node) ? [0, ...candidates] : candidates;
    const next = new Map();
    for (const [sum, state] of states) for (const units of choices) {
      if (sum + units > targetUnits) continue;
      const changed = units !== record.durationUnits;
      const distance = Math.abs(units - record.durationUnits) / divisions;
      const cost = state.cost + (changed ? record.rest && simpleRest(record.node) ? 0.03 + distance * 0.02 : 0.3 + distance * distance + index * 0.0001 : 0);
      const previous = next.get(sum + units);
      if (!previous || cost < previous.cost) next.set(sum + units, { cost, values: [...state.values, units] });
    }
    states = next;
  }
  const solution = states.get(targetUnits);
  if (!solution) throw new RhythmFitError('现有音符无法自动平衡到目标拍数。');
  return solution.values;
}

function writtenBeats(node) {
  const type = get(node, 'type');
  const dots = children(node, 'dot').length;
  const base = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125 }[type];
  return base ? base * (2 - 2 ** -dots) : null;
}

function tripletGroupAt(voice, at) {
  if (at < 0 || !isTriplet(voice[at])) throw new Error('所选音符没有三连音标记。');
  let start = at, end = at + 1;
  while (start > 0 && isTriplet(voice[start - 1]) && !tupletMark(voice[start], 'start')) start--;
  while (end < voice.length && isTriplet(voice[end]) && !tupletMark(voice[end], 'start')) end++;
  // Trust explicit starts, but tolerate duplicate stops/orphan tail notes in
  // OMR. Without boundaries, only partition regular runs divisible by three.
  if (!tupletMark(voice[start], 'start') && (end - start) > 3 && (end - start) % 3 === 0 && voice.slice(start, end).every(record => writtenBeats(record.node) === writtenBeats(voice[start].node))) {
    start += Math.floor((at - start) / 3) * 3;
    end = start + 3;
  }
  return voice.slice(start, end);
}

function restPlan(parent, units, divisions, voice, staff) {
  try { return splitRests(parent, units, divisions, voice, staff); } catch { return null; }
}

function isTriplet(record) {
  const modification = direct(record.node, 'time-modification');
  return int(modification, 'actual-notes') === 3 && int(modification, 'normal-notes') === 2;
}

function tupletMark(record, type) {
  return children(direct(record.node, 'notations'), 'tuplet').some(node => node.getAttribute('type') === type);
}

function setTriplet(record, add, edge) {
  const node = record.node;
  direct(node, 'time-modification')?.remove();
  let notations = direct(node, 'notations');
  if (notations) for (const mark of children(notations, 'tuplet')) mark.remove();
  if (!add) { if (notations && !notations.children.length) notations.remove(); return; }
  const modification = element(node, 'time-modification');
  appendText(modification, 'actual-notes', 3);
  appendText(modification, 'normal-notes', 2);
  node.insertBefore(modification, direct(node, 'stem') || direct(node, 'notehead') || direct(node, 'notations'));
  if (!edge) return;
  if (!notations) { notations = element(node, 'notations'); node.append(notations); }
  const mark = element(notations, 'tuplet');
  mark.setAttribute('type', edge);
  mark.setAttribute('number', '1');
  notations.append(mark);
}

export class ScoreEditor {
  constructor(xml) {
    this.undoStack = [];
    this.redoStack = [];
    this.setXML(xml);
  }

  setXML(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('MusicXML 无法解析。');
    this.doc = doc;
    this.xml = xml;
    this.reindex();
  }

  reindex() {
    this.parts = children(this.doc.documentElement, 'part');
    this.partIds = this.parts.map(part => part.getAttribute('id'));
    this.records = [];
    this.byId = new Map();
    this.byPosition = new Map();
    const firstMeasures = children(this.parts[0], 'measure');
    this.measureStarts = [];
    let total = 0;
    for (let i = 0; i < firstMeasures.length; i++) {
      this.measureStarts.push(total);
      const time = timeOf(firstMeasures, i);
      total += time.beats * 4 / time.beatType;
    }
    this.parts.forEach((part, partIndex) => {
      let divisions = 1;
      children(part, 'measure').forEach((measure, measureIndex) => {
        let cursor = 0, lastStart = 0, ordinal = 0;
        for (const node of Array.from(measure.children)) {
          if (node.localName === 'attributes') divisions = int(node, 'divisions', divisions) || divisions;
          else if (node.localName === 'backup') cursor -= int(node, 'duration');
          else if (node.localName === 'forward') cursor += int(node, 'duration');
          else if (node.localName === 'note') {
            const chord = !!direct(node, 'chord');
            const startUnits = chord ? lastStart : cursor;
            if (!chord) lastStart = startUnits;
            const pitch = direct(node, 'pitch');
            const unpitched = direct(node, 'unpitched');
            const step = get(pitch || unpitched, pitch ? 'step' : 'display-step', 'C');
            const octave = int(pitch || unpitched, pitch ? 'octave' : 'display-octave', 4);
            const midi = (octave + 1) * 12 + (STEPS[step] || 0) + int(pitch, 'alter');
            const record = { id: `${partIndex}:${measureIndex}:${ordinal++}`, partIndex, measureIndex, node, measure, divisions, startUnits, startBeats: startUnits / divisions, beat: (this.measureStarts[measureIndex] || 0) + startUnits / divisions, durationUnits: int(node, 'duration'), voice: get(node, 'voice', '1'), staff: get(node, 'staff', '1'), midi, step, octave, alter: int(pitch, 'alter'), pitched: !!(pitch || unpitched) && !direct(node, 'rest'), chord, rest: !!direct(node, 'rest') };
            this.records.push(record);
            this.byId.set(record.id, record);
            const position = `${partIndex}:${measureIndex}:${Math.round(record.startBeats * 1000)}`;
            if (!this.byPosition.has(position)) this.byPosition.set(position, []);
            this.byPosition.get(position).push(record);
            if (!chord) cursor += record.durationUnits;
          }
        }
      });
    });
  }

  serialize() { return new XMLSerializer().serializeToString(this.doc); }
  get(id) { return this.byId.get(id); }
  meterAt(index) { return timeOf(children(this.parts[0], 'measure'), index); }

  divisionsAt(partIndex, measureIndex) {
    let divisions = 1;
    const measures = children(this.parts[partIndex], 'measure');
    for (let i = 0; i <= measureIndex; i++) divisions = int(direct(measures[i], 'attributes'), 'divisions', divisions) || divisions;
    return divisions;
  }

  restSlots(measureIndex) {
    const slots = [];
    const meter = this.meterAt(measureIndex);
    const barLength = meter.beats * 4 / meter.beatType;
    this.parts.forEach((_, partIndex) => {
      for (const records of this.voiceGroups(partIndex, measureIndex).values()) {
        if (!records.some(record => record.rest && record.durationUnits > 0 && record.startBeats >= 0 && record.startBeats + record.durationUnits / record.divisions <= barLength + 0.001 && simpleRest(record.node))) continue;
        slots.push({ partIndex, voice: records[0].voice, staff: records[0].staff });
      }
    });
    return slots;
  }

  restPositions(measureIndex, { partIndex, voice, staff }, beats) {
    if (!durationNotation(beats)) return [];
    const meter = this.meterAt(measureIndex);
    const barLength = meter.beats * 4 / meter.beatType;
    const positions = new Set();
    for (const record of this.records) {
      if (record.measureIndex !== measureIndex || record.partIndex !== partIndex || record.voice !== voice || record.staff !== staff || !record.rest || !simpleRest(record.node)) continue;
      const end = record.startBeats + record.durationUnits / record.divisions;
      if (record.startBeats < 0 || end > barLength + 0.001) continue;
      for (let tick = Math.ceil(record.startBeats * 16 - 0.001); tick / 16 + beats <= end + 0.001; tick++) positions.add(tick / 16);
    }
    return [...positions].sort((a, b) => a - b);
  }

  insertMeasure(index) {
    const count = children(this.parts[0], 'measure').length;
    if (!Number.isInteger(index) || index < 0 || index > count) throw new Error('请选择插入小节的位置。');
    return this.transaction(() => {
      if (this.parts.some(part => children(part, 'measure').length !== count)) throw new Error('各声部的小节数不一致，暂不能插入小节。');
      const meter = this.meterAt(index === 0 ? 0 : index - 1);
      const barLength = meter.beats * 4 / meter.beatType;
      for (let partIndex = 0; partIndex < this.parts.length; partIndex++) {
        this.ensureDivisions(partIndex);
        const part = this.parts[partIndex];
        const measures = children(part, 'measure');
        const sourceIndex = index === 0 ? 0 : index - 1;
        const divisions = this.divisionsAt(partIndex, sourceIndex);
        const units = Math.round(barLength * divisions);
        if (!close(units / divisions, barLength)) throw new Error('当前拍号无法用这份乐谱的时值精度表示。');
        const measure = element(part, 'measure');
        const originalAttributes = index === 0 ? direct(measures[0], 'attributes') : null;
        const attributes = originalAttributes ? originalAttributes.cloneNode(true) : element(measure, 'attributes');
        measure.append(attributes);
        upsert(attributes, 'divisions', divisions, attributes.firstChild);
        setTime(measure, meter.beats, meter.beatType);
        if (index === 0) {
          const tempo = Array.from(measures[0].children).find(node => node.localName === 'direction' && (direct(node, 'sound')?.hasAttribute('tempo') || direct(direct(node, 'direction-type'), 'metronome')));
          if (tempo) measure.append(tempo.cloneNode(true));
        }
        let slots = [...this.voiceGroups(partIndex, sourceIndex).values()].map(records => ({ voice: records[0].voice, staff: records[0].staff }));
        if (!slots.length) {
          const nearest = this.records.filter(record => record.partIndex === partIndex).sort((a, b) => Math.abs(a.measureIndex - sourceIndex) - Math.abs(b.measureIndex - sourceIndex))[0];
          if (nearest) slots = [...this.voiceGroups(partIndex, nearest.measureIndex).values()].map(records => ({ voice: records[0].voice, staff: records[0].staff }));
        }
        if (!slots.length) {
          const staves = int(attributes, 'staves', 1);
          slots = Array.from({ length: staves }, (_, staff) => ({ voice: String(staff + 1), staff: String(staff + 1) }));
        }
        slots.forEach(({ voice, staff }, slotIndex) => {
          if (slotIndex) {
            const backup = element(measure, 'backup');
            appendText(backup, 'duration', units);
            measure.append(backup);
          }
          measure.append(makeRest(measure, units, divisions, voice, staff, true));
        });
        part.insertBefore(measure, measures[index] || null);
        children(part, 'measure').forEach((item, measureIndex) => {
          if (item.getAttribute('number') === '0' && !item.hasAttribute('implicit')) item.setAttribute('implicit', 'yes');
          item.setAttribute('number', String(measureIndex + 1));
        });
      }
    });
  }

  insertNote(measureIndex, { partIndex, voice, staff }, startBeats, midi, beats) {
    let inserted;
    const xml = this.transaction(() => {
      if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= children(this.parts[0], 'measure').length) throw new Error('请先选择一个小节。');
      if (!Number.isInteger(partIndex) || !this.parts[partIndex] || !Number.isInteger(midi) || midi < 21 || midi > 108 || !durationNotation(beats)) throw new Error('请选择有效的声部、音高和时值。');
      this.ensureDivisions(partIndex);
      const meter = this.meterAt(measureIndex);
      const barLength = meter.beats * 4 / meter.beatType;
      const divisions = this.divisionsAt(partIndex, measureIndex);
      const startUnits = Math.round(startBeats * divisions);
      const noteUnits = Math.round(beats * divisions);
      if (!close(startUnits / divisions, startBeats) || !close(noteUnits / divisions, beats) || startBeats < 0 || startBeats + beats > barLength + 0.001) throw new Error('音符超出小节拍数，或当前时值精度不足。');
      const rest = this.records.find(record => record.partIndex === partIndex && record.measureIndex === measureIndex && record.voice === voice && record.staff === staff && record.rest && simpleRest(record.node) && record.startUnits >= 0 && record.startBeats + record.durationUnits / record.divisions <= barLength + 0.001 && record.startUnits <= startUnits && startUnits + noteUnits <= record.startUnits + record.durationUnits);
      if (!rest) throw new Error('所选位置没有足够的空拍；请选择休止符范围内的位置或缩短时值。');
      const measure = rest.measure;
      const left = startUnits - rest.startUnits;
      const right = rest.startUnits + rest.durationUnits - startUnits - noteUnits;
      const useFlats = this.keyFifths(partIndex, measureIndex) < 0;
      const [step, alter] = (useFlats ? FLAT : SHARP)[midi % 12];
      inserted = element(measure, 'note');
      const pitch = element(inserted, 'pitch');
      appendText(pitch, 'step', step);
      if (alter) appendText(pitch, 'alter', alter);
      appendText(pitch, 'octave', Math.floor(midi / 12) - 1);
      inserted.append(pitch);
      appendText(inserted, 'duration', noteUnits);
      appendText(inserted, 'voice', voice);
      const notation = durationNotation(beats);
      appendText(inserted, 'type', notation[1]);
      if (notation[2]) inserted.append(element(inserted, 'dot'));
      if (alter !== keyAlter(step, this.keyFifths(partIndex, measureIndex))) appendText(inserted, 'accidental', alter === 0 ? 'natural' : alter > 0 ? 'sharp' : 'flat');
      appendText(inserted, 'staff', staff);
      const replacement = [
        ...splitRests(measure, left, divisions, voice, staff),
        inserted,
        ...splitRests(measure, right, divisions, voice, staff),
      ];
      for (const note of replacement) measure.insertBefore(note, rest.node);
      rest.node.remove();
    });
    this.lastInsertedNoteId = this.records.find(record => record.node === inserted)?.id || null;
    return xml;
  }

  findFromSource(source) {
    if (!source) return null;
    const partIndex = Number(source.ParentStaff?.ParentInstrument?.Id);
    const measureIndex = Number(source.SourceMeasure?.MeasureNumber) - 1;
    const local = Number(source.ParentVoiceEntry?.Timestamp?.RealValue) * 4;
    const midi = Number(source.halfTone);
    const voice = String(source.ParentVoiceEntry?.ParentVoice?.VoiceId || '1');
    const staff = String(source.ParentStaff?.Id || '1');
    const rest = !!source.isRest?.();
    let candidates = (this.byPosition.get(`${partIndex}:${measureIndex}:${Math.round(local * 1000)}`) || []).filter(record => (rest ? record.rest : record.pitched) && close(record.startBeats, local));
    if (!candidates.length) return null;
    const scoped = candidates.filter(record => record.voice === voice && record.staff === staff);
    const preferred = scoped.length ? scoped : candidates.filter(record => record.staff === staff);
    const pool = preferred.length ? preferred : candidates;
    return pool.find(record => record.midi === midi)
      || pool.find(record => record.midi === midi + 12)
      || pool.find(record => record.midi === midi - 12)
      || pool[0];
  }

  transaction(change) {
    const before = this.serialize();
    this.lastEditWarnings = [];
    try {
      change();
      this.reindex();
      this.xml = this.serialize();
      this.undoStack.push(before);
      if (this.undoStack.length > 30) this.undoStack.shift();
      this.redoStack = [];
      return this.xml;
    } catch (error) {
      this.setXML(before);
      this.lastEditWarnings = [];
      throw error;
    }
  }

  undo() {
    this.lastEditWarnings = [];
    if (!this.undoStack.length) return null;
    this.redoStack.push(this.serialize());
    this.setXML(this.undoStack.pop());
    return this.xml;
  }

  redo() {
    this.lastEditWarnings = [];
    if (!this.redoStack.length) return null;
    this.undoStack.push(this.serialize());
    this.setXML(this.redoStack.pop());
    return this.xml;
  }

  changePitch(id, midi) {
    return this.transaction(() => {
      const record = this.get(id);
      if (!record?.pitched || !Number.isInteger(midi) || midi < 21 || midi > 108) throw new Error('请先选择一个可编辑的音符。');
      const useFlats = this.keyFifths(record.partIndex, record.measureIndex) < 0;
      const [step, alter] = (useFlats ? FLAT : SHARP)[midi % 12];
      const octave = Math.floor(midi / 12) - 1;
      let pitch = direct(record.node, 'pitch');
      if (!pitch) {
        pitch = element(record.node, 'pitch');
        record.node.replaceChild(pitch, direct(record.node, 'unpitched'));
      }
      upsert(pitch, 'step', step, pitch.firstChild);
      const existingAlter = direct(pitch, 'alter');
      if (alter) upsert(pitch, 'alter', alter, direct(pitch, 'octave'));
      else existingAlter?.remove();
      upsert(pitch, 'octave', octave);
      direct(record.node, 'accidental')?.remove();
    });
  }

  keyFifths(partIndex, measureIndex) {
    const measures = children(this.parts[partIndex], 'measure');
    for (let i = measureIndex; i >= 0; i--) {
      const key = direct(direct(measures[i], 'attributes'), 'key');
      if (key) return int(key, 'fifths');
    }
    return 0;
  }

  ensureDivisions(partIndex) {
    const part = this.parts[partIndex];
    const measures = children(part, 'measure');
    let divisions = 1;
    let factor = 1;
    for (const measure of measures) {
      const found = direct(direct(measure, 'attributes'), 'divisions');
      if (found) {
        divisions = Number(found.textContent) || divisions;
        const needed = 48 / gcd(divisions, 48);
        factor = factor / gcd(factor, needed) * needed;
      }
    }
    factor = Math.round(factor);
    if (factor === 1) return;
    let hasDivisions = false;
    for (const measure of measures) {
      for (const node of Array.from(measure.getElementsByTagName('duration'))) node.textContent = String(Number(node.textContent) * factor);
      const division = direct(direct(measure, 'attributes'), 'divisions');
      if (division) { division.textContent = String(Number(division.textContent) * factor); hasDivisions = true; }
    }
    if (!hasDivisions) {
      const first = measures[0];
      let attributes = direct(first, 'attributes');
      if (!attributes) { attributes = element(first, 'attributes'); first.insertBefore(attributes, first.firstChild); }
      upsert(attributes, 'divisions', factor, attributes.firstChild);
    }
    this.reindex();
  }

  voiceGroups(partIndex, measureIndex) {
    const records = this.records.filter(record => record.partIndex === partIndex && record.measureIndex === measureIndex);
    const groups = new Map();
    let last = null;
    for (const record of records) {
      const key = `${record.voice}:${record.staff}`;
      if (!groups.has(key)) groups.set(key, []);
      if (record.chord && last && last.key === key && close(last.startUnits, record.startUnits)) last.members.push(record.node);
      else {
        const entry = { ...record, key, members: [record.node], isMeasureRest: record.rest && direct(record.node, 'rest')?.getAttribute('measure') === 'yes' };
        groups.get(key).push(entry);
        last = entry;
      }
    }
    return groups;
  }

  normalizeVoice(records, targetBeats, divisions, fixedId = null, fixedBeats = null) {
    if (!records.length) return;
    if (records.some(record => record.durationUnits <= 0)) throw new RhythmFitError('此声部含装饰音，保留原时值。');
    for (let i = 1; i < records.length; i++) {
      if (!close(records[i].startUnits, records[i - 1].startUnits + records[i - 1].durationUnits)) throw new RhythmFitError('此声部含交叠音符或跳过的拍点，保留原时值。');
    }
    const remainingBeats = targetBeats - records[0].startBeats;
    const targetUnits = Math.round(remainingBeats * divisions);
    if (targetUnits <= 0 || !close(targetUnits / divisions, remainingBeats)) throw new RhythmFitError('此声部的起拍超出了目标小节。');
    const fixedUnits = fixedId ? Math.round(fixedBeats * divisions) : null;
    const values = chooseDurations(records, targetUnits, divisions, fixedId, fixedUnits);
    records.forEach((record, index) => {
      if (values[index] === 0 && record.rest && simpleRest(record.node)) record.node.remove();
      else if (record.durationUnits !== values[index]) setDuration(record, values[index], divisions);
    });
    for (const record of records) for (const node of record.members) for (const beam of children(node, 'beam')) beam.remove();
  }

  rebalanceRests(records, targetBeats, divisions) {
    if (!records.length) return;
    const target = Math.round(targetBeats * divisions);
    const oldEnd = records.at(-1).startUnits + records.at(-1).durationUnits;
    let difference = target - oldEnd - records.reduce((sum, record) => sum + int(record.node, 'duration') - record.durationUnits, 0);
    const contiguous = records.every((record, i) => !i || close(record.startUnits, records[i - 1].startUnits + records[i - 1].durationUnits));
    if (contiguous && difference < 0) {
      for (const record of [...records].reverse()) {
        if (!record.rest || !simpleRest(record.node) || !difference) continue;
        const consumed = Math.min(-difference, int(record.node, 'duration'));
        const rests = restPlan(record.measure, int(record.node, 'duration') - consumed, divisions, record.voice, record.staff);
        if (!rests) continue;
        for (const rest of rests) record.node.before(rest);
        record.node.remove();
        difference += consumed;
      }
    } else if (contiguous && difference > 0) {
      const last = records.at(-1);
      const rests = restPlan(last.measure, difference, divisions, last.voice, last.staff);
      if (rests) {
        const next = last.members.at(-1).nextSibling;
        for (const rest of rests) last.measure.insertBefore(rest, next);
        difference = 0;
      }
    }
    if (difference) {
      const units = Math.abs(difference), divisor = gcd(units, divisions);
      const amount = units % divisions === 0 ? String(units / divisions) : `${units / divisor}/${divisions / divisor}`;
      this.lastEditWarnings.push(`第 ${records[0].measureIndex + 1} 小节仍${difference > 0 ? '少' : '多'} ${amount} 拍，修改已保留，可继续校正拍号或音符。`);
    }
  }

  changeRhythm(id, beats) {
    return this.transaction(() => {
      const original = this.get(id);
      if (!original?.pitched || !durationNotation(beats)) throw new Error('请选择音符和常规音符时值。');
      this.ensureDivisions(original.partIndex);
      const record = this.get(id);
      const measure = record.measure;
      const backups = backupTargets(measure);
      const voice = this.voiceGroups(record.partIndex, record.measureIndex).get(`${record.voice}:${record.staff}`);
      const meter = this.meterAt(record.measureIndex);
      const selectedGroup = voice.find(entry => entry.members.includes(record.node));
      if (!selectedGroup) throw new Error('无法找到这个音符所在的和弦或声部。');
      try { this.normalizeVoice(voice, meter.beats * 4 / meter.beatType, record.divisions, selectedGroup.id, beats); }
      catch (error) {
        if (!(error instanceof RhythmFitError)) throw error;
        setDuration(selectedGroup, Math.round(beats * record.divisions), record.divisions);
        this.rebalanceRests(voice, meter.beats * 4 / meter.beatType, record.divisions);
      }
      repairBackups(measure, backups);
    });
  }

  changeMeter(measureIndex, beats, beatType) {
    return this.changeMeterRange(measureIndex, measureIndex, beats, beatType);
  }

  changeMeterRange(startIndex, endIndex, beats, beatType) {
    const count = children(this.parts[0], 'measure').length;
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex || endIndex >= count) throw new Error('请选择有效的小节起止范围。');
    return this.changeMeters(Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i), beats, beatType);
  }

  changeMeters(indices, beats, beatType) {
    return this.transaction(() => {
      if (!Number.isInteger(beats) || beats < 1 || beats > 12 || ![2, 4, 8, 16].includes(beatType)) throw new Error('请选择有效拍号。');
      const count = children(this.parts[0], 'measure').length;
      const selected = new Set(indices);
      if (!selected.size || [...selected].some(index => !Number.isInteger(index) || index < 0 || index >= count)) throw new Error('请先选择要修改的小节。');
      if (this.parts.some(part => children(part, 'measure').length !== count)) throw new Error('各声部的小节数不一致，无法批量修改拍号。');
      for (let partIndex = 0; partIndex < this.parts.length; partIndex++) {
        this.ensureDivisions(partIndex);
        const measures = children(this.parts[partIndex], 'measure');
        const originalMeters = measures.map((_, index) => timeOf(measures, index));
        for (let measureIndex = 0; measureIndex < count; measureIndex++) {
          const measure = measures[measureIndex];
          if (!selected.has(measureIndex)) {
            if (selected.has(measureIndex - 1) && !direct(direct(measure, 'attributes'), 'time')) {
              setTime(measure, originalMeters[measureIndex].beats, originalMeters[measureIndex].beatType);
            }
            continue;
          }
          const backups = backupTargets(measure);
          const groups = this.voiceGroups(partIndex, measureIndex);
          for (const records of groups.values()) {
            try { this.normalizeVoice(records, beats * 4 / beatType, records[0].divisions); }
            catch (error) {
              if (!(error instanceof RhythmFitError)) throw error;
              this.rebalanceRests(records, beats * 4 / beatType, records[0].divisions);
            }
          }
          repairBackups(measure, backups);
          setTime(measure, beats, beatType);
        }
      }
    });
  }

  deleteNotes(ids) {
    return this.transaction(() => {
      const selected = new Set(ids);
      const records = [...selected].map(id => this.get(id));
      if (!records.length || records.some(record => !record?.pitched || record.durationUnits <= 0)) throw new Error('请选择要删除的普通音符。');
      const selectedNodes = new Set(records.map(record => record.node));
      // Remove the other end of each tie too, including ties across barlines.
      for (const record of records) for (const type of ['start', 'stop']) {
        if (!children(record.node, 'tie').some(tie => tie.getAttribute('type') === type)) continue;
        for (const other of this.records) {
          if (other.partIndex !== record.partIndex || other.staff !== record.staff || other.voice !== record.voice || other.midi !== record.midi) continue;
          const adjacent = type === 'start' ? close(record.beat + record.durationUnits / record.divisions, other.beat) : close(other.beat + other.durationUnits / other.divisions, record.beat);
          if (adjacent) setTie(other.node, type === 'start' ? 'stop' : 'start', false);
        }
      }
      const bars = new Set(records.map(record => `${record.partIndex}:${record.measureIndex}`));
      for (const bar of bars) {
        const [partIndex, measureIndex] = bar.split(':').map(Number);
        for (const groups of this.voiceGroups(partIndex, measureIndex).values()) {
          // A completely deleted triplet becomes ordinary rest time, so its
          // empty beats can be filled again with the normal insertion tools.
          for (let i = 0; i + 2 < groups.length; i++) {
            const triplet = groups.slice(i, i + 3);
            if (!triplet.every(group => isTriplet(group) && group.members.every(node => selectedNodes.has(node))) ||
                !triplet.every((group, j) => !j || close(group.startUnits, triplet[j - 1].startUnits + triplet[j - 1].durationUnits))) continue;
            const first = triplet[0];
            const units = triplet.reduce((sum, group) => sum + group.durationUnits, 0);
            if (!restNotation(units / first.divisions)) continue;
            for (const rest of splitRests(first.measure, units, first.divisions, first.voice, first.staff)) first.node.before(rest);
            for (const group of triplet) for (const node of group.members) node.remove();
            i += 2;
          }
          for (const group of groups) {
            if (!group.node.isConnected) continue;
            const deleted = group.members.filter(node => selectedNodes.has(node));
            if (!deleted.length) continue;
            const survivors = group.members.filter(node => !deleted.includes(node));
            if (survivors.length) {
              // Promoting a remaining chord member preserves the onset/cursor.
              direct(survivors[0], 'chord')?.remove();
              for (const node of deleted) node.remove();
            } else {
              const rest = group.node.cloneNode(true);
              for (const child of Array.from(rest.children)) {
                if (!['duration', 'voice', 'type', 'dot', 'time-modification', 'staff', 'notations'].includes(child.localName)) child.remove();
              }
              const notations = direct(rest, 'notations');
              if (notations) {
                for (const child of Array.from(notations.children)) if (child.localName !== 'tuplet') child.remove();
                if (!notations.children.length) notations.remove();
              }
              rest.insertBefore(element(rest, 'rest'), rest.firstChild);
              group.node.before(rest);
              for (const node of group.members) node.remove();
            }
          }
          for (const group of groups) for (const node of group.members) for (const beam of children(node, 'beam')) beam.remove();
        }
      }
    });
  }

  changeTriplet(ids, remove = false) {
    return this.transaction(() => {
      const selected = [...new Set(ids)].map(id => this.get(id));
      if (!selected.length || selected.some(record => !record || (!record.pitched && !record.rest))) throw new Error('请先选择三连音中的音符。');
      const anchor = selected[0];
      if (selected.some(record => record.partIndex !== anchor.partIndex || record.measureIndex !== anchor.measureIndex || record.voice !== anchor.voice || record.staff !== anchor.staff)) throw new Error('请选择同一小节、同一声部内的音符。');
      this.ensureDivisions(anchor.partIndex);
      const voice = this.voiceGroups(anchor.partIndex, anchor.measureIndex).get(`${anchor.voice}:${anchor.staff}`);
      const selectedNodes = new Set(selected.map(record => this.get(record.id).node));
      const group = remove
        ? tripletGroupAt(voice, voice.findIndex(record => record.members.includes(this.get(anchor.id).node)))
        : voice.filter(record => record.members.some(node => selectedNodes.has(node)));
      if (remove && selected.some(record => !group.some(item => item.members.includes(this.get(record.id).node)))) throw new Error('请一次选择一个三连音组；选其中一个音符即可整组移除。');
      if (!remove && (group.length !== 3 || group.some(record => !record.pitched || record.members.length !== 1)
          || group.some((record, index) => index && record.startUnits !== group[index - 1].startUnits + group[index - 1].durationUnits))) throw new Error('请选择同一小节、同一声部内连续的三个音符（和弦暂不支持）。');
      const divisions = group[0].divisions;
      const nominal = group.map(record => writtenBeats(record.node));
      if (nominal.some(value => !value)) throw new Error('音符缺少记谱时值，无法还原；请先校对原谱。');
      if (!remove) {
        if (nominal.some(value => value !== nominal[0])) throw new Error('三个音符的记谱时值必须相同。');
        if (group.some(record => direct(record.node, 'time-modification'))) throw new Error('所选音符已有连音组，请先移除。');
        if (group.some((record, i) => !close(record.durationUnits / divisions, nominal[i]))) throw new Error('音符的实际时值与记谱时值不符，请先校对该小节。');
      }
      const targetUnits = nominal.map(value => Math.round(value * divisions * (remove ? 1 : 2 / 3)));
      if (targetUnits.some((value, i) => !close(value / divisions, nominal[i] * (remove ? 1 : 2 / 3)))) throw new Error('当前时值精度不足，无法写入三连音。');
      const measure = group[0].measure;
      const backups = backupTargets(measure);
      const difference = group.reduce((sum, record, i) => sum + record.durationUnits - targetUnits[i], 0);
      group.forEach((record, index) => {
        for (const node of record.members) {
          upsert(node, 'duration', targetUnits[index], direct(node, 'voice'));
          setTriplet({ ...record, node }, !remove, index === 0 ? 'start' : index === group.length - 1 ? 'stop' : null);
          for (const beam of children(node, 'beam')) beam.remove();
        }
      });
      if (remove) {
        const meter = this.meterAt(anchor.measureIndex);
        this.rebalanceRests(voice, meter.beats * 4 / meter.beatType, divisions);
      } else {
        const after = group.at(-1).node.nextSibling;
        for (const rest of splitRests(measure, difference, divisions, anchor.voice, anchor.staff)) measure.insertBefore(rest, after);
      }
      repairBackups(measure, backups);
    });
  }

  changeTie(firstId, secondId, remove = false) {
    return this.transaction(() => {
      const first = this.get(firstId), second = this.get(secondId);
      if (!first?.pitched || !second?.pitched) throw new Error('请选择两个有音高的音符。');
      const [a, b] = first.beat <= second.beat ? [first, second] : [second, first];
      if (a.partIndex !== b.partIndex || a.staff !== b.staff || a.voice !== b.voice || a.midi !== b.midi) throw new Error('延音线两端必须是同一声部、同一音高。');
      const chain = this.records.filter(record => record.pitched && record.partIndex === a.partIndex && record.staff === a.staff && record.voice === a.voice && record.midi === a.midi && record.beat >= a.beat - 0.001 && record.beat <= b.beat + 0.001).sort((x, y) => x.beat - y.beat);
      if (chain.length < 2 || chain[0].id !== a.id || chain.at(-1).id !== b.id) throw new Error('没有找到连续的两个音符。');
      for (let i = 1; i < chain.length; i++) {
        if (!close(chain[i - 1].beat + chain[i - 1].durationUnits / chain[i - 1].divisions, chain[i].beat)) throw new Error('两个音符之间有空拍；请先修正节奏再加延音线。');
      }
      for (let i = 0; i < chain.length - 1; i++) {
        setTie(chain[i].node, 'start', !remove);
        setTie(chain[i + 1].node, 'stop', !remove);
      }
    });
  }
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

function setTime(measure, beats, beatType, doc) {
  let attributes = direct(measure, 'attributes');
  if (!attributes) { attributes = element(measure, 'attributes'); measure.insertBefore(attributes, measure.firstChild); }
  let time = direct(attributes, 'time');
  if (!time) {
    time = element(attributes, 'time');
    const later = Array.from(attributes.children).find(node => ['staves', 'clef', 'staff-details', 'transpose', 'directive', 'measure-style'].includes(node.localName));
    attributes.insertBefore(time, later || null);
  }
  upsert(time, 'beats', beats);
  upsert(time, 'beat-type', beatType);
  for (const extra of children(time, 'beats').slice(1)) extra.remove();
  for (const extra of children(time, 'beat-type').slice(1)) extra.remove();
}

function setTie(note, type, add) {
  for (const tie of children(note, 'tie').filter(node => node.getAttribute('type') === type)) tie.remove();
  let notations = direct(note, 'notations');
  if (notations) for (const tied of children(notations, 'tied').filter(node => node.getAttribute('type') === type)) tied.remove();
  if (!add) return;
  const tie = element(note, 'tie');
  tie.setAttribute('type', type);
  note.insertBefore(tie, direct(note, 'voice') || direct(note, 'type') || direct(note, 'notations'));
  if (!notations) { notations = element(note, 'notations'); note.append(notations); }
  const tied = element(notations, 'tied');
  tied.setAttribute('type', type);
  notations.append(tied);
}
