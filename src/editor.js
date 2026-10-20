const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const RHYTHMS = [
  [8, 'breve', 0], [6, 'whole', 1], [4, 'whole', 0], [3, 'half', 1],
  [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
  [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1],
  [0.25, '16th', 0], [0.1875, '32nd', 1], [0.125, '32nd', 0],
];
export const RHYTHM_OPTIONS = RHYTHMS.map(([beats, type, dots]) => ({ beats, type, dots, label: `${type === 'breve' ? '倍全音符' : type === 'whole' ? '全音符' : type === 'half' ? '二分音符' : type === 'quarter' ? '四分音符' : type === 'eighth' ? '八分音符' : type === '16th' ? '十六分音符' : '三十二分音符'}${dots ? '·附点' : ''}` }));

const direct = (parent, name) => Array.from(parent?.children || []).find(node => node.localName === name);
const children = (parent, name) => Array.from(parent?.children || []).filter(node => node.localName === name);
const get = (parent, name, fallback = '') => direct(parent, name)?.textContent?.trim() || fallback;
const int = (parent, name, fallback = 0) => Number(get(parent, name, fallback));
const close = (a, b) => Math.abs(a - b) < 0.002;
const element = (parent, name) => parent.ownerDocument.createElementNS(parent.namespaceURI, name);

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
  if (records.some(record => record.members.some(node => direct(node, 'time-modification')))) throw new Error('此声部含三连音或其他连音组，暂不能自动改时值。');
  const candidates = RHYTHMS.map(([beats]) => Math.round(beats * divisions)).filter(units => units > 0 && units <= targetUnits);
  let states = new Map([[0, { cost: 0, values: [] }]]);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const choices = record.id === fixedId ? [fixedUnits] : record.isMeasureRest ? [targetUnits] : candidates;
    const next = new Map();
    for (const [sum, state] of states) for (const units of choices) {
      if (sum + units > targetUnits) continue;
      const changed = units !== record.durationUnits;
      const distance = Math.abs(units - record.durationUnits) / divisions;
      const cost = state.cost + (changed ? 0.3 + distance * distance + index * 0.0001 : 0);
      const previous = next.get(sum + units);
      if (!previous || cost < previous.cost) next.set(sum + units, { cost, values: [...state.values, units] });
    }
    states = next;
  }
  const solution = states.get(targetUnits);
  if (!solution) throw new Error('选定时值无法与本小节其余音符同时放下。可先调整拍号或其他音符。');
  return solution.values;
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

  findFromSource(source) {
    if (!source || source.isRest?.()) return null;
    const partIndex = Number(source.ParentStaff?.ParentInstrument?.Id);
    const measureIndex = Number(source.SourceMeasure?.MeasureNumber) - 1;
    const local = Number(source.ParentVoiceEntry?.Timestamp?.RealValue) * 4;
    const midi = Number(source.halfTone);
    const voice = String(source.ParentVoiceEntry?.ParentVoice?.VoiceId || '1');
    const staff = String(source.ParentStaff?.Id || '1');
    let candidates = (this.byPosition.get(`${partIndex}:${measureIndex}:${Math.round(local * 1000)}`) || []).filter(record => record.pitched && close(record.startBeats, local));
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
      throw error;
    }
  }

  undo() {
    if (!this.undoStack.length) return null;
    this.redoStack.push(this.serialize());
    this.setXML(this.undoStack.pop());
    return this.xml;
  }

  redo() {
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
        const needed = 16 / gcd(divisions, 16);
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
    if (records.some(record => record.durationUnits <= 0)) throw new Error('此声部含无时值装饰音，暂不能自动改节奏。');
    for (let i = 1; i < records.length; i++) {
      if (!close(records[i].startUnits, records[i - 1].startUnits + records[i - 1].durationUnits)) throw new Error('此声部含交叠音符或跳过的拍点，暂不能自动改节奏。');
    }
    const remainingBeats = targetBeats - records[0].startBeats;
    const targetUnits = Math.round(remainingBeats * divisions);
    if (targetUnits <= 0 || !close(targetUnits / divisions, remainingBeats)) throw new Error('这个拍号无法用当前时值精度表示。');
    const fixedUnits = fixedId ? Math.round(fixedBeats * divisions) : null;
    const values = chooseDurations(records, targetUnits, divisions, fixedId, fixedUnits);
    records.forEach((record, index) => { if (record.durationUnits !== values[index]) setDuration(record, values[index], divisions); });
    for (const record of records) for (const node of record.members) for (const beam of children(node, 'beam')) beam.remove();
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
      this.normalizeVoice(voice, meter.beats * 4 / meter.beatType, record.divisions, selectedGroup.id, beats);
      repairBackups(measure, backups);
    });
  }

  changeMeter(measureIndex, beats, beatType) {
    return this.transaction(() => {
      if (!Number.isInteger(beats) || beats < 1 || beats > 12 || ![2, 4, 8, 16].includes(beatType)) throw new Error('请选择有效拍号。');
      const old = this.meterAt(measureIndex);
      for (let partIndex = 0; partIndex < this.parts.length; partIndex++) {
        this.ensureDivisions(partIndex);
        const measures = children(this.parts[partIndex], 'measure');
        const measure = measures[measureIndex];
        if (!measure) continue;
        const backups = backupTargets(measure);
        const groups = this.voiceGroups(partIndex, measureIndex);
        for (const records of groups.values()) this.normalizeVoice(records, beats * 4 / beatType, records[0].divisions);
        repairBackups(measure, backups);
        setTime(measure, beats, beatType, this.doc);
        const next = measures[measureIndex + 1];
        if (next && !direct(direct(next, 'attributes'), 'time')) setTime(next, old.beats, old.beatType, this.doc);
      }
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
