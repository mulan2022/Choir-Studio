// Repack the 70 MB choir practice soundfont into a bank that carries only the
// presets this player can reach: the four "doo" voice programs (1-4) and the
// piano (21). Everything else — the "da" voices and the clarinet — is dropped
// instead of being downloaded by every visitor.
//
// Presets are copied zone for zone, so the piano keeps both recorded layers and
// sounds exactly like the original; only unreachable presets and their samples
// disappear.
//
//   node scripts/repack-soundfont.mjs [source.sf2] [output.sf2]
//
// The source bank stays out of public/ (it would be copied into every build);
// download it from the upstream project into tools/soundfonts/ when rebuilding.
//
import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2] || 'tools/soundfonts/Choir_practice.sf2';
const output = process.argv[3] || 'public/soundfonts/choir-practice-lite.sf2';
const KEEP_PRESETS = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 21]];
const GAP_FRAMES = 46; // standard SoundFont gap between samples, avoids clicks

const buf = fs.readFileSync(source);
const name20 = o => buf.toString('ascii', o, o + 20).replace(/\0.*$/s, '');

function chunkAt(offset) {
  const id = buf.toString('ascii', offset, offset + 4);
  const size = buf.readUInt32LE(offset + 4);
  return { id, size, start: offset + 8, end: offset + 8 + size };
}
function walk(start, end, out = []) {
  let offset = start;
  while (offset + 8 <= end) {
    const chunk = chunkAt(offset);
    if (chunk.id === 'LIST') walk(chunk.start + 4, chunk.end, out);
    else out.push(chunk);
    offset = chunk.end + (chunk.size & 1);
  }
  return out;
}
const riff = chunkAt(0);
const chunks = walk(riff.start + 4, riff.end);
const find = id => chunks.find(chunk => chunk.id === id);
const info = chunks.filter(chunk => ['ifil', 'isng', 'INAM', 'IPRD', 'ICOP', 'ICMT', 'ISFT'].includes(chunk.id));

const phdr = find('phdr'), shdr = find('shdr'), pbag = find('pbag'), pgen = find('pgen'), inst = find('inst'), ibag = find('ibag'), igen = find('igen'), smpl = find('smpl');
const bagField = (chunk, index) => buf.readUInt16LE(chunk.start + index * 4);
const bagMod = (chunk, index) => buf.readUInt16LE(chunk.start + index * 4 + 2);
const genAt = (chunk, index) => [buf.readUInt16LE(chunk.start + index * 4), buf.readUInt16LE(chunk.start + index * 4 + 2)];

const presets = [];
for (let o = phdr.start; o + 38 <= phdr.end; o += 38) presets.push({ name: name20(o), preset: buf.readUInt16LE(o + 20), bank: buf.readUInt16LE(o + 22), bag: buf.readUInt16LE(o + 24), offset: o });
const instruments = [];
for (let o = inst.start; o + 22 <= inst.end; o += 22) instruments.push({ name: name20(o), bag: buf.readUInt16LE(o + 20), offset: o });
const samples = [];
for (let o = shdr.start; o + 46 <= shdr.end; o += 46) {
  samples.push({ name: name20(o), offset: o, start: buf.readUInt32LE(o + 20), end: buf.readUInt32LE(o + 24), loopStart: buf.readUInt32LE(o + 28), loopEnd: buf.readUInt32LE(o + 32), link: buf.readUInt16LE(o + 42), type: buf.readUInt16LE(o + 44) });
}

// A record owns several zones; each zone is its own generator run plus a
// modulator list index that has to survive the rewrite.
function recordZones(records, bagChunk, genChunk, index) {
  const lastBag = index + 1 < records.length ? records[index + 1].bag : bagChunk.size / 4;
  const zones = [];
  for (let b = records[index].bag; b < lastBag; b++) {
    const from = bagField(bagChunk, b);
    const to = b + 1 < bagChunk.size / 4 ? bagField(bagChunk, b + 1) : genChunk.size / 4;
    const gens = [];
    for (let g = from; g < to; g++) { const [oper, amount] = genAt(genChunk, g); if (oper !== 0) gens.push([oper, amount]); }
    zones.push({ gens, modNdx: bagMod(bagChunk, b) });
  }
  return zones;
}

