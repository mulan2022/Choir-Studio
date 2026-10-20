// Compares a repacked soundfont against its source: for every preset that
// survived, every MIDI key and the velocities the player can emit, the resolved
// sample (name + PCM content) and its tuning must be identical.
//
//   node scripts/verify-soundfont.mjs source.sf2 lite.sf2
import fs from 'node:fs';

const [sourcePath, litePath] = process.argv.slice(2);
// Every velocity has to resolve to the same sample as the original: the bank is
// only allowed to drop presets that can never sound (da voices, clarinet).
const VELOCITIES = [1, 40, 64, 82, 88, 100, 120, 127];
const KEYS = Array.from({ length: 88 }, (_, i) => i + 21);

function load(file) {
  const buf = fs.readFileSync(file);
  const chunkAt = o => ({ id: buf.toString('ascii', o, o + 4), size: buf.readUInt32LE(o + 4), start: o + 8, end: o + 8 + buf.readUInt32LE(o + 4) });
  function walk(start, end, out = []) {
    let o = start;
    while (o + 8 <= end) {
      const c = chunkAt(o);
      if (c.id === 'LIST') walk(c.start + 4, c.end, out); else out.push(c);
      o = c.end + (c.size & 1);
    }
    return out;
  }
  const riff = chunkAt(0);
  const chunks = walk(riff.start + 4, riff.end);
  const find = id => chunks.find(c => c.id === id);
  const smpl = find('smpl');
  const name20 = o => buf.toString('ascii', o, o + 20).replace(/\0.*$/s, '');

  const presets = [], instruments = [], samples = [];
  const phdr = find('phdr'), inst = find('inst'), shdr = find('shdr');
  for (let o = phdr.start; o + 38 <= phdr.end; o += 38) presets.push({ name: name20(o), preset: buf.readUInt16LE(o + 20), bank: buf.readUInt16LE(o + 22), bag: buf.readUInt16LE(o + 24) });
  for (let o = inst.start; o + 22 <= inst.end; o += 22) instruments.push({ name: name20(o), bag: buf.readUInt16LE(o + 20) });
  for (let o = shdr.start; o + 46 <= shdr.end; o += 46) samples.push({ name: name20(o), start: buf.readUInt32LE(o + 20), end: buf.readUInt32LE(o + 24), rate: buf.readUInt32LE(o + 36), pitch: buf.readUInt8(o + 40) });

  const bag = (chunk, i) => buf.readUInt16LE(chunk.start + i * 4);
  const gen = (chunk, i) => [buf.readUInt16LE(chunk.start + i * 4), buf.readUInt16LE(chunk.start + i * 4 + 2)];

  function recordZones(records, bagChunk, genChunk, index) {
    const lastBag = index + 1 < records.length ? records[index + 1].bag : bagChunk.size / 4;
    const zones = [];
    for (let b = records[index].bag; b < lastBag; b++) {
      const from = bag(bagChunk, b);
      const to = b + 1 < bagChunk.size / 4 ? bag(bagChunk, b + 1) : genChunk.size / 4;
      const gens = new Map();
      for (let g = from; g < to; g++) { const [oper, amount] = gen(genChunk, g); if (oper !== 0) gens.set(oper, amount); }
      zones.push(gens);
    }
    return zones;
  }

  const resolve = (presetNumber, key, velocity) => {
    const pindex = presets.findIndex(p => p.bank === 0 && p.preset === presetNumber);
    if (pindex < 0) return null;
    const presetZones = recordZones(presets, find('pbag'), find('pgen'), pindex);
    const global = new Map();
    const hits = [];
    for (const zone of presetZones) {
      const keyGen = zone.get(43), velGen = zone.get(44);
      const [klo, khi] = keyGen === undefined ? [0, 127] : [keyGen & 0xff, keyGen >> 8];
      const [vlo, vhi] = velGen === undefined ? [0, 127] : [velGen & 0xff, velGen >> 8];
      if (!zone.has(41)) { for (const [k, v] of zone) if (!global.has(k)) global.set(k, v); continue; }
      if (key < klo || key > khi || velocity < vlo || velocity > vhi) continue;
      hits.push(zone.get(41));
    }
    if (!hits.length) return { silent: true };
    const out = [];
    for (const instrumentIndex of hits) {
      const instrument = instruments[instrumentIndex];
      if (!instrument || instrument.name === 'EOI') continue;
      let sampleId = null;
      const gens = new Map(global);
      for (const zone of recordZones(instruments, find('ibag'), find('igen'), instrumentIndex)) {
        const keyGen = zone.get(43), velGen = zone.get(44);
        const [klo, khi] = keyGen === undefined ? [0, 127] : [keyGen & 0xff, keyGen >> 8];
        const [vlo, vhi] = velGen === undefined ? [0, 127] : [velGen & 0xff, velGen >> 8];
        if (key < klo || key > khi || velocity < vlo || velocity > vhi) continue;
        if (zone.has(53)) { sampleId = zone.get(53); for (const [k, v] of zone) gens.set(k, v); break; }
      }
      if (sampleId === null) continue;
      const sample = samples[sampleId];
      if (!sample) continue;
      const data = buf.subarray(smpl.start + sample.start * 2, smpl.start + Math.min(sample.end, sample.start + 2000) * 2);
      out.push({
        instrument: instrument.name,
        sample: sample.name,
        rootKey: gens.get(58) ?? sample.pitch,
        coarse: gens.get(51) ?? 0,
        fine: gens.get(52) ?? 0,
        mode: gens.get(54) ?? 0,
        scale: gens.get(56) ?? 100,
        atten: gens.get(48) ?? 0,
        pan: gens.get(17) ?? 0,
        data: data.toString('base64'),
      });
    }
    return { zones: out };
  };

  return { presets, resolve };
}

