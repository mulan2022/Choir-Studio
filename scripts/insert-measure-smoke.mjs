import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5187/', { waitUntil: 'domcontentloaded' });
  const core = await page.evaluate(async () => {
    const { ScoreEditor } = await import('/src/editor.js');
    const { parseScore } = await import('/src/score.js');
    const { sampleXML } = await import('/src/sample.js');
    const editor = new ScoreEditor(sampleXML);
    editor.insertMeasure(1);
    const empty = parseScore(editor.serialize());
    const slot = editor.restSlots(1)[0];
    editor.insertNote(1, slot, 0, 72, 1);
    editor.insertNote(1, slot, 1.5, 74, 0.5);
    const edited = parseScore(editor.serialize());
    const voice = editor.voiceGroups(slot.partIndex, 1).get(`${slot.voice}:${slot.staff}`);
    const sum = voice.reduce((total, note) => total + note.durationUnits / note.divisions, 0);
    const beforeInvalid = editor.serialize();
    let invalidRejected = false;
    try { editor.insertNote(1, slot, 3.5, 76, 1); } catch { invalidRejected = true; }
    const rollback = beforeInvalid === editor.serialize();
    editor.undo();
    const afterUndo = editor.records.filter(record => record.measureIndex === 1 && record.partIndex === slot.partIndex && record.pitched).length;
    editor.redo();
    const afterRedo = editor.records.filter(record => record.measureIndex === 1 && record.partIndex === slot.partIndex && record.pitched).length;
    editor.changeMeter(1, 3, 4);
    const resizedIssues = parseScore(editor.serialize()).measureIssues;
    const resizedSum = editor.voiceGroups(slot.partIndex, 1).get(`${slot.voice}:${slot.staff}`).reduce((total, note) => total + note.durationUnits / note.divisions, 0);
    const odd = new ScoreEditor(sampleXML);
    odd.changeMeter(0, 6, 8);
    odd.insertMeasure(1);
    const oddSlot = odd.restSlots(1)[0];
    odd.insertNote(1, oddSlot, 0, 72, 0.5);
    const oddScore = parseScore(odd.serialize());
    const edges = new ScoreEditor(sampleXML);
    edges.insertMeasure(0);
    edges.insertMeasure(edges.measureStarts.length);
    const edgeScore = parseScore(edges.serialize());
    const fine = new ScoreEditor(sampleXML);
    fine.insertMeasure(1);
    const fineSlot = fine.restSlots(1)[0];
    fine.insertNote(1, fineSlot, 0, 72, 0.1875);
    const fineStart = fine.restPositions(1, fineSlot, 0.125).includes(0.1875);
    fine.insertNote(1, fineSlot, 0.1875, 74, 0.125);
    const fineIssues = parseScore(fine.serialize()).measureIssues;
    const polyXML = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>16</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure></part></score-partwise>`;
    const poly = new ScoreEditor(polyXML);
    poly.insertMeasure(1);
    const polyMeasure = poly.parts[0].getElementsByTagName('measure')[1];
    return {
      emptyMeasures: empty.measures,
      emptyIssues: empty.measureIssues,
      editedIssues: edited.measureIssues,
      insertedPitches: edited.tracks[0].notes.filter(note => note.measure === 1).map(note => note.midi),
      sum, invalidRejected, rollback, afterUndo, afterRedo, resizedIssues, resizedSum,
      oddMeter: odd.meterAt(1), oddIssues: oddScore.measureIssues,
      edgeMeasures: edgeScore.measures, edgeIssues: edgeScore.measureIssues, edgeTempo: edgeScore.tempoMap[0].tempo,
      fineStart, fineIssues,
      polyRests: polyMeasure.getElementsByTagName('rest').length,
      polyBackup: Number(polyMeasure.getElementsByTagName('backup')[0]?.getElementsByTagName('duration')[0]?.textContent) / poly.divisionsAt(0, 1),
      polyIssues: parseScore(poly.serialize()).measureIssues,
    };
  });
  assert.equal(core.emptyMeasures, 5);
  assert.deepEqual(core.emptyIssues, []);
  assert.deepEqual(core.editedIssues, []);
  assert.deepEqual(core.insertedPitches, [72, 74]);
  assert.equal(core.sum, 4);
  assert.equal(core.invalidRejected, true);
  assert.equal(core.rollback, true);
  assert.equal(core.afterUndo, 1);
  assert.equal(core.afterRedo, 2);
  assert.deepEqual(core.resizedIssues, []);
  assert.equal(core.resizedSum, 3);
  assert.deepEqual(core.oddMeter, { beats: 6, beatType: 8 });
  assert.deepEqual(core.oddIssues, []);
  assert.equal(core.edgeMeasures, 6);
  assert.deepEqual(core.edgeIssues, []);
  assert.equal(core.edgeTempo, 86);
  assert.equal(core.fineStart, true);
  assert.deepEqual(core.fineIssues, []);
  assert.equal(core.polyRests, 2);
  assert.equal(core.polyBackup, 4);
  assert.deepEqual(core.polyIssues, []);

  await page.locator('#sample-button').click();
  await page.locator('#score-view svg').first().waitFor();
  await page.locator('#edit-tab').click();
  await page.locator('#insert-after').click();
  await page.waitForFunction(() => document.querySelector('#score-meta')?.textContent?.includes('5 小节'));
  assert.equal(await page.locator('#insert-measure').inputValue(), '1');
  await page.locator('#mode-notes').click();
  await page.locator('#note-insert-tool').click();
  assert.equal(await page.locator('#insert-note').isEnabled(), true);
  await page.locator('#insert-note').click();
  await page.waitForFunction(() => document.querySelector('#editor-message')?.textContent?.includes('已更新'));
  assert.match(await page.locator('#editor-selection').textContent(), /第 2 小节/);
  assert.equal(await page.locator('#score-view .render-error').count(), 0);
  assert.deepEqual(errors, []);
  console.log(core);
} finally {
  await browser.close();
}