const presetIndex = (bank, preset) => presets.findIndex(p => p.bank === bank && p.preset === preset);
const keptPresets = KEEP_PRESETS.map(([bank, preset]) => {
  const index = presetIndex(bank, preset);
  if (index < 0) throw new Error(`preset ${bank}:${preset} not found`);
  return { index, preset: presets[index] };
});

const keptInstruments = new Map();
const keptSamples = new Map();
const presetZones = [];

for (const { index, preset } of keptPresets) {
  // Presets are copied zone for zone: the piano in particular keeps both of its
  // recorded layers, because dropping one audibly thins the tone. Only presets
  // that can never sound (the "da" voices, the clarinet) are left out.
  const zones = recordZones(presets, pbag, pgen, index);
  presetZones.push({ preset, zones });
  for (const zone of zones) {
    for (const [oper, amount] of zone.gens) {
      if (oper !== 41) continue;
      if (amount >= instruments.length - 1) throw new Error(`preset ${preset.name} references the terminal instrument record`);
      if (!keptInstruments.has(amount)) keptInstruments.set(amount, keptInstruments.size);
    }
  }
}

const instrumentZones = new Map();
for (const originalIndex of keptInstruments.keys()) {
  const zones = recordZones(instruments, ibag, igen, originalIndex);
  instrumentZones.set(originalIndex, zones);
  for (const zone of zones) {
    for (const [oper, amount] of zone.gens) {
      if (oper !== 53) continue;
      if (amount >= samples.length - 1) throw new Error(`instrument ${instruments[originalIndex].name} references missing sample ${amount}`);
      if (!keptSamples.has(amount)) keptSamples.set(amount, keptSamples.size);
    }
  }
}

// --- rebuild sample data ----------------------------------------------------
const totalFrames = [...keptSamples.keys()].reduce((sum, id) => sum + Math.max(0, samples[id].end - samples[id].start) + GAP_FRAMES, 0);
const smplData = Buffer.alloc(totalFrames * 2);
const frameMap = new Map();
let cursor = 0;
for (const originalId of keptSamples.keys()) {
  const sample = samples[originalId];
  const frames = Math.max(0, sample.end - sample.start);
  buf.copy(smplData, cursor * 2, smpl.start + sample.start * 2, smpl.start + sample.end * 2);
  frameMap.set(originalId, { start: cursor, end: cursor + frames });
  cursor += frames + GAP_FRAMES;
}

// --- rebuild pdta -----------------------------------------------------------
const newShdr = Buffer.alloc((keptSamples.size + 1) * 46);
for (const [originalId, newIndex] of keptSamples) {
  const sample = samples[originalId];
  const target = newIndex * 46;
  buf.copy(newShdr, target, sample.offset, sample.offset + 20);
  const frames = frameMap.get(originalId);
  newShdr.writeUInt32LE(frames.start, target + 20);
  newShdr.writeUInt32LE(frames.end, target + 24);
  newShdr.writeUInt32LE(sample.loopStart - sample.start + frames.start, target + 28);
  newShdr.writeUInt32LE(sample.loopEnd - sample.start + frames.start, target + 32);
  buf.copy(newShdr, target + 36, sample.offset + 36, sample.offset + 42); // rate, pitch, correction
  // sampleLink is only meaningful for the two stereo channel types; mono
  // samples carry 0 and must not inherit a remapped neighbour index.
  const partner = sample.type === 1 ? 0 : (keptSamples.get(sample.link) ?? 0);
  newShdr.writeUInt16LE(partner, target + 42);
  newShdr.writeUInt16LE(sample.type, target + 44);
}

