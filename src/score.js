import JSZip from 'jszip';

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DYNAMIC = { ppp: 34, pp: 44, p: 56, mp: 68, mf: 82, f: 98, ff: 112, fff: 122, sf: 105, sfz: 110, fp: 88 };
const direct = (el, tag) => Array.from(el?.children || []).find(child => child.localName === tag);
const children = (el, tag) => Array.from(el?.children || []).filter(child => child.localName === tag);
const value = (el, tag, fallback = '') => direct(el, tag)?.textContent?.trim() || fallback;
const number = (el, tag, fallback = 0) => Number(value(el, tag, fallback)) || fallback;

function timeLength(time) {
  const beats = children(time, 'beats');
  const beatTypes = children(time, 'beat-type');
  if (!beats.length || beats.length !== beatTypes.length) return null;
  const length = beats.reduce((sum, item, i) => {
    const count = item.textContent.split('+').reduce((total, beat) => total + Number(beat.trim()), 0);
    return sum + count * 4 / Number(beatTypes[i].textContent);
  }, 0);
  return Number.isFinite(length) && length > 0 ? length : null;
}

export async function readScoreFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const container = zip.file('META-INF/container.xml');
    let rootPath = '';
    if (container) {
      const doc = new DOMParser().parseFromString(await container.async('text'), 'application/xml');
      rootPath = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') || '';
    }
    const entry = zip.file(rootPath) || Object.values(zip.files).find(f => !f.dir && /\.(musicxml|xml)$/i.test(f.name) && !f.name.startsWith('META-INF/'));
    if (!entry) throw new Error('压缩乐谱中没有找到 MusicXML 文件。');
    return entry.async('text');
  }
  if (/\.(musicxml|xml)$/i.test(name)) return file.text();
  throw new Error('目前请上传 MusicXML、XML 或 MXL。扫描 PDF／照片尚未接入识谱。');
}

function partLabel(name, index) {
  const n = name.toLowerCase();
  if (/piano|钢琴|键盘/.test(n)) return { role: 'P', title: '钢琴', color: '#7b8494', program: 21 };
  if (/soprano|女高|高音|^s\b/.test(n)) return { role: 'S', title: '女高音', color: '#d66556', program: 1 };
  if (/alto|contralto|女低|次女高|^a\b/.test(n)) return { role: 'A', title: '女低音', color: '#bc8b4a', program: 2 };
  if (/tenor|男高|^t\b/.test(n)) return { role: 'T', title: '男高音', color: '#4d938f', program: 3 };
  if (/bass|baritone|男低|^b\b/.test(n)) return { role: 'B', title: '男低音', color: '#6583a1', program: 4 };
  return [
    { role: 'S', title: '女高音', color: '#d66556', program: 1 },
    { role: 'A', title: '女低音', color: '#bc8b4a', program: 2 },
    { role: 'T', title: '男高音', color: '#4d938f', program: 3 },
    { role: 'B', title: '男低音', color: '#6583a1', program: 4 },
  ][index % 4];
}