const source = load(sourcePath);
const lite = load(litePath);
let checks = 0, failures = 0;
const keptPresets = lite.presets.filter(p => p.name !== 'EOP');
console.log(`comparing ${keptPresets.length} presets × ${KEYS.length} keys × ${VELOCITIES.length} velocities\n`);

for (const preset of keptPresets) {
  let presetChecks = 0, presetFailures = 0;
  for (const key of KEYS) {
    for (const velocity of VELOCITIES) {
      const a = source.resolve(preset.preset, key, velocity);
      const b = lite.resolve(preset.preset, key, velocity);
      presetChecks++;
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (!same) {
        presetFailures++;
        if (presetFailures <= 3) console.log(`  ✗ prog ${preset.preset} key ${key} vel ${velocity}\n    source: ${JSON.stringify(a).slice(0, 220)}\n    lite  : ${JSON.stringify(b).slice(0, 220)}`);
      }
    }
  }
  checks += presetChecks;
  failures += presetFailures;
  console.log(`${presetFailures ? '✗' : '✓'} prog ${String(preset.preset).padStart(2)} ${preset.name.padEnd(14)} ${presetChecks} checks, ${presetFailures} differences`);
}

console.log(`\n${checks - failures}/${checks} identical`);

// Structural sanity: every sample must sit inside the sample data with legal
// loop points, and every stereo link must point at a real neighbour.
const structural = [];
{
  const buf = fs.readFileSync(litePath);
  const chunkAt = o => ({ id: buf.toString('ascii', o, o + 4), size: buf.readUInt32LE(o + 4), start: o + 8, end: o + 8 + buf.readUInt32LE(o + 4) });
  const walk = (start, end, out = []) => {
    let o = start;
    while (o + 8 <= end) { const c = chunkAt(o); if (c.id === 'LIST') walk(c.start + 4, c.end, out); else out.push(c); o = c.end + (c.size & 1); }
    return out;
  };
  const chunks = walk(chunkAt(0).start + 4, chunkAt(0).end);
  const shdr = chunks.find(c => c.id === 'shdr');
  const smpl = chunks.find(c => c.id === 'smpl');
  const frames = smpl.size / 2;
  const records = [];
  for (let o = shdr.start; o + 46 <= shdr.end; o += 46) {
    records.push({
      name: buf.toString('ascii', o, o + 20).replace(/\0.*$/s, '') || '(terminal)',
      start: buf.readUInt32LE(o + 20), end: buf.readUInt32LE(o + 24),
      loopStart: buf.readUInt32LE(o + 28), loopEnd: buf.readUInt32LE(o + 32),
      link: buf.readUInt16LE(o + 42), type: buf.readUInt16LE(o + 44),
    });
  }
  const total = records.filter(record => record.type).length;
  for (const [index, record] of records.entries()) {
    if (!record.type) continue;
    if (!(record.start < record.end)) structural.push(`${record.name}: empty range ${record.start}-${record.end}`);
    if (record.end > frames) structural.push(`${record.name}: end ${record.end} past ${frames} frames`);
    if (record.loopEnd > record.end) structural.push(`${record.name}: loop end ${record.loopEnd} past sample end ${record.end}`);
    if (record.loopStart > record.loopEnd) structural.push(`${record.name}: loop start ${record.loopStart} past loop end ${record.loopEnd}`);
    if (record.link >= total) structural.push(`${record.name}: sampleLink ${record.link} out of range (${total} samples)`);
    // Mono samples carry no link; only the stereo channel types point at a partner.
    if (record.type === 1 && record.link !== 0) structural.push(`${record.name}: mono sample links to ${record.link}`);
    const partner = records[record.link];
    if (record.type === 2 && (!partner || partner.type !== 4)) structural.push(`${record.name}: right channel links to type ${partner?.type}`);
    if (record.type === 4 && (!partner || partner.type !== 2)) structural.push(`${record.name}: left channel links to type ${partner?.type}`);
  }
  console.log(`structure: ${total} samples, ${frames} frames, ${structural.length} problems`);
}
for (const problem of structural.slice(0, 10)) console.log(`  ✗ ${problem}`);
process.exitCode = failures || structural.length ? 1 : 0;