const newIgen = [];
const newIbag = [];
const keptInstrumentOrder = [...keptInstruments.keys()];
const instrumentFirstBag = new Map();
for (const originalId of keptInstrumentOrder) {
  instrumentFirstBag.set(originalId, newIbag.length);
  for (const zone of instrumentZones.get(originalId)) {
    newIbag.push([newIgen.length, zone.modNdx]);
    for (const [oper, amount] of zone.gens) newIgen.push([oper, oper === 53 ? keptSamples.get(amount) : amount]);
  }
}
newIbag.push([newIgen.length, 0]);

const newInst = Buffer.alloc((keptInstrumentOrder.length + 1) * 22);
keptInstrumentOrder.forEach((originalId, newIndex) => {
  const instrument = instruments[originalId];
  const target = newIndex * 22;
  buf.copy(newInst, target, instrument.offset, instrument.offset + 20);
  newInst.writeUInt16LE(instrumentFirstBag.get(originalId), target + 20);
});
newInst.writeUInt16LE(newIbag.length - 1, keptInstrumentOrder.length * 22 + 20);

const newPgen = [];
const newPbag = [];
const newPhdr = Buffer.alloc((presetZones.length + 1) * 38);
presetZones.forEach(({ preset, zones }, newIndex) => {
  buf.copy(newPhdr, newIndex * 38, preset.offset, preset.offset + 24);
  buf.copy(newPhdr, newIndex * 38 + 28, preset.offset + 28, preset.offset + 38);
  newPhdr.writeUInt16LE(newPbag.length, newIndex * 38 + 24);
  for (const zone of zones) {
    newPbag.push([newPgen.length, zone.modNdx]);
    for (const [oper, amount] of zone.gens) newPgen.push([oper, oper === 41 ? keptInstruments.get(amount) : amount]);
  }
});
newPhdr.writeUInt16LE(newPbag.length, presetZones.length * 38 + 24); // terminal EOP record

const packBags = bags => {
  const out = Buffer.alloc(bags.length * 4);
  bags.forEach(([genNdx, modNdx], i) => { out.writeUInt16LE(genNdx, i * 4); out.writeUInt16LE(modNdx, i * 4 + 2); });
  return out;
};
const packGens = gens => {
  const out = Buffer.alloc(gens.length * 4);
  gens.forEach(([oper, amount], i) => { out.writeUInt16LE(oper, i * 4); out.writeUInt16LE(amount, i * 4 + 2); });
  return out;
};

// --- write RIFF -------------------------------------------------------------
function chunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return data.length & 1 ? Buffer.concat([header, data, Buffer.alloc(1)]) : Buffer.concat([header, data]);
}
const list = (type, children) => chunk('LIST', Buffer.concat([Buffer.from(type, 'ascii'), ...children]));

const pmod = Buffer.from(buf.subarray(find('pmod').start, find('pmod').end));
const imod = Buffer.from(buf.subarray(find('imod').start, find('imod').end));
const body = Buffer.concat([
  Buffer.from('sfbk', 'ascii'),
  list('INFO', info.map(c => chunk(c.id, Buffer.from(buf.subarray(c.start, c.end))))),
  list('sdta', [chunk('smpl', smplData)]),
  list('pdta', [
    chunk('phdr', newPhdr),
    chunk('pbag', packBags(newPbag)),
    chunk('pmod', pmod),
    chunk('pgen', packGens(newPgen)),
    chunk('inst', newInst),
    chunk('ibag', packBags(newIbag)),
    chunk('imod', imod),
    chunk('igen', packGens(newIgen)),
    chunk('shdr', newShdr),
  ]),
]);
const header = Buffer.alloc(8);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(body.length, 4);
const result = Buffer.concat([header, body]);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, result);

const mb = n => (n / 1048576).toFixed(2);
console.log(`\n${source} ${mb(buf.length)} MB → ${output} ${mb(result.length)} MB`);
console.log(`presets ${presetZones.length} · instruments ${keptInstrumentOrder.length} · samples ${keptSamples.size} · frames ${totalFrames}`);
for (const { preset, zones } of presetZones) console.log(`  bank ${preset.bank} prog ${String(preset.preset).padStart(2)} ${preset.name.padEnd(14)} ${zones.length} zones`);
