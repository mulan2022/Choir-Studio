import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5187/');
  for (const [label, filename] of [['hybrid', 'exports/蒲公英-homr混合版.musicxml'], ['repaired', 'exports/蒲公英-homr补全延音实验版.musicxml'], ['audiveris', 'exports/蒲公英-自动识谱.mxl']]) {
    const bytes = await fs.readFile(filename);
    const result = await page.evaluate(async ({ name, data }) => {
      const { ChoirPlayer } = await import('/src/audio.js');
      const { parseScore, readScoreFile } = await import('/src/score.js');
      const xml = await readScoreFile(new File([new Uint8Array(data)], name));
      const score = parseScore(xml);
      const player = new ChoirPlayer(() => {}, () => {});
      player.setScore(score);
      const rows = score.tracks.map(track => {
        const performed = player.performanceNotes(track);
        const boundaries = score.measureStarts.slice(1);
        const gaps = boundaries.map((beat, i) => {
          const preceding = performed.filter(n => n.beat < beat && n.end <= beat + 0.01).at(-1);
          const following = performed.find(n => n.beat >= beat - 0.01);
          if (!preceding || !following) return null;
          const between = following.beat - preceding.end;
          return { measure: i + 2, gap: Math.round(between * 100) / 100, prior: preceding.midi, next: following.midi, samePitch: preceding.midi === following.midi, tied: preceding.segments.some(n => n.tieStart) };
        }).filter(Boolean);
        return { role: track.role, notes: track.notes.length, performed: performed.length, crossTies: performed.filter(n => n.segments.length > 1 && n.source.measure !== n.segments.at(-1).measure).length, tieStarts: track.notes.filter(n => n.tieStart).length, tieStops: track.notes.filter(n => n.tieStop).length, gapsOverQuarter: gaps.filter(g => g.gap > 0.25).length, worst: gaps.sort((a, b) => b.gap - a.gap).slice(0, 8), samePitchTouching: gaps.filter(g => g.samePitch && Math.abs(g.gap) < 0.001).length };
      });
      return { beats: score.totalBeats, measures: score.measures, issues: score.measureIssues.length, rows };
    }, { name: filename, data: [...bytes] });
    console.log(JSON.stringify({ label, beats: result.beats, issues: result.issues, voices: result.rows.filter(row => 'SATB'.includes(row.role) && row.notes > 100).map(({ role, crossTies, tieStarts, tieStops, gapsOverQuarter, samePitchTouching }) => ({ role, crossTies, tieStarts, tieStops, gapsOverQuarter, samePitchTouching })) }));
  }
} finally { await browser.close(); }