export function parseScore(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML 格式有误，无法读取。');
  const root = doc.documentElement;
  if (root.localName !== 'score-partwise') throw new Error('目前只支持 score-partwise 格式的 MusicXML。');

  const title = value(direct(root, 'work'), 'work-title') || value(root, 'movement-title', '未命名乐谱');
  const partDefs = new Map(children(direct(root, 'part-list'), 'score-part').map((p, i) => [p.getAttribute('id'), { name: value(p, 'part-name', `声部 ${i + 1}`), index: i }]));
  const raw = [];
  const rawDirections = [];
  const measureLengths = [];
  const measureReadings = [];
  const tempos = [];

  for (const part of children(root, 'part')) {
    const partId = part.getAttribute('id');
    let divisions = 1;
    let fifths = 0;
    let expected = 4;
    const measures = children(part, 'measure');
    measures.forEach((measure, mi) => {
      let cursor = 0;
      let furthest = 0;
      let lastStart = 0;
      for (const node of Array.from(measure.children)) {
        const tag = node.localName;
        if (tag === 'attributes') {
          divisions = number(node, 'divisions', divisions);
          const key = direct(node, 'key');
          if (key) fifths = number(key, 'fifths', fifths);
          const time = direct(node, 'time');
          if (time) expected = timeLength(time) ?? expected;
        } else if (tag === 'backup') {
          cursor -= number(node, 'duration') / divisions;
        } else if (tag === 'forward') {
          cursor += number(node, 'duration') / divisions;
          furthest = Math.max(furthest, cursor);
        } else if (tag === 'direction') {
          const directionType = direct(node, 'direction-type');
          const dyn = direct(directionType, 'dynamics');
          const wedge = direct(directionType, 'wedge');
          const sound = direct(node, 'sound');
          const metronome = direct(directionType, 'metronome');
          const tempo = Number(sound?.getAttribute('tempo') || value(metronome, 'per-minute', 0));
          const position = cursor + number(node, 'offset') / divisions;
          if (tempo > 0) tempos.push({ measure: mi, local: position, tempo });
          if (dyn || wedge) rawDirections.push({ partId, measure: mi, local: position, staff: value(node, 'staff', ''), dynamic: dyn?.firstElementChild?.localName, wedge: wedge?.getAttribute('type') });
        } else if (tag === 'note') {
          const duration = number(node, 'duration') / divisions;
          const isChord = !!direct(node, 'chord');
          const start = isChord ? lastStart : cursor;
          if (!isChord) lastStart = start;
          const pitch = direct(node, 'pitch');
          const unpitched = direct(node, 'unpitched');
          if ((pitch || unpitched) && !direct(node, 'rest')) {
            const step = pitch ? value(pitch, 'step', 'C') : value(unpitched, 'display-step', 'C');
            const octave = pitch ? number(pitch, 'octave', 4) : number(unpitched, 'display-octave', 4);
            const midi = (octave + 1) * 12 + (STEP[step] || 0) + number(pitch, 'alter');
            const notehead = value(node, 'notehead').toLowerCase();
            // A crossed notehead retains its staff pitch. Until a reliable
            // breathy singer is available, playback uses the same voiced doo.
            const breath = notehead === 'x' || notehead === 'circle x' || notehead === 'circled x';
            const notations = direct(node, 'notations');
            const articulations = direct(notations, 'articulations');
            const ornaments = direct(notations, 'ornaments');
            // <tie> describes playback; some OMR exports only include the
            // visual <tied> notation. A slur is deliberately not a tie.
            const soundTies = children(node, 'tie');
            const ties = soundTies.length ? soundTies : children(notations, 'tied');
            const tieTypes = new Set(ties.map(tie => tie.getAttribute('type')));
            const lyric = children(node, 'lyric').map(l => value(l, 'text')).filter(Boolean).join(' / ');
            raw.push({ partId, measure: mi, local: start, duration, midi, step, fifths, voice: value(node, 'voice', '1'), staff: value(node, 'staff', '1'), lyric, breath,
              staccato: !!(direct(articulations, 'staccato') || direct(articulations, 'staccatissimo')),
              accent: !!direct(articulations, 'accent'),
              trill: !!direct(ornaments, 'trill-mark'),
              glissStart: !!(children(notations, 'glissando').find(x => x.getAttribute('type') === 'start') || children(notations, 'slide').find(x => x.getAttribute('type') === 'start')),
              glissStop: !!(children(notations, 'glissando').find(x => x.getAttribute('type') === 'stop') || children(notations, 'slide').find(x => x.getAttribute('type') === 'stop')),
              tieStart: tieTypes.has('start') || tieTypes.has('continue'),
              tieStop: tieTypes.has('stop') || tieTypes.has('continue'),
            });
          }
          if (!isChord) cursor += duration;
          furthest = Math.max(furthest, cursor);
        }
      }
      const notes = children(measure, 'note');
      const wholeRest = notes.length === 1 && direct(notes[0], 'rest')?.getAttribute('measure') === 'yes';
      (measureReadings[mi] ||= []).push({ expected, furthest, wholeRest, implicit: measure.getAttribute('implicit') === 'yes' || measure.getAttribute('number') === '0' });
    });
  }

  const measureIssues = [];
  for (const [mi, readings] of measureReadings.entries()) {
    // The printed time signature defines the bar. OMR often exports a whole
    // measure rest as four beats even in 6/8, which must not lengthen playback.
    const lengths = new Map();
    for (const { expected } of readings) lengths.set(expected, (lengths.get(expected) || 0) + 1);
    const expected = Array.from(lengths).sort((a, b) => b[1] - a[1])[0]?.[0] || 4;
    const occupiedCounts = new Map();
    for (const { furthest, wholeRest } of readings) {
      if (furthest <= 0 || wholeRest) continue;
      const occupied = Math.round(furthest * 1000) / 1000;
      occupiedCounts.set(occupied, (occupiedCounts.get(occupied) || 0) + 1);
    }
    const [occupied = expected, agreement = 0] = Array.from(occupiedCounts)
      .sort((a, b) => b[1] - a[1] || Math.abs(a[0] - expected) - Math.abs(b[0] - expected))[0] || [];
    const hasConsensus = !occupiedCounts.size || agreement > readings.filter(reading => !reading.wholeRest && reading.furthest > 0).length / 2;
    const implicit = readings.every(reading => reading.implicit);
    const validPickup = implicit && hasConsensus && occupied < expected - 0.01 && readings.every(reading =>
      reading.wholeRest || reading.furthest <= 0 || Math.abs(reading.furthest - occupied) <= 0.01);
    measureLengths[mi] = validPickup ? occupied : expected;
    const partMismatch = readings.some(reading => reading.furthest > 0 && Math.abs(reading.furthest - expected) > 0.01 && !reading.wholeRest);
    if (!validPickup && (partMismatch || !hasConsensus)) measureIssues.push(mi + 1);
  }

  const starts = [];
  let totalBeats = 0;
  for (const length of measureLengths) { starts.push(totalBeats); totalBeats += length || 4; }
  const byPart = new Map();
  for (const note of raw) {
    // One user-facing mixer track corresponds to one printed staff. MusicXML
    // voice numbers describe polyphony inside that staff, not extra singers.
    const id = `${note.partId}:${note.staff}`;
    if (!byPart.has(id)) byPart.set(id, []);
    byPart.get(id).push({ ...note, beat: starts[note.measure] + note.local });
  }
  // Keep silent staves editable after their last pitched note is deleted.
  const trackInfo = new Map();
  for (const part of children(root, 'part')) {
    const partId = part.getAttribute('id');
    const staves = new Set(['1']);
    for (const note of part.getElementsByTagName('note')) staves.add(value(note, 'staff', '1'));
    for (const count of part.getElementsByTagName('staves')) for (let staff = 1; staff <= Number(count.textContent); staff++) staves.add(String(staff));
    for (const staff of staves) {
      const id = `${partId}:${staff}`;
      trackInfo.set(id, { partId, staff });
      if (!byPart.has(id)) byPart.set(id, []);
    }
  }
  const closedSATB = byPart.size === 4 && new Set(Array.from(trackInfo.values(), item => item.partId)).size <= 2;
  const genericVoiceGroups = Array.from(byPart, ([id, notes]) => ({ id, notes, name: partDefs.get(trackInfo.get(id).partId)?.name || '' }))
    .filter(group => /^voice$/i.test(group.name) && group.notes.length >= 20)
      .sort((a, b) => (partDefs.get(trackInfo.get(a.id).partId)?.index ?? 999) - (partDefs.get(trackInfo.get(b.id).partId)?.index ?? 999));
  const inferredRoles = new Map(genericVoiceGroups.length >= 4 ? genericVoiceGroups.slice(0, 4).map((group, i) => [group.id, partLabel('', i)]) : []);
  const tracks = Array.from(trackInfo, ([id, info], i) => {
    const notes = byPart.get(id);
    const { partId, staff } = info;
    const def = partDefs.get(partId) || { name: `声部 ${i + 1}`, index: i };
    const role = inferredRoles.get(id) || (closedSATB ? partLabel('', i) : /^voice$/i.test(def.name) ? { role: 'V', title: '附加人声', color: '#8e9b87', program: 1 } : partLabel(def.name, def.index));
    const samePartTracks = Array.from(byPart.keys()).filter(k => k.startsWith(`${partId}:`));
    const label = inferredRoles.has(id) ? `${role.title}（推测）` : /^voice$/i.test(def.name) ? `附加人声 ${def.index + 1}` : samePartTracks.length > 1 ? `${def.name} · ${staff} 谱表` : def.name;
    const directions = rawDirections.filter(d => d.partId === partId && (!d.staff || d.staff === staff)).map(d => ({ ...d, beat: starts[d.measure] + d.local })).sort((a, b) => a.beat - b.beat);
    notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
    return { id, partId, label, ...role, notes, directions, enabled: true, volume: 0.85, channel: i >= 9 ? i + 1 : i };
  });
  if (!tracks.length) throw new Error('乐谱中没有找到可播放的音符。');
  if (tracks.length > 15) throw new Error('原型目前最多支持 15 条独立声部。');
  const tempoMap = tempos.map(t => ({ beat: starts[t.measure] + t.local, tempo: t.tempo })).sort((a, b) => a.beat - b.beat);
  if (!tempoMap.length || tempoMap[0].beat > 0) tempoMap.unshift({ beat: 0, tempo: 90 });
  return { title: title || '未命名乐谱', xml, tracks, tempoMap, totalBeats, measureStarts: starts, measures: measureLengths.length, measureIssues, lyrics: raw.filter(n => n.lyric).length, breathNotes: raw.filter(n => n.breath).length };
}

