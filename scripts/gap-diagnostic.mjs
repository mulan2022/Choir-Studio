import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5187/');
  for (const [label, filename] of [
    ['repaired', 'exports/蒲公英-校正拍号与延音.musicxml'],
    ['audiveris', 'exports/蒲公英-自动识谱.mxl'],
  ]) {
    const bytes = await fs.readFile(filename);
    const result = await page.evaluate(async ({ name, data }) => {
      const { ChoirPlayer } = await import('/src/audio.js');
      const { parseScore, readScoreFile, beatToSeconds } = await import('/src/score.js');
      const score = parseScore(await readScoreFile(new File([new Uint8Array(data)], name)));
      const player = new ChoirPlayer(() => {}, () => {});
      player.setScore(score);
      const voices = score.tracks.filter(t => t.notes.length > 100);
      const intervals = voices.flatMap(t => player.performanceNotes(t).map(n => ({ start: n.beat, end: n.end, role: t.role, midi: n.midi })));
      intervals.sort((a,b) => a.start-b.start || a.end-b.end);
      const union = [];
      for (const x of intervals) {
        if (union.length && x.start <= union.at(-1).end + 0.001) union.at(-1).end = Math.max(union.at(-1).end, x.end);
        else union.push({ start:x.start, end:x.end });
      }
      const gaps = union.slice(1).map((x,i) => ({ start: union[i].end, end:x.start, beats:x.start-union[i].end })).filter(x => x.beats >= 0.75).map(x => ({ ...x, secs: beatToSeconds(score,x.end)-beatToSeconds(score,x.start), measure:score.measureStarts.findLastIndex(b=>b<=x.start)+1 }));
      const barlines = score.measureStarts.slice(1).map((beat,i) => ({ measure:i+2, beat, length:beat-score.measureStarts[i], sustained:voices.map(t=>({role:t.role, notes:player.performanceNotes(t).filter(n=>n.beat<beat-.001 && n.end>=beat-.001).map(n=>n.midi)})).filter(x=>x.notes.length), adjacent:voices.map(t=>{const ns=player.performanceNotes(t); const before=ns.filter(n=>n.beat<beat-.001 && n.end>=beat-.05).map(n=>({midi:n.midi,end:n.end})); const after=ns.filter(n=>n.beat>=beat-.001 && n.beat<beat+.05).map(n=>({midi:n.midi,beat:n.beat})); return {role:t.role,before,after};}).filter(x=>x.before.length||x.after.length) }));
      return { totalBeats:score.totalBeats, gaps:gaps.sort((a,b)=>b.secs-a.secs).slice(0,30), trackNotes:voices.map(t=>({role:t.role, count:t.notes.length}))};
    }, { name: filename, data: [...bytes] });
    console.log(label, JSON.stringify(result));
  }
} finally { await browser.close(); }