export function beatToSeconds(score, beat, tempoScale = 1) {
  let seconds = 0;
  let previousBeat = 0;
  let tempo = score.tempoMap[0]?.tempo || 90;
  for (const point of score.tempoMap) {
    if (point.beat >= beat) break;
    seconds += (point.beat - previousBeat) * 60 / tempo;
    previousBeat = point.beat;
    tempo = point.tempo;
  }
  return (seconds + (beat - previousBeat) * 60 / tempo) / tempoScale;
}

export function expressionAt(track, beat) {
  const events = track.directions;
  let current = 82;
  let wedgeStart = null;
  for (const event of events) {
    if (event.beat > beat) break;
    if (event.dynamic && DYNAMIC[event.dynamic]) current = DYNAMIC[event.dynamic];
    if (event.wedge === 'crescendo' || event.wedge === 'diminuendo') wedgeStart = { beat: event.beat, value: current, type: event.wedge };
    if (event.wedge === 'stop') wedgeStart = null;
  }
  if (!wedgeStart) return current;
  const end = events.find(e => e.beat > wedgeStart.beat && (e.wedge === 'stop' || DYNAMIC[e.dynamic]));
  const endBeat = end?.beat || Math.min(wedgeStart.beat + 4, track.notes.at(-1)?.beat || wedgeStart.beat + 4);
  const endValue = DYNAMIC[end?.dynamic] || Math.max(25, Math.min(120, wedgeStart.value + (wedgeStart.type === 'crescendo' ? 25 : -25)));
  const fraction = Math.max(0, Math.min(1, (beat - wedgeStart.beat) / Math.max(0.01, endBeat - wedgeStart.beat)));
  return Math.round(wedgeStart.value + (endValue - wedgeStart.value) * fraction);
}
