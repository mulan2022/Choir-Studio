import { editorPanel, editorToolbar } from './editor-panel.js';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { ChoirPlayer } from './audio.js';
import { beatToSeconds, parseScore, readScoreFile } from './score.js';
import { ScoreEditor, RHYTHM_OPTIONS } from './editor.js';
import { diatonicOf, stepOfDiatonic, keyAlter, midiOf, pitchName as noteName, isPlayableMidi } from './pitch-map.js';
import { noteGlyph } from './note-glyph.js';
import { sampleXML } from './sample.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">♫</span><span>和声间<small>CHOIR STUDIO</small></span></div>
    <span class="top-tag"><span class="live-dot"></span> 本地练习原型</span>
  </header>
  <main class="workspace">
    <aside class="sidebar">
      <div class="side-heading"><span class="eyebrow">REHEARSAL ROOM</span><h1>听见自己的<br><em>声部。</em></h1><p>上传一份乐谱，拆开每条旋律，再把它们合在一起。</p></div>
      <div class="upload" id="dropzone" role="button" tabindex="0" aria-label="上传 MusicXML 乐谱">
        <div class="upload-icon">↥</div><strong>放入你的乐谱</strong><span>点击选择，或拖放到这里</span><small>MusicXML / MXL / PDF / 图片</small>
      </div>
      <input id="file-input" type="file" accept=".musicxml,.mxl,.xml,.pdf,.png,.jpg,.jpeg,.tif,.tiff" hidden />
      <div class="page-limit"><label for="max-pages">最多识别</label><input id="max-pages" type="number" min="1" max="999" placeholder="全部" aria-label="最多识别页数"><span>页</span></div>
      <button class="sample-button" id="sample-button"><span>✦</span> 先听四声部示例 <span class="button-arrow">↗</span></button>
      <div class="side-note"><span class="note-icon">i</span><p>人声版按谱面音高唱“doo”，叉形符头也用同一音色；当前不朗读歌词。PDF／图片由本机 Audiveris 识别，请对照原谱校对。</p></div>
      <div class="sidebar-bottom">谱面在此设备上处理 · 无需上传到服务器</div>
    </aside>

    <section class="content">
      <div class="content-header"><div><span class="eyebrow dark">YOUR SCORE</span><h2 id="score-title">开始一次合唱练习</h2><p id="score-subtitle">选择 MusicXML 乐谱，或打开下面的示例。</p></div><div class="score-meta" id="score-meta">尚未载入乐谱</div></div>
      <div class="import-progress" id="import-progress" role="status" aria-live="polite" hidden>
        <div class="import-top"><span class="import-spinner" aria-hidden="true"></span><div><strong id="import-stage">正在读取乐谱</strong><small id="import-file"></small></div><span id="import-elapsed">0 秒</span></div>
        <progress id="import-bar" max="100"></progress>
        <p id="import-detail">正在准备…</p>
      </div>
      <div class="empty-state" id="empty-state"><div class="staff-illustration"><span>♩</span><span>♪</span><span>♬</span></div><h3>让每一条旋律都清晰可闻</h3><p>从左侧放入乐谱，就能切换声部、速度与音色。</p><button id="empty-sample">打开示例乐谱 <span>→</span></button></div>
      <div class="loaded" id="loaded" hidden>
        <div class="view-tabs" role="tablist" aria-label="乐谱视图"><button id="practice-tab" class="active" role="tab" aria-selected="true">练习播放</button><button id="edit-tab" role="tab" aria-selected="false">编辑乐谱</button></div>
        ${editorToolbar}
        <div class="section-row"><div><span class="section-index">01</span><h3 id="score-section-title">乐谱预览</h3></div><div class="score-follow-controls"><span id="score-page-status">第 1 页</span><button id="follow-score" class="active" type="button" aria-pressed="true">● 跟随播放</button></div></div>
        <div class="score-edit-layout"><div class="score-paper" id="score-paper"><div id="score-view"></div></div>
          ${editorPanel}</div>
        <div class="section-row timeline-heading"><div><span class="section-index">02</span><h3>实际发声轨道</h3></div><span class="hint">点击轨道定位播放 · 彩色块代表实际唱出的音</span></div>
        <div class="timeline-panel">
          <div class="timeline-info"><span>实际播放音符 · 延音线已连接</span><span class="wave-caption">实时总波形 <canvas id="live-wave" width="150" height="34" aria-label="实时音频波形"></canvas></span></div>
          <div class="timeline-scroll" id="timeline-scroll"><div class="timeline-content" id="timeline-content"></div></div>
          <p class="timeline-help">每一行对应一个声部；延音线连接的音符显示为连续长条，跨小节持续发声。竖线跟随播放，点击轨道可跳到该位置。</p>
        </div>
        <div class="section-row mixer-heading"><div><span class="section-index">03</span><h3>声部混音台</h3></div><span class="hint">点亮想听的声部，独奏可快速定位旋律</span></div>
        <div class="mix-toolbar"><div class="mode-switch" role="group" aria-label="音色模式"><button data-mode="voice" class="active">◉ 人声版</button><button data-mode="piano">♫ 纯音乐版</button></div><div class="mix-actions"><button id="all-tracks">全部开启</button><button id="none-tracks">全部静音</button><label class="export-format" for="export-format">格式 <select id="export-format" aria-label="导出音频格式"><option value="mp3">MP3 · 小文件</option><option value="wav">WAV · 高音质</option></select></label><button id="export-audio" title="按当前声部、音量、音色和速度导出音频">导出音频</button></div></div>
        <div class="tracks" id="tracks"></div>
        <div class="expression-note"><span>✳</span><div><strong>当前为音高校对播放</strong><p>按识别出的音高和节奏播放，支持延音线连接。跳音、颤音、滑音及力度变化暂未启用；识谱结果仍需对照原谱校对。</p></div></div>
      </div>
    </section>
  </main>
  <footer class="transport" id="transport" hidden><div class="transport-title"><span class="disc">♫</span><div><strong id="playing-title">和声练习</strong><small id="playing-mode">人声版 · 四声部</small></div></div><div class="transport-center"><div class="play-controls"><button id="back-to-start" aria-label="回到开头">↶</button><button id="play-button" class="play-button" aria-label="播放">▶</button><span id="time-now">0:00</span><input id="seek" type="range" min="0" max="1000" value="0" aria-label="播放进度"/><span id="time-total">0:00</span></div><div class="status"><span id="status">准备播放</span><progress id="soundfont-progress" max="100" hidden></progress></div></div><div class="tempo-control"><span>速度</span><input id="tempo" type="range" min="50" max="150" step="5" value="100" aria-label="播放速度"/><strong id="tempo-value">100%</strong></div></footer>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const $ = id => document.getElementById(id);
const escapeHTML = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const fileTitle = name => name.match(/《[^》]+》/)?.[0] || name.replace(/\.[^.]+$/, '');
const pitchName = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
const BEAT_WIDTH = 50;
const TRACK_LABEL_WIDTH = 128;
const SCORE_UNIT = 10; // OSMD 的一个单位在谱面 SVG 里的像素数
let score = null;
let osmd = null;
let followScore = true;
let scoreCursorAvailable = true;
let lastCursorPosition = '';
let timelineBlocks = [];
let timelineActive = new Set();
let timelineNextIndex = 0;
let timelineLastBeat = -Infinity;
let toastTimer;
let importTimer;
let editor = null;
let editorMode = false;
let editScope = 'measures';
let noteTool = 'select';
let selectedMeasures = [];
let measureAnchor = null;
let pickingScorePitch = false;
let pitchOctaveShift = 0;
let selectedIds = [];
let selectionAnchor = null;
let selectedMeasure = null;
let editorBusy = false;
let graphicById = new Map();
let graphicStaffLine = new Map();
let staffLineNotes = new Map();
let staffLineMaps = new Map();
let pendingPitch = null;
const player = new ChoirPlayer((current, total) => {
  $('time-now').textContent = formatTime(current);
  $('time-total').textContent = formatTime(total);
  $('seek').value = total ? Math.round(current / total * 1000) : 0;
  $('play-button').textContent = player.playing || player.starting ? 'Ⅱ' : '▶';
  $('play-button').setAttribute('aria-label', player.playing || player.starting ? '暂停' : '播放');
  updateTimeline(current);
  syncScoreCursor(current);
  drawWave();
}, message => { $('status').textContent = message; }, progress => {
  const bar = $('soundfont-progress');
  if (!bar) return;
  if (progress.done) { bar.hidden = true; return; }
  if (progress.cached) { $('status').textContent = '音色已在本机缓存，直接开始'; return; }
  const megabytes = progress.loaded / 1048576;
  bar.hidden = false;
  if (!progress.total) {
    bar.removeAttribute('value');
    $('status').textContent = `正在下载合唱音色 ${megabytes.toFixed(1)} MB`;
    return;
  }
  const percent = Math.min(100, Math.round(progress.loaded / progress.total * 100));
  bar.value = percent;
  $('status').textContent = `正在下载合唱音色 ${percent}%（${megabytes.toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB）`;
});

function drawWave() {
  const canvas = $('live-wave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#5a9d85';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (player.playing && player.analyser) {
    const data = new Uint8Array(player.analyser.fftSize);
    player.analyser.getByteTimeDomainData(data);
    for (let x = 0; x < width; x++) {
      const y = data[Math.floor(x / width * data.length)] / 255 * height;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  } else { ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); }
  ctx.stroke();
}

function updateTimeline(seconds) {
  if (!score || !$('timeline-playhead')) return;
  const beat = player.secondsToBeatSafe(seconds);
  $('timeline-playhead').style.left = `${TRACK_LABEL_WIDTH + beat * BEAT_WIDTH}px`;
  if (!player.playing || beat < timelineLastBeat - 0.001) {
    for (const block of timelineActive) block.element.classList.remove('active');
    timelineActive.clear();
    timelineNextIndex = 0;
  }
  if (!player.playing) { timelineLastBeat = -Infinity; return; }
  while (timelineNextIndex < timelineBlocks.length && timelineBlocks[timelineNextIndex].beat <= beat) {
    const block = timelineBlocks[timelineNextIndex++];
    if (block.end > beat) {
      block.element.classList.add('active');
      timelineActive.add(block);
    }
  }
  for (const block of timelineActive) {
    if (block.end <= beat) {
      block.element.classList.remove('active');
      timelineActive.delete(block);
    }
  }
  timelineLastBeat = beat;
}

function cursorPosition() {
  const iterator = osmd?.cursor?.Iterator;
  if (!iterator || !score) return null;
  const measure = Math.max(0, iterator.CurrentMeasureIndex || 0);
  const local = Number(iterator.CurrentRelativeInMeasureTimestamp?.RealValue || 0) * 4;
  return {
    measure,
    local,
    beat: (score.measureStarts[measure] ?? score.totalBeats) + local,
  };
}

function updateScorePageStatus() {
  if (!osmd?.cursor) return;
  const current = Math.max(1, Number(osmd.cursor.currentPageNumber) || 1);
  const total = Math.max(current, osmd.GraphicSheet?.MusicPages?.length || 1);
  $('score-page-status').textContent = `第 ${current} / ${total} 页`;
}

function revealScoreCursor(behavior = 'smooth') {
  if (!followScore || !osmd?.cursor?.cursorElement) return;
  const paper = $('score-paper');
  const marker = osmd.cursor.cursorElement;
  const paperRect = paper.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  if (!markerRect.width || !markerRect.height) return;

  const verticalMargin = Math.min(110, paper.clientHeight * 0.22);
  const horizontalMargin = Math.min(90, paper.clientWidth * 0.16);
  const outsideY = markerRect.top < paperRect.top + verticalMargin || markerRect.bottom > paperRect.bottom - verticalMargin;
  const outsideX = markerRect.left < paperRect.left + horizontalMargin || markerRect.right > paperRect.right - horizontalMargin;
  if (!outsideX && !outsideY) return;

  paper.scrollTo({
    top: outsideY ? Math.max(0, paper.scrollTop + markerRect.top - paperRect.top - paper.clientHeight * 0.32) : paper.scrollTop,
    left: outsideX ? Math.max(0, paper.scrollLeft + markerRect.left - paperRect.left - paper.clientWidth * 0.28) : paper.scrollLeft,
    behavior,
  });
}

function syncScoreCursor(seconds, reveal = true) {
  if (!score || !osmd?.cursor || !scoreCursorAvailable || !Number.isFinite(seconds)) return;
  try {
  const cursor = osmd.cursor;
  const target = player.secondsToBeatSafe(seconds);
  let position = cursorPosition();
  if (!position) return;

  let moves = 0;
  while (position.beat > target + 0.002 && moves++ < 5000) {
    cursor.previous();
    const previous = cursorPosition();
    if (!previous || (previous.measure === position.measure && Math.abs(previous.local - position.local) < 0.0001)) break;
    position = previous;
  }
  while (position.beat < target - 0.002 && moves++ < 5000 && !cursor.Iterator.EndReached) {
    const before = position;
    cursor.next();
    const next = cursorPosition();
    if (!next || cursor.Iterator.EndReached) {
      cursor.previous();
      position = cursorPosition() || before;
      break;
    }
    if (next.beat > target + 0.002) {
      cursor.previous();
      position = cursorPosition() || before;
      break;
    }
    if (next.measure === before.measure && Math.abs(next.local - before.local) < 0.0001) break;
    position = next;
  }

  const key = `${position.measure}:${position.local.toFixed(4)}`;
  if (key === lastCursorPosition) return;
  lastCursorPosition = key;
  updateScorePageStatus();
  if (reveal) revealScoreCursor(player.playing ? 'smooth' : 'auto');
  } catch (error) {
    // Some OMR exports leave OSMD's iterator without a StaffEntry. Keep the
    // score and audio usable, and avoid throwing on every playback tick.
    scoreCursorAvailable = false;
    console.warn('自动跟谱已暂停：', error);
    $('status').textContent = '此乐谱暂无法自动跟谱，仍可正常播放';
  }
}

function renderTimeline() {
  const width = TRACK_LABEL_WIDTH + score.totalBeats * BEAT_WIDTH;
  const ruler = score.measureStarts.map((beat, i) => `<span class="timeline-measure" style="left:${TRACK_LABEL_WIDTH + beat * BEAT_WIDTH}px">第 ${i + 1} 小节</span>`).join('');
  const lanes = score.tracks.map(track => {
    const performed = player.performanceNotes(track);
    const pitches = performed.map(note => note.midi);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    const range = Math.max(1, maxPitch - minPitch);
    const blocks = performed.map(note => {
      const top = 33 - (note.midi - minPitch) / range * 24;
      const label = `${pitchName(note.midi)} · ${note.ornament === 'breath' ? '叉形符头 · 按音高唱 doo' : note.ornament === 'trill' ? '颤音展开' : note.ornament === 'staccato' ? '跳音' : note.ornament === 'gliss' ? '滑音起点' : '谱面音符'} · ${note.beat.toFixed(2)} 拍`;
      return `<span class="timeline-note ${note.ornament || ''}" data-beat="${note.beat}" data-end="${note.end}" title="${label}" aria-label="${label}" style="left:${TRACK_LABEL_WIDTH + note.beat * BEAT_WIDTH}px;width:${Math.max(3, (note.end - note.beat) * BEAT_WIDTH - 2)}px;top:${top}px;--track-color:${track.color}"></span>`;
    }).join('');
    return `<div class="timeline-lane ${track.enabled ? '' : 'muted'}" data-track-id="${escapeHTML(track.id)}"><span class="timeline-label" style="--track-color:${track.color}"><b>${track.role}</b><span>${escapeHTML(track.title)}</span></span>${blocks}</div>`;
  }).join('');
  $('timeline-content').style.width = `${width}px`;
  $('timeline-content').innerHTML = `<div class="timeline-ruler">${ruler}</div>${lanes}<div id="timeline-playhead" class="timeline-playhead"></div>`;
  timelineBlocks = Array.from($('timeline-content').querySelectorAll('.timeline-note'), element => ({ element, beat: Number(element.dataset.beat), end: Number(element.dataset.end) })).sort((a, b) => a.beat - b.beat);
  timelineActive = new Set();
  timelineNextIndex = 0;
  timelineLastBeat = -Infinity;
  updateTimeline(player.currentSeconds());
  drawWave();
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
}

function importProgress(stage, detail = '', percent = null) {
  const panel = $('import-progress');
  panel.hidden = false;
  panel.classList.remove('failed');
  $('import-stage').textContent = stage;
  $('import-detail').textContent = detail;
  if (percent === null) $('import-bar').removeAttribute('value');
  else $('import-bar').value = Math.max(0, Math.min(100, percent));
  $('status').textContent = stage;
}

function beginImport(file) {
  clearInterval(importTimer);
  const start = Date.now();
  $('import-file').textContent = file.name;
  $('import-elapsed').textContent = '0 秒';
  importTimer = setInterval(() => { $('import-elapsed').textContent = `${Math.floor((Date.now() - start) / 1000)} 秒`; }, 1000);
  importProgress('正在读取乐谱', `文件大小 ${(file.size / 1024 / 1024).toFixed(1)} MB`);
}

function finishImport(error = null) {
  clearInterval(importTimer);
  if (error) {
    importProgress('打开失败', error.message || '无法读取乐谱。');
    $('import-progress').classList.add('failed');
    $('import-bar').removeAttribute('value');
    $('status').textContent = '无法读取乐谱';
  } else $('import-progress').hidden = true;
}

const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

// A static deploy (GitHub Pages) has no OMR backend: PDF and image uploads have
// to fail with an explanation instead of a generic network error. The Pages
// build sets VITE_STATIC=1 so it can skip the probe (and its 404 in devtools).
const staticBuild = import.meta.env.VITE_STATIC === '1';
let omrStatus = null; // { available, omr }
async function probeOmr() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return { available: false, omr: false };
    const data = await response.json().catch(() => ({}));
    return { available: true, omr: data.omr !== false };
  } catch { return { available: false, omr: false }; }
  finally { clearTimeout(timer); }
}
const staticOmrMessage = '当前是线上静态版：PDF／图片识谱需要本机识谱服务（npm run dev）。线上请上传 MusicXML。';

// Say up front what this build can do, so nobody drops a PDF and waits.
function showStandaloneNotice(reason) {
  const tag = document.querySelector('.top-tag');
  if (tag) tag.innerHTML = '<span class="live-dot"></span> 线上试听版';
  const upload = $('dropzone')?.querySelector('small');
  if (upload) upload.textContent = 'MusicXML / MXL（识谱仅本地版）';
  const note = document.querySelector('.side-note p');
  if (note) note.innerHTML = `${reason}，PDF／图片暂时无法识别。要识谱请在本机运行 <strong>npm run dev</strong>；线上可直接上传 MusicXML，或用下面的示例谱试听。`;
}

function maxPages() {
  const value = Number($('max-pages')?.value);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 0;
}

function submitRecognition(file, ext) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const limit = maxPages();
    request.open('POST', `/api/recognize-jobs?ext=${encodeURIComponent(ext)}${limit ? `&pages=${limit}` : ''}`);
    request.timeout = 600000;
    request.upload.onprogress = event => {
      if (event.lengthComputable) importProgress('正在传送到本机识谱服务', `已传送 ${(event.loaded / 1024 / 1024).toFixed(1)} / ${(event.total / 1024 / 1024).toFixed(1)} MB`, event.loaded / event.total * 100);
    };
    request.onload = () => {
      let data = {};
      try { data = JSON.parse(request.responseText); } catch { /* use generic error below */ }
      if (request.status === 202 && data.id) resolve(data.id);
      else reject(new Error(data.error || `识谱服务返回 ${request.status || '未知'} 错误。`));
    };
    request.onerror = () => reject(new Error('无法连接本机识谱服务。'));
    request.ontimeout = () => reject(new Error('文件传送超时，请重试。'));
    request.send(file);
  });
}

async function waitForRecognition(id) {
  while (true) {
    const response = await fetch(`/api/recognize-jobs/${id}`, { cache: 'no-store' });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '无法查询识谱进度。');
    const selected = Math.max(1, job.lastPage - job.firstPage + 1);
    const detail = job.totalPages ? `PDF 共 ${job.totalPages} 页 · 五线谱第 ${job.firstPage}–${job.lastPage} 页 · 已完成 ${job.pagesDone} / ${selected} 页` : '正在检查 PDF 页数与五线谱位置';
    importProgress(job.stage, detail, job.page ? 5 + job.pagesDone / selected * 88 : null);
    if (job.state === 'failed') throw new Error(job.error || '识谱失败。');
    if (job.state === 'done') {
      importProgress('正在读取识别结果', detail, 94);
      const result = await fetch(`/api/recognize-jobs/${id}/result`);
      if (!result.ok) throw new Error('识谱结果下载失败。');
      const ext = result.headers.get('X-Score-Extension') || 'mxl';
      return { xml: await readScoreFile(new File([await result.arrayBuffer()], `recognized.${ext}`)), cached: !!job.cached };
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

function trackHTML(track, i) {
  return `<article class="track ${track.enabled ? '' : 'muted'}" data-index="${i}" style="--track-color:${track.color}"><div class="track-id"><span class="track-letter">${track.role}</span><div><strong>${escapeHTML(track.label)}</strong><small>${track.title} · ${track.notes.length} 个音符</small></div></div><div class="track-controls"><label class="volume-label" aria-label="${escapeHTML(track.label)}音量">音量 <input class="volume" type="range" min="0" max="100" value="${Math.round(track.volume * 100)}"/></label><button class="solo" title="只听这个声部">独奏</button><button class="toggle ${track.enabled ? 'on' : ''}" aria-label="${track.enabled ? '关闭' : '开启'}${escapeHTML(track.label)}">${track.enabled ? '✓' : '＋'}</button></div></article>`;
}

function renderTracks() {
  $('tracks').innerHTML = score.tracks.map(trackHTML).join('');
  const active = score.tracks.filter(t => t.enabled).length;
  $('playing-mode').textContent = `${player.mode === 'voice' ? '人声版' : '纯音乐版'} · ${active} 个声部`;
  if (score) document.querySelectorAll('.timeline-lane').forEach((lane, i) => lane.classList.toggle('muted', !score.tracks[i]?.enabled));
}

async function loadXML(xml, onStage = null, fallbackTitle = '', preserveEditor = false) {
  onStage?.('正在解析 MusicXML', '识别声部、节奏和表情记号', 96);
  if (onStage) await nextPaint();
  const parsed = parseScore(xml);
  if (!preserveEditor) {
    editor = new ScoreEditor(xml);
    selectedIds = [];
    selectionAnchor = null;
    selectedMeasure = null;
    selectedMeasures = [];
    measureAnchor = null;
    pickingScorePitch = false;
    pitchOctaveShift = 0;
    $('meter-start').value = '';
    $('meter-end').value = '';
    pendingPitch = null;
  }
  if (parsed.title === '未命名乐谱' && fallbackTitle) parsed.title = fallbackTitle;
  // setScore emits a progress update. It must not drive the previous score's
  // OSMD cursor with the new score's measure positions.
  osmd = null;
  scoreCursorAvailable = true;
  player.setScore(parsed);
  score = parsed;
  $('score-title').textContent = score.title;
  const issueCount = score.measureIssues.length;
  $('score-subtitle').textContent = issueCount
    ? `自动识谱发现 ${issueCount} 个小节的拍号与音符时值不一致；请对照原谱校对后再用于排练。`
    : '选择声部、音色和速度，开始你的排练。';
  $('score-meta').textContent = `${score.tracks.length} 个声部 · ${score.measures} 小节 · ${formatTime(player.duration)}${score.breathNotes ? ` · ${score.breathNotes} 个叉形符头` : ''}${issueCount ? ` · ${issueCount} 个待校对小节` : ''}`;
  $('playing-title').textContent = score.title;
  $('empty-state').hidden = true;
  $('loaded').hidden = false;
  $('transport').hidden = false;
  onStage?.('正在生成声部轨道', `${score.tracks.length} 个声部 · ${score.measures} 小节`, 97);
  if (onStage) await nextPaint();
  renderTracks();
  renderTimeline();
  $('score-view').innerHTML = '';
  osmd = new OpenSheetMusicDisplay('score-view', {
    autoResize: false,
    drawTitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawMeasureNumbers: false,
    drawingParameters: 'compacttight',
    backend: 'svg',
    pageFormat: 'A4_P',
    followCursor: false,
    cursorsOptions: [{ type: 0, color: '#4fb889', alpha: 0.38, follow: true }],
  });
  try {
    // Audiveris can emit ending brackets without any repeat barline. OSMD's
    // repetition parser logs an exception for those orphaned display marks.
    let displayXML = xml;
    if (xml.includes('<ending') && !xml.includes('<repeat')) {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      for (const ending of Array.from(document.getElementsByTagName('ending'))) ending.remove();
      displayXML = new XMLSerializer().serializeToString(document);
    }
    await osmd.load(displayXML);
    onStage?.('正在绘制五线谱', `${score.measures} 小节`, 99);
    if (onStage) await nextPaint();
    osmd.render();
    indexGraphicNotes();
    drawMeasureNumbers();
    osmd.cursor.reset();
    osmd.cursor.show();
    if (editorMode) osmd.cursor.hide();
  renderIssueChips();
  setTimeout(markIssueMeasures, 0);
    lastCursorPosition = '';
    syncScoreCursor(player.currentSeconds(), false);
    updateScorePageStatus();
    $('score-paper').scrollTo({ top: 0, left: 0, behavior: 'auto' });
    renderEditorSelection();
  }
  catch (error) { $('score-view').innerHTML = `<div class="render-error">乐谱可播放，但谱面显示失败：${escapeHTML(error.message)}</div>`; }
  $('status').textContent = !scoreCursorAvailable ? '此乐谱暂无法自动跟谱，仍可正常播放' : issueCount
    ? `识谱待校对 · 拍号或时值冲突：${score.measureIssues.slice(0, 8).join('、')}${issueCount > 8 ? '…' : ''}`
    : '乐谱已就绪 · 点击播放以载入音色';
  if (score.lyrics && !preserveEditor) toast(`已识别 ${score.lyrics} 个歌词音节；人声示例以“doo”演唱。`);
}

function indexGraphicNotes() {
  graphicById = new Map();
  graphicStaffLine = new Map();
  staffLineNotes = new Map();
  staffLineMaps = new Map();
  for (const [pageIndex, page] of (osmd?.GraphicSheet?.MusicPages || []).entries()) {
    const svg = $('score-view').querySelectorAll('svg')[pageIndex];
    if (!svg) continue;
    for (const system of page.MusicSystems || []) for (const line of system.StaffLines || []) {
      const info = { points: [], left: Infinity, right: -Infinity, svg };
      for (const measure of line.Measures || []) {
        const box = measure.PositionAndShape;
        if (box?.AbsolutePosition) {
          info.left = Math.min(info.left, box.AbsolutePosition.x + box.BorderLeft);
          info.right = Math.max(info.right, box.AbsolutePosition.x + box.BorderRight);
        }
        for (const entry of measure.staffEntries || []) for (const voice of entry.graphicalVoiceEntries || []) for (const note of voice.notes || []) {
          const record = editor?.findFromSource(note.sourceNote);
          if (!record) continue;
          if (!graphicById.has(record.id)) graphicById.set(record.id, { note, svg });
          const position = note.PositionAndShape?.AbsolutePosition;
          if (!record.pitched || !position || !Number.isFinite(position.y)) continue;
          if (!graphicStaffLine.has(record.id)) graphicStaffLine.set(record.id, line);
          const diatonic = diatonicOf(record.step, record.octave);
          // 同一列的多个声部会指向同一个音符记录，按位置去重，避免污染音高映射。
          if (!info.points.some(point => Math.abs(point.y - position.y) < 0.01 && point.diatonic === diatonic)) info.points.push({ y: position.y, x: position.x, diatonic });
        }
      }
      if (info.points.length) staffLineNotes.set(line, info);
    }
  }
}

// 一个音级 = 半个线距；OSMD 里线距是 1 个单位（StaffHeight = 4）。
const DEFAULT_STEP_DISTANCE = 0.5;

/** 用谱表上真实画出来的音符拟合「y 坐标 ↔ 音级」的线性关系，比按谱号硬算更稳。 */
function staffLineMap(line) {
  if (staffLineMaps.has(line)) return staffLineMaps.get(line);
  const info = staffLineNotes.get(line);
  let map = null;
  if (info?.points.length) {
    const points = info.points;
    let sumDiatonic = 0, sumY = 0;
    for (const point of points) { sumDiatonic += point.diatonic; sumY += point.y; }
    const meanDiatonic = sumDiatonic / points.length;
    const meanY = sumY / points.length;
    let slope = 0, spread = 0;
    for (const point of points) {
      const delta = point.diatonic - meanDiatonic;
      slope += delta * (point.y - meanY);
      spread += delta * delta;
    }
    let stepDistance = DEFAULT_STEP_DISTANCE;
    if (spread > 0.5 && slope < 0) {
      const candidate = -slope / spread;
      if (candidate > DEFAULT_STEP_DISTANCE * 0.4 && candidate < DEFAULT_STEP_DISTANCE * 2.4) stepDistance = candidate;
    }
    map = {
      stepDistance,
      meanY,
      meanDiatonic,
      toY: diatonic => meanY + (meanDiatonic - diatonic) * stepDistance,
      toDiatonic: y => Math.round(meanDiatonic + (meanY - y) / stepDistance),
    };
  }
  staffLineMaps.set(line, map);
  return map;
}

/** 找到点击位置所在的那条谱表（同一系统里 4 个声部各有一条）。 */
function pitchLineHit(page, point) {
  let best = null;
  for (const system of page.MusicSystems || []) for (const line of system.StaffLines || []) {
    const info = staffLineNotes.get(line);
    if (!info) continue;
    if (point.x < info.left - 14 || point.x > info.right + 14) continue;
    const map = staffLineMap(line);
    const step = map?.stepDistance ?? DEFAULT_STEP_DISTANCE;
    let top = Infinity, bottom = -Infinity;
    for (const reference of info.points) { top = Math.min(top, reference.y); bottom = Math.max(bottom, reference.y); }
    top -= step * 9;
    bottom += step * 9;
    if (point.y < top || point.y > bottom) continue;
    const center = (top + bottom) / 2;
    const distance = Math.abs(point.y - center);
    if (best && distance >= best.distance) continue;
    const measure = (line.Measures || []).find(item => {
      const box = item.PositionAndShape;
      if (!box?.AbsolutePosition) return false;
      return point.x >= box.AbsolutePosition.x + box.BorderLeft - 2 && point.x <= box.AbsolutePosition.x + box.BorderRight + 2;
    });
    best = { line, measure: measure || null, distance };
  }
  return best;
}

function setEditorMode(active) {
  editorMode = active;
  if (active && selectedMeasure === null && score?.measures) { selectedMeasure = 0; selectedMeasures = [0]; measureAnchor = 0; }
  if (!active) pendingPitch = null;
  document.body.classList.toggle('editing-score', active);
  $('loaded').classList.toggle('editor-mode', active);
  $('practice-tab').classList.toggle('active', !active);
  $('edit-tab').classList.toggle('active', active);
  $('practice-tab').setAttribute('aria-selected', String(!active));
  $('edit-tab').setAttribute('aria-selected', String(active));
  $('score-section-title').textContent = active ? '编辑谱面' : '乐谱预览';
  if (active) player.pause();
  if (osmd?.cursor) active ? osmd.cursor.hide() : osmd.cursor.show();
  renderEditorSelection();
  renderIssueChips();
  if (active) setTimeout(markIssueMeasures, 0);
  else clearIssueMarks();
}

function setEditScope(scope) {
  if (editorBusy) return;
  editScope = scope;
  pendingPitch = null;
  pickingScorePitch = false;
  selectedIds = [];
  selectionAnchor = null;
  if (scope === 'measures' && !selectedMeasures.length && selectedMeasure !== null) selectedMeasures = [selectedMeasure];
  setRhythmMenu(false);
  renderEditorSelection();
}

function selectMeasure(index, event = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= editor.measureStarts.length) return;
  if (event.shiftKey && measureAnchor !== null) {
    const start = Math.min(measureAnchor, index), end = Math.max(measureAnchor, index);
    const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    selectedMeasures = event.ctrlKey || event.metaKey ? [...new Set([...selectedMeasures, ...range])] : range;
  } else if (event.ctrlKey || event.metaKey) {
    selectedMeasures = selectedMeasures.includes(index) ? selectedMeasures.filter(value => value !== index) : [...selectedMeasures, index];
    measureAnchor = index;
  } else { selectedMeasures = [index]; measureAnchor = index; }
  selectedMeasures.sort((a, b) => a - b);
  selectedMeasure = selectedMeasures.includes(index) ? index : selectedMeasures.at(-1) ?? null;
  selectedIds = [];
  selectionAnchor = null;
  pendingPitch = null;
  syncMeterRange();
  renderEditorSelection();
}

function measureSelectionLabel() {
  if (!selectedMeasures.length) return '点击谱面选择小节';
  const ranges = [];
  let start = selectedMeasures[0], end = start;
  for (const index of [...selectedMeasures.slice(1), Infinity]) {
    if (index === end + 1) { end = index; continue; }
    ranges.push(start === end ? String(start + 1) : `${start + 1}–${end + 1}`);
    start = end = index;
  }
  return `第 ${ranges.join('、')} 小节${selectedMeasures.length > 1 ? ` · 共 ${selectedMeasures.length} 小节` : ''}`;
}

function noteLabel(record) {
  const track = score?.tracks.find(item => item.partId === editor.partIds[record.partIndex] && item.id.endsWith(`:${record.staff}`));
  return `${track?.label || `声部 ${record.partIndex + 1}`} · 第 ${record.measureIndex + 1} 小节 · ${pitchName(record.midi)} · ${+(record.durationUnits / record.divisions).toFixed(4)} 拍`;
}

function svgNode(name, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function currentPitchName(record) {
  return record?.pitched ? noteName(record.step, record.alter, record.octave) : '';
}

/** 把「预览中的音级」结合当前调号，算出最终会写进谱面的音高。 */
function pendingPitchInfo(record) {
  if (!pendingPitch || !record?.pitched) return null;
  const fifths = editor.keyFifths(record.partIndex, record.measureIndex);
  const { step, octave } = stepOfDiatonic(pendingPitch.diatonic);
  const alter = keyAlter(step, fifths) + (pendingPitch.shift || 0);
  const midi = midiOf(step, alter, octave);
  return { diatonic: pendingPitch.diatonic, step, octave, alter, midi, name: noteName(step, alter, octave), playable: isPlayableMidi(midi) };
}

function clearEditorMarks() {
  document.querySelectorAll('.editor-selection-mark, .measure-selection-mark, .pitch-mark').forEach(node => node.remove());
}

// --- measures the OMR could not line up with the printed bar --------------
function clearIssueMarks() {
  document.querySelectorAll('.measure-issue-mark, .measure-issue-layer').forEach(node => node.remove());
}

// OSMD keeps every page in one scroll container and numbers the pages in model
// order, which matches the SVG order in #score-view. Each graphical measure
// carries its own page-relative position and size in OSMD units.
function eachGraphicMeasure(visit) {
  const pages = osmd?.GraphicSheet?.MusicPages || [];
  const svgs = [...document.querySelectorAll('#score-view svg')];
  pages.forEach((page, pageIndex) => {
    const svg = svgs[pageIndex] || null;
    for (const system of page.musicSystems || []) {
      for (const staffLine of system.staffLines || []) {
        for (const measure of staffLine.measures || []) {
          visit(measure, Number(measure.MeasureNumber), svg, pageIndex);
        }
      }
    }
  });
}

function measureBox(measure) {
  const shape = measure?.PositionAndShape;
  if (!shape?.absolutePosition || !shape?.size) return null;
  const x = shape.absolutePosition.x * SCORE_UNIT;
  const y = shape.absolutePosition.y * SCORE_UNIT;
  const width = shape.size.width * SCORE_UNIT;
  const height = Math.max(shape.size.height, 1) * SCORE_UNIT;
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0) return null;
  return { x, y, width, height };
}

function drawMeasureNumbers() {
  document.querySelectorAll('.measure-number-badge').forEach(node => node.remove());
  const seen = new Set();
  eachGraphicMeasure((measure, number, svg, pageIndex) => {
    const key = `${pageIndex}:${number}`;
    if (!svg || seen.has(key)) return;
    const box = measureBox(measure);
    if (!box) return;
    seen.add(key);
    const group = svgNode('g', { class: 'measure-number-badge', 'data-measure-index': number - 1, role: 'button', tabindex: '0', 'aria-label': `选择第 ${number} 小节`, transform: `translate(${box.x + 3},${Math.max(2, box.y - 24)})` });
    const rowStart = measure.ParentStaffLine?.Measures?.[0] === measure;
    const label = rowStart ? `第 ${number} 小节` : String(number);
    group.append(svgNode('rect', { x: 0, y: 0, width: (rowStart ? 45 : 16) + String(number).length * 7, height: 19, rx: 5 }));
    const text = svgNode('text', { x: 7, y: 13 });
    text.textContent = label;
    group.append(text);
    svg.append(group);
  });
}

function drawMeasureSelection() {
  if (!editorMode) { document.querySelectorAll('.measure-number-badge.selected').forEach(badge => badge.classList.remove('selected')); return; }
  const selected = new Set(editScope === 'measures' ? selectedMeasures : selectedMeasure === null ? [] : [selectedMeasure]);
  eachGraphicMeasure((measure, number, svg) => {
    if (!svg || !selected.has(number - 1)) return;
    const box = measureBox(measure);
    if (!box) return;
    svg.append(svgNode('rect', { class: `measure-selection-mark ${editScope === 'notes' ? 'note-context' : ''}`, 'data-measure-index': number - 1, x: box.x - 2, y: box.y - 3, width: box.width + 4, height: box.height + 6, rx: 5 }));
  });
  document.querySelectorAll('.measure-number-badge').forEach(badge => badge.classList.toggle('selected', selected.has(Number(badge.dataset.measureIndex))));
}

function markIssueMeasures() {
  clearIssueMarks();
  const numbers = new Set((score?.measureIssues || []).map(Number));
  if (!editorMode || !numbers.size || !osmd) return;
  const layers = new Map();
  eachGraphicMeasure((measure, number, svg) => {
    if (!numbers.has(number) || !svg) return;
    const box = measureBox(measure);
    if (!box) return;
    if (!layers.has(svg)) {
      const layer = svgNode('g', { class: 'measure-issue-layer' });
      svg.append(layer);
      layers.set(svg, layer);
    }
    const pad = 2;
    layers.get(svg).append(svgNode('rect', {
      class: 'measure-issue-mark',
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2,
      rx: 4,
    }));
  });
}

function renderIssueChips() {
  const box = $('editor-issues');
  const list = $('editor-issue-list');
  if (!box || !list) return;
  const numbers = score?.measureIssues || [];
  box.hidden = !editorMode || !numbers.length;
  $('editor-issue-count').textContent = `${numbers.length} 处`;
  list.innerHTML = numbers.slice(0, 60).map(number => `<button type="button" data-measure="${number}">${number}</button>`).join('');
  if (numbers.length > 60) list.insertAdjacentHTML('beforeend', `<span class="editor-issue-more">…共 ${numbers.length} 个</span>`);
}

function focusMeasure(number) {
  const paper = $('score-paper');
  if (!paper || !osmd) return;
  let target = null;
  let targetSvg = null;
  eachGraphicMeasure((measure, measureNumber, svg) => {
    if (target || measureNumber !== number || !svg) return;
    target = measureBox(measure);
    targetSvg = svg;
  });
  if (!target || !targetSvg) return;
  const paperRect = paper.getBoundingClientRect();
  const svgRect = targetSvg.getBoundingClientRect();
  const scale = svgRect.height / (targetSvg.viewBox.baseVal.height || 1);
  paper.scrollTo({
    top: Math.max(0, paper.scrollTop + svgRect.top - paperRect.top + target.y * scale - paper.clientHeight * 0.3),
    left: 0,
    behavior: 'smooth',
  });
  const marks = [...document.querySelectorAll('.measure-issue-mark')];
  const position = (score?.measureIssues || []).indexOf(number);
  if (marks[position]) {
    marks[position].classList.add('flash');
    setTimeout(() => marks[position]?.classList.remove('flash'), 1200);
  }
}


function drawEditorMarks(first, pending) {
  if (!editorMode || editScope !== 'notes' || noteTool !== 'select') return;
  for (const id of selectedIds) {
    const item = graphicById.get(id);
    if (!item) continue;
    const center = item.note.PositionAndShape.AbsolutePosition;
    item.svg.append(svgNode('circle', { class: 'editor-selection-mark', cx: center.x * SCORE_UNIT, cy: center.y * SCORE_UNIT, r: 12 }));
  }
  if (!editorMode || !first || editorBusy) return;
  const graphic = graphicById.get(first.id);
  if (!graphic) return;
  const center = graphic.note.PositionAndShape.AbsolutePosition;
  if (!pending) {
    const label = svgNode('text', { class: 'pitch-mark pitch-current-mark', x: center.x * SCORE_UNIT + 15, y: center.y * SCORE_UNIT - 13 });
    label.textContent = currentPitchName(first);
    graphic.svg.append(label);
    return;
  }
  const map = staffLineMap(graphicStaffLine.get(first.id));
  const stepDistance = map?.stepDistance ?? DEFAULT_STEP_DISTANCE;
  const targetY = center.y - (pending.diatonic - diatonicOf(first.step, first.octave)) * stepDistance;
  const x = center.x * SCORE_UNIT;
  const y = targetY * SCORE_UNIT;

  graphic.svg.append(svgNode('line', { class: 'pitch-mark pitch-guide', x1: x - 96, y1: y, x2: x + 96, y2: y }));
  graphic.svg.append(svgNode('ellipse', { class: 'pitch-mark pitch-ghost-halo', cx: x, cy: y, rx: 15, ry: 10.5 }));
  graphic.svg.append(svgNode('ellipse', { class: 'pitch-mark pitch-ghost', cx: x, cy: y, rx: 10.5, ry: 7 }));
  const label = svgNode('text', { class: 'pitch-mark pitch-ghost-label', x: x, y: y - 19, 'text-anchor': 'middle' });
  label.textContent = pending.name;
  graphic.svg.append(label);
}

function updatePitchPanel(first, pending) {
  const inserting = noteTool === 'insert';
  $('pitch-current').textContent = inserting ? '新音符' : currentPitchName(first) || '—';
  $('pitch-target').textContent = inserting ? pitchName(Number($('insert-pitch').value)) : pending ? pending.name : '—';
  $('pitch-target-slot').classList.toggle('ready', inserting || !!pending);
  const editable = editScope === 'notes' && (inserting || selectedIds.length === 1 && !!first?.pitched) && !editorBusy;
  $('pitch-flat').disabled = !editable;
  $('pitch-sharp').disabled = !editable;
  $('pitch-staff').setAttribute('aria-disabled', String(!editable));
  $('cancel-pitch').disabled = !pending || editorBusy;
  $('apply-pitch').hidden = inserting;
  $('cancel-pitch').hidden = inserting;
  $('apply-pitch').disabled = !pending || !pending.playable || editorBusy;
  $('apply-pitch').textContent = pending && !pending.playable ? '超出可用音域' : '确认音高';
  $('pick-score-pitch').hidden = inserting;
  $('pick-score-pitch').disabled = !editable;
  $('pick-score-pitch').classList.toggle('active', pickingScorePitch);
  $('pick-score-pitch').setAttribute('aria-pressed', String(pickingScorePitch));
  $('pick-score-pitch').textContent = pickingScorePitch ? '⌖ 请在原谱同一谱表上点选 · Esc 退出' : '⌖ 在原谱上点选音高';
  renderPitchStaff(first, pending);
}

function renderPitchStaff(first, pending) {
  const svg = $('pitch-staff');
  const inserting = noteTool === 'insert';
  const midi = inserting ? Number($('insert-pitch').value) : pending?.midi ?? first?.midi ?? 60;
  const reference = inserting ? midi : first?.midi ?? 60;
  const bass = reference < 60;
  const base = (bass ? diatonicOf('G', 2) : diatonicOf('E', 4)) + pitchOctaveShift * 7;
  const names = ['C','C','D','D','E','F','F','G','G','A','A','B'];
  const d = inserting ? diatonicOf(names[midi % 12], Math.floor(midi / 12) - 1) : pending?.diatonic ?? (first ? diatonicOf(first.step, first.octave) : diatonicOf('C', 4));
  const y = 98 - (d - base) * 6;
  svg.dataset.base = String(base);
  svg.setAttribute('aria-valuenow', String(midi));
  svg.setAttribute('aria-valuetext', inserting ? pitchName(midi) : pending?.name || currentPitchName(first) || '尚未选择音符');
  svg.innerHTML = `<rect width="280" height="142" rx="10" fill="transparent"/>${[50,62,74,86,98].map(line => `<line x1="18" y1="${line}" x2="264" y2="${line}" stroke="#b8cfc2"/>`).join('')}<text x="27" y="${bass ? 83 : 100}" class="picker-clef">${bass ? '𝄢' : '𝄞'}</text>`;
  if (y >= 8 && y <= 134 && (inserting || first)) {
    for (let line = 110; line <= y + 1; line += 12) svg.append(svgNode('line', { x1: 142, y1: line, x2: 178, y2: line, class: 'picker-ledger' }));
    for (let line = 38; line >= y - 1; line -= 12) svg.append(svgNode('line', { x1: 142, y1: line, x2: 178, y2: line, class: 'picker-ledger' }));
    svg.append(svgNode('ellipse', { cx: 160, cy: y, rx: 9, ry: 6, transform: `rotate(-18 160 ${y})`, class: `picker-note ${pending ? 'pending' : ''}` }));
    svg.append(svgNode('line', { x1: 168, y1: y - 2, x2: 168, y2: Math.max(5, y - 29), class: 'picker-stem' }));
    const alter = inserting ? [1,3,6,8,10].includes(midi % 12) ? 1 : 0 : pending?.alter ?? first?.alter ?? 0;
    if (alter) { const accidental = svgNode('text', { x: 130, y: y + 6, class: 'picker-accidental' }); accidental.textContent = alter > 0 ? '♯'.repeat(Math.min(2, alter)) : '♭'.repeat(Math.min(2, -alter)); svg.append(accidental); }
  }
  $('pitch-staff-caption').textContent = `${bass ? '低音' : '高音'}谱表${pitchOctaveShift ? ` · ${pitchOctaveShift > 0 ? '+' : ''}${pitchOctaveShift} 八度` : ''}`;
}

function pickStaffPitch(diatonic) {
  if (editScope !== 'notes' || editorBusy) return;
  if (noteTool === 'insert') {
    const { step, octave } = stepOfDiatonic(diatonic);
    const slot = $('insert-slot').value ? JSON.parse($('insert-slot').value) : null;
    const alter = slot ? keyAlter(step, editor.keyFifths(slot.partIndex, selectedMeasure)) : 0;
    const midi = midiOf(step, alter, octave);
    if (isPlayableMidi(midi)) $('insert-pitch').value = String(midi);
  } else if (selectedIds.length === 1) pendingPitch = { diatonic, shift: 0 };
  renderEditorSelection();
}

function updateRhythmPanel(first) {
  const duration = first ? first.durationUnits / first.divisions : null;
  const match = duration === null ? null : RHYTHM_OPTIONS.find(option => Math.abs(option.beats - duration) < 0.0005);
  const triplet = first?.node.querySelector('time-modification actual-notes')?.textContent === '3' && first?.node.querySelector('time-modification normal-notes')?.textContent === '2';
  const written = triplet ? RHYTHM_OPTIONS.find(option => option.type === first.node.querySelector('type')?.textContent && option.dots === first.node.querySelectorAll('dot').length) : null;
  $('rhythm-trigger-glyph').innerHTML = (written || match) ? noteGlyph((written || match).type, (written || match).dots, { size: 24 }) : '';
  $('rhythm-trigger-label').textContent = triplet ? `${written?.label || '音符'}三连音 · 实际 ${+duration.toFixed(4)} 拍` : match ? `${match.label} · ${match.beats} 拍` : duration !== null ? `当前时值 · ${+duration.toFixed(4)} 拍（自定义）` : '选择时值';
  const disabled = !first || selectedIds.length !== 1 || editorBusy || triplet || editScope !== 'notes';
  $('rhythm-trigger').disabled = disabled;
  $('rhythm-help').textContent = triplet ? '先移除三连音再改单个时值' : selectedIds.length > 1 ? '节奏修改请单选一个音符' : '点图标应用 · 自动平衡拍数';
  for (const button of $('rhythm-palette').querySelectorAll('button')) {
    button.disabled = disabled;
    button.setAttribute('aria-pressed', String(!triplet && Number(button.dataset.beats) === duration));
  }
  if (!first) setRhythmMenu(false);
  for (const option of $('rhythm-menu').querySelectorAll('.rhythm-option')) {
    option.setAttribute('aria-selected', String(!!match && Math.abs(Number(option.dataset.beats) - match.beats) < 1e-6));
  }
}

function updateInsertPanel() {
  const measureSelect = $('insert-measure');
  const slotSelect = $('insert-slot');
  const durationSelect = $('insert-duration');
  const startSelect = $('insert-start');
  const count = editor?.measureStarts.length || 0;
  if (selectedMeasure !== null && selectedMeasure >= count) selectedMeasure = count ? count - 1 : null;
  if (measureSelect.options.length !== count) measureSelect.replaceChildren(...Array.from({ length: count }, (_, index) => new Option(`第 ${index + 1} 小节`, String(index))));
  measureSelect.value = selectedMeasure === null ? '' : String(selectedMeasure);
  measureSelect.disabled = !count || editorBusy;
  $('insert-before').disabled = !selectedMeasures.length || editorBusy || editScope !== 'measures';
  $('insert-after').disabled = !selectedMeasures.length || editorBusy || editScope !== 'measures';
  const slots = selectedMeasure === null ? [] : editor.restSlots(selectedMeasure);
  const oldSlot = slotSelect.value;
  slotSelect.replaceChildren(...slots.map(slot => {
    const track = score?.tracks.find(item => item.partId === editor.partIds[slot.partIndex] && item.id.endsWith(`:${slot.staff}`));
    return new Option(`${track?.label || `声部 ${slot.partIndex + 1}`} · 声部 ${slot.voice}`, JSON.stringify(slot));
  }));
  if (slots.some(slot => JSON.stringify(slot) === oldSlot)) slotSelect.value = oldSlot;
  slotSelect.disabled = !slots.length || editorBusy;
  const slot = slotSelect.value ? JSON.parse(slotSelect.value) : null;
  const oldDuration = durationSelect.value;
  const durations = slot ? RHYTHM_OPTIONS.filter(option => editor.restPositions(selectedMeasure, slot, option.beats).length) : [];
  durationSelect.replaceChildren(...durations.map(option => new Option(`${option.label} · ${option.beats} 拍`, String(option.beats))));
  if (durations.some(option => String(option.beats) === oldDuration)) durationSelect.value = oldDuration;
  else if (durations.some(option => option.beats === 1)) durationSelect.value = '1';
  else if (durations.length) durationSelect.value = String(durations.find(option => option.beats < 1)?.beats || durations.at(-1).beats);
  durationSelect.disabled = !durations.length || editorBusy;
  const oldStart = startSelect.value;
  const beats = Number(durationSelect.value);
  const positions = slot && Number.isFinite(beats) ? editor.restPositions(selectedMeasure, slot, beats) : [];
  const meter = selectedMeasure === null ? null : editor.meterAt(selectedMeasure);
  startSelect.replaceChildren(...positions.map(position => new Option(`第 ${+(1 + position * meter.beatType / 4).toFixed(3)} 拍`, String(position))));
  if (positions.some(position => String(position) === oldStart)) startSelect.value = oldStart;
  startSelect.disabled = !positions.length || editorBusy;
  $('insert-pitch').disabled = !positions.length || editorBusy;
  $('insert-note').disabled = !positions.length || editorBusy || editScope !== 'notes';
  $('insert-hint').textContent = !meter ? '先选择一个小节。' : !slots.length ? '本小节没有可用的休止符；可先插入一个新小节。' : `${meter.beats}/${meter.beatType} 拍 · 只能放在当前声部的空拍内。`;
  for (const button of $('insert-rhythm-palette').querySelectorAll('button')) {
    button.disabled = editorBusy || !durations.some(option => option.beats === Number(button.dataset.beats));
    button.setAttribute('aria-pressed', String(Number(button.dataset.beats) === beats));
  }
}

function renderEditorSelection() {
  clearEditorMarks();
  if (!editor) return;
  selectedMeasures = selectedMeasures.filter(index => index < editor.measureStarts.length);
  if (selectedMeasure !== null && selectedMeasure >= editor.measureStarts.length) selectedMeasure = editor.measureStarts.length ? editor.measureStarts.length - 1 : null;
  selectedIds = selectedIds.filter(id => editor.get(id)?.pitched);
  if (!selectedIds.length) selectionAnchor = null;
  const first = editor.get(selectedIds[0]);
  const pending = pendingPitchInfo(first);
  const bars = editScope === 'measures';
  $('measure-tools').hidden = !bars;
  $('note-tools').hidden = bars;
  $('note-edit-tools').hidden = noteTool !== 'select';
  $('note-rhythm-card').hidden = noteTool !== 'select';
  $('note-insert-tools').hidden = noteTool !== 'insert';
  for (const [id, active] of [['mode-measures', bars], ['mode-notes', !bars], ['note-select-tool', noteTool === 'select'], ['note-insert-tool', noteTool === 'insert']]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
    $(id).disabled = editorBusy;
  }
  $('score-paper').dataset.editScope = editScope;
  $('score-paper').classList.toggle('picking-pitch', pickingScorePitch);
  $('editor-panel-title').textContent = bars ? '小节设置' : noteTool === 'insert' ? '添加音符' : '音符设置';
  $('editor-mode-hint').textContent = bars ? '单击选小节 · Shift 连选 · Ctrl / ⌘ 点选' : noteTool === 'insert' ? '点击休止符定位 · 选择音高与节奏 · 插入' : '单击选音符 · Shift 连选 · Ctrl / ⌘ 点选 · Del 删除';
  $('editor-selection').textContent = bars ? measureSelectionLabel() : noteTool === 'insert' ? selectedMeasure !== null ? `第 ${selectedMeasure + 1} 小节 · 选择空拍写入音符` : '点击谱面选择写入位置' : selectedIds.length === 1 && first ? noteLabel(first) : selectedIds.length ? `已选择 ${selectedIds.length} 个音符` : selectedMeasure !== null ? `第 ${selectedMeasure + 1} 小节 · 点击音符开始编辑` : '点击谱面上的音符';
  $('editor-state').textContent = editorBusy ? '正在更新…' : bars ? `${selectedMeasures.length} 小节` : noteTool === 'insert' ? '保留拍数' : `${selectedIds.length} 音符`;
  updateInsertPanel();
  updatePitchPanel(first, pending);
  updateRhythmPanel(first);
  if (selectedMeasure !== null && !$('meter-start').value) {
    $('meter-start').value = String(selectedMeasure + 1);
    $('meter-end').value = String(selectedMeasure + 1);
  }
  for (const id of ['meter-start', 'meter-end']) $(id).max = String(editor.measureStarts.length);
  if (selectedMeasure !== null) {
    const meter = editor.meterAt(selectedMeasure);
    $('editor-measure-title').textContent = '拍号';
    $('edit-beats').value = String(meter.beats);
    $('edit-beat-type').value = String(meter.beatType);
  }
  drawEditorMarks(first, pending);
  drawMeasureSelection();
  $('apply-meter').disabled = !selectedMeasures.length || editorBusy || !bars;
  $('apply-meter').textContent = selectedMeasures.length ? `应用到 ${selectedMeasures.length} 个小节` : '先选择小节';
  $('add-triplet').disabled = selectedIds.length !== 3 || editorBusy;
  $('remove-triplet').disabled = !first?.node.querySelector('time-modification') || editorBusy;
  $('add-tie').disabled = selectedIds.length !== 2 || editorBusy;
  $('remove-tie').disabled = selectedIds.length !== 2 || editorBusy;
  $('edit-undo').disabled = !editor.undoStack.length || editorBusy;
  $('edit-redo').disabled = !editor.redoStack.length || editorBusy;
  $('delete-notes').disabled = !selectedIds.length || editorBusy || bars;
  $('delete-notes').innerHTML = `删除${selectedIds.length > 1 ? ` ${selectedIds.length} 个` : '所选'}音符 <span>Del</span>`;
  updateMeterPresets();
}

function syncMeterRange(index = null) {
  $('meter-start').value = index !== null ? String(index + 1) : selectedMeasures.length ? String(selectedMeasures[0] + 1) : '';
  $('meter-end').value = index !== null ? String(index + 1) : selectedMeasures.length ? String(selectedMeasures.at(-1) + 1) : '';
}

function updateMeterPresets() {
  for (const button of document.querySelectorAll('[data-meter]')) button.setAttribute('aria-pressed', String(button.dataset.meter === `${$('edit-beats').value}/${$('edit-beat-type').value}`));
}

function buildRhythmMenu() {
  $('rhythm-menu').innerHTML = RHYTHM_OPTIONS.map(option => `<button class="rhythm-option" type="button" role="option" data-beats="${option.beats}" aria-selected="false"><span class="rhythm-option-glyph">${noteGlyph(option.type, option.dots, { size: 22 })}</span><span class="rhythm-option-name">${option.label}</span><span class="rhythm-option-beats">${option.beats} 拍</span></button>`).join('');
  const common = RHYTHM_OPTIONS.filter(option => !option.dots && [4,2,1,0.5,0.25,0.125].includes(option.beats));
  for (const id of ['rhythm-palette', 'insert-rhythm-palette']) $(id).innerHTML = common.map(option => `<button type="button" data-beats="${option.beats}" aria-label="${option.label}，${option.beats} 拍" title="${option.label} · ${option.beats} 拍" aria-pressed="false">${noteGlyph(option.type, option.dots, { size: 34 })}<span>${option.beats >= 1 ? option.beats : `1/${1 / option.beats}`} 拍</span></button>`).join('');
}

function setRhythmMenu(open) {
  $('rhythm-menu').hidden = !open;
  $('rhythm-trigger').setAttribute('aria-expanded', String(open));
  $('rhythm-trigger').classList.toggle('open', open);
}

function nudgePendingPitch(delta) {
  if (noteTool === 'insert' && editScope === 'notes') {
    const midi = Number($('insert-pitch').value) + delta;
    if (isPlayableMidi(midi)) $('insert-pitch').value = String(midi);
    renderEditorSelection();
    return;
  }
  const first = editor?.get(selectedIds[0]);
  if (!first?.pitched || selectedIds.length !== 1 || editorBusy || editScope !== 'notes') return;
  if (!pendingPitch) {
    // 从音符当前的实际音高起步（不是从调号），第一次按 ♯/♭ 就是升／降半音。
    const fifths = editor.keyFifths(first.partIndex, first.measureIndex);
    pendingPitch = { diatonic: diatonicOf(first.step, first.octave), shift: first.alter - keyAlter(first.step, fifths) };
  }
  pendingPitch.shift += delta;
  renderEditorSelection();
}

function selectRecord(record, event) {
  if (!record.pitched) return;
  if (event.shiftKey && selectionAnchor && editor.get(selectionAnchor)) {
    const anchor = editor.get(selectionAnchor);
    if (record.partIndex === anchor.partIndex && record.staff === anchor.staff && record.voice === anchor.voice) {
      const start = Math.min(anchor.beat, record.beat), end = Math.max(anchor.beat, record.beat);
      selectedIds = editor.records.filter(item => item.pitched && item.partIndex === anchor.partIndex && item.staff === anchor.staff && item.voice === anchor.voice && item.beat >= start - 0.001 && item.beat <= end + 0.001).map(item => item.id);
    } else { selectedIds = [record.id]; selectionAnchor = record.id; }
  } else if (event.ctrlKey || event.metaKey) {
    selectedIds = selectedIds.includes(record.id) ? selectedIds.filter(id => id !== record.id) : [...selectedIds, record.id];
    selectionAnchor = record.id;
  } else { selectedIds = [record.id]; selectionAnchor = record.id; }
  selectedMeasure = record.measureIndex;
  selectedMeasures = [selectedMeasure];
  syncMeterRange(selectedMeasure);
  pendingPitch = null;
  pickingScorePitch = false;
  pitchOctaveShift = 0;
  renderEditorSelection();
}

function nearestMeasure(page, point) {
  let match = null, distance = Infinity;
  for (const system of page.MusicSystems || []) for (const line of system.StaffLines || []) for (const measure of line.Measures || []) {
    const box = measure.PositionAndShape;
    const x = box.AbsolutePosition.x, y = box.AbsolutePosition.y;
    const left = x + box.BorderLeft, right = x + box.BorderRight;
    const top = y + box.BorderTop - 2, bottom = y + box.BorderBottom + 2;
    const dx = Math.max(left - point.x, 0, point.x - right);
    const dy = Math.max(top - point.y, 0, point.y - bottom);
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) { distance = candidate; match = measure; }
  }
  return distance < 36 ? Number(match?.parentSourceMeasure?.MeasureNumber) - 1 : null;
}

async function applyEditorChange(change) {
  if (editorBusy || !editor) return;
  let xml;
  try { xml = change(); } catch (error) { $('editor-message').textContent = error.message; toast(error.message); return; }
  if (!xml) return;
  pendingPitch = null;
  editorBusy = true;
  $('editor-message').textContent = '正在重新绘制谱面和更新播放数据…';
  renderEditorSelection();
  await nextPaint();
  const paper = $('score-paper');
  const scroll = { top: paper.scrollTop, left: paper.scrollLeft };
  const previous = score?.tracks.map(track => ({ id: track.id, enabled: track.enabled, volume: track.volume })) || [];
  const title = score?.title || '';
  try {
    await loadXML(xml, null, title, true);
    for (const track of score.tracks) {
      const old = previous.find(item => item.id === track.id);
      if (old) { track.enabled = old.enabled; track.volume = old.volume; }
    }
    renderTracks();
    renderTimeline();
    paper.scrollTo({ ...scroll, behavior: 'auto' });
    $('editor-message').textContent = editor.lastEditWarnings?.length
      ? `已更新。${[...new Set(editor.lastEditWarnings)].join(' ')}`
      : '已更新。可试听或下载修改后的 MusicXML。';
  } catch (error) {
    $('editor-message').textContent = `更新失败：${error.message}`;
    toast(error.message);
  } finally { editorBusy = false; renderEditorSelection(); }
}

buildRhythmMenu();
$('insert-pitch').replaceChildren(...Array.from({ length: 88 }, (_, index) => new Option(pitchName(index + 21), String(index + 21))));
$('insert-pitch').value = '60';
$('practice-tab').addEventListener('click', () => setEditorMode(false));
$('edit-tab').addEventListener('click', () => setEditorMode(true));
$('mode-measures').addEventListener('click', () => setEditScope('measures'));
$('mode-notes').addEventListener('click', () => setEditScope('notes'));
for (const [id, tool] of [['note-select-tool', 'select'], ['note-insert-tool', 'insert']]) $(id).addEventListener('click', () => {
  noteTool = tool;
  pendingPitch = null;
  pickingScorePitch = false;
  pitchOctaveShift = 0;
  if (tool === 'insert') selectedIds = [];
  renderEditorSelection();
});
$('pitch-staff').addEventListener('click', event => {
  if ($('pitch-staff').getAttribute('aria-disabled') === 'true') return;
  const point = $('pitch-staff').createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  const local = point.matrixTransform($('pitch-staff').getScreenCTM().inverse());
  pickStaffPitch(Number($('pitch-staff').dataset.base) + Math.round((98 - local.y) / 6));
});
for (const [id, delta] of [['pitch-octave-down', -1], ['pitch-octave-up', 1]]) $(id).addEventListener('click', () => {
  pitchOctaveShift = Math.max(-3, Math.min(3, pitchOctaveShift + delta));
  updatePitchPanel(editor?.get(selectedIds[0]), pendingPitchInfo(editor?.get(selectedIds[0])));
});
$('pick-score-pitch').addEventListener('click', () => { pickingScorePitch = !pickingScorePitch; renderEditorSelection(); });
$('select-all-measures').addEventListener('click', () => {
  selectedMeasures = Array.from({ length: editor.measureStarts.length }, (_, index) => index);
  selectedMeasure = 0; measureAnchor = 0;
  syncMeterRange(); renderEditorSelection();
});
$('select-measure-range').addEventListener('click', () => {
  const start = Number($('meter-start').value) - 1, end = Number($('meter-end').value) - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= editor.measureStarts.length) { toast('请输入有效的小节起止范围。'); return; }
  selectedMeasures = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  selectedMeasure = start; measureAnchor = start;
  selectedIds = []; pendingPitch = null;
  renderEditorSelection(); focusMeasure(start + 1);
});
for (const button of document.querySelectorAll('[data-meter]')) button.addEventListener('click', () => {
  [$('edit-beats').value, $('edit-beat-type').value] = button.dataset.meter.split('/');
  updateMeterPresets();
});
for (const id of ['edit-beats', 'edit-beat-type']) $(id).addEventListener('input', updateMeterPresets);
$('score-view').addEventListener('click', event => {
  if (!editorMode || editorBusy || !osmd) return;
  const badge = event.target.closest('.measure-number-badge');
  if (badge) {
    const index = Number(badge.dataset.measureIndex);
    if (editScope === 'measures') selectMeasure(index, event);
    else { selectedMeasure = index; selectedMeasures = [index]; selectedIds = []; pendingPitch = null; renderEditorSelection(); }
    return;
  }
  const svg = event.target.closest('svg');
  if (!svg) return;
  const pageIndex = Array.from($('score-view').querySelectorAll('svg')).indexOf(svg);
  const page = osmd.GraphicSheet.MusicPages[pageIndex];
  if (!page) return;
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = event.clientX; svgPoint.y = event.clientY;
  const local = svgPoint.matrixTransform(svg.getScreenCTM().inverse());
  const point = osmd.GraphicSheet.svgToOsmd({ x: local.x, y: local.y });
  if (editScope === 'measures') {
    const measure = nearestMeasure(page, point);
    if (measure !== null) selectMeasure(measure, event);
    return;
  }
  const note = osmd.GraphicSheet.GetNearestNote(point, { x: 1.9, y: 1.9 }, page);
  const center = note?.PositionAndShape?.AbsolutePosition;
  const hitNote = note && center && Math.hypot(center.x - point.x, center.y - point.y) < 1.9 ? editor.findFromSource(note.sourceNote) : null;
  if (noteTool === 'insert') {
    const index = hitNote?.measureIndex ?? nearestMeasure(page, point);
    if (index === null) return;
    selectedMeasure = index;
    selectedMeasures = [index];
    selectedIds = []; pendingPitch = null;
    updateInsertPanel();
    if (hitNote?.rest) {
      const slot = JSON.stringify({ partIndex: hitNote.partIndex, voice: hitNote.voice, staff: hitNote.staff });
      if ([...$('insert-slot').options].some(option => option.value === slot)) {
        $('insert-slot').value = slot;
        updateInsertPanel();
        if ([...$('insert-start').options].some(option => Number(option.value) === hitNote.startBeats)) $('insert-start').value = String(hitNote.startBeats);
      }
    }
    renderEditorSelection();
    return;
  }
  const modifierClick = event.ctrlKey || event.metaKey || event.shiftKey;
  const single = selectedIds.length === 1 ? editor.get(selectedIds[0]) : null;
  // 点到的就是当前这个音时，不要重新选中它——用户是在给它挑音高。
  if (hitNote?.pitched && (!pickingScorePitch || modifierClick)) { selectRecord(hitNote, event); return; }
  // 选中音符后，点谱表现在只做「预览音高」，不直接写盘面。
  const hit = pickingScorePitch && single?.pitched ? pitchLineHit(page, point) : null;
  const map = hit ? staffLineMap(hit.line) : null;
  if (single && hit && map && graphicStaffLine.get(single.id) === hit.line) {
    pendingPitch = { diatonic: map.toDiatonic(point.y), shift: 0 };
    renderEditorSelection();
    $('editor-message').textContent = '虚线是预览；Enter 或「确认音高」写入谱面，Esc 取消。';
    return;
  }
  const measure = nearestMeasure(page, point);
  if (measure !== null && measure >= 0 && measure < score.measures) {
    selectedMeasure = measure;
    selectedMeasures = [measure];
    syncMeterRange(selectedMeasure);
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) { selectedIds = []; pendingPitch = null; }
    renderEditorSelection();
  }
});
$('apply-pitch').addEventListener('click', () => {
  if (editScope !== 'notes' || noteTool !== 'select' || selectedIds.length !== 1) return;
  const first = editor?.get(selectedIds[0]);
  const pending = pendingPitchInfo(first);
  if (!first || !pending?.playable) return;
  const midi = pending.midi;
  pendingPitch = null;
  pickingScorePitch = false;
  applyEditorChange(() => editor.changePitch(first.id, midi));
});
$('cancel-pitch').addEventListener('click', () => { pendingPitch = null; renderEditorSelection(); });
$('pitch-flat').addEventListener('click', () => nudgePendingPitch(-1));
$('pitch-sharp').addEventListener('click', () => nudgePendingPitch(1));
$('rhythm-trigger').addEventListener('click', event => { event.stopPropagation(); setRhythmMenu($('rhythm-menu').hidden); });
$('rhythm-menu').addEventListener('click', event => {
  const option = event.target.closest('.rhythm-option');
  if (!option || editorBusy) return;
  setRhythmMenu(false);
  const first = editor?.get(selectedIds[0]);
  if (!first) return;
  const beats = Number(option.dataset.beats);
  applyEditorChange(() => editor.changeRhythm(first.id, beats));
});
for (const id of ['rhythm-palette', 'insert-rhythm-palette']) $(id).addEventListener('click', event => {
  const button = event.target.closest('button[data-beats]');
  if (!button || button.disabled || editorBusy || editScope !== 'notes') return;
  if (id === 'insert-rhythm-palette') { $('insert-duration').value = button.dataset.beats; updateInsertPanel(); }
  else if (selectedIds.length === 1) applyEditorChange(() => editor.changeRhythm(selectedIds[0], Number(button.dataset.beats)));
});
document.addEventListener('click', event => { if (!event.target.closest?.('.rhythm-field')) setRhythmMenu(false); });
document.addEventListener('keydown', event => {
  if (!editorMode || editorBusy || !editor) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); $(event.shiftKey ? 'edit-redo' : 'edit-undo').click(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && editScope === 'measures') {
    event.preventDefault(); $('select-all-measures').click(); return;
  }
  const badge = event.target.closest?.('.measure-number-badge');
  if (badge && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (editScope === 'measures') selectMeasure(Number(badge.dataset.measureIndex), event);
    return;
  }
  if (event.key === 'Escape') {
    if (!$('rhythm-menu').hidden) { setRhythmMenu(false); event.preventDefault(); return; }
    if (pendingPitch || pickingScorePitch) { pendingPitch = null; pickingScorePitch = false; renderEditorSelection(); event.preventDefault(); }
    return;
  }
  if (event.key === 'Enter' && pendingPitch && !$('apply-pitch').disabled) {
    $('apply-pitch').click();
    event.preventDefault();
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (editScope !== 'notes' || noteTool !== 'insert' && !editor.get(selectedIds[0])?.pitched) return;
    nudgePendingPitch(event.key === 'ArrowUp' ? 1 : -1);
    event.preventDefault();
  }
  if (event.key === 'Delete' && editScope === 'notes' && noteTool === 'select' && selectedIds.length) { event.preventDefault(); $('delete-notes').click(); }
});
$('apply-meter').addEventListener('click', () => { if (editScope === 'measures') applyEditorChange(() => editor.changeMeters(selectedMeasures, Number($('edit-beats').value), Number($('edit-beat-type').value))); });
$('add-triplet').addEventListener('click', () => applyEditorChange(() => editor.changeTriplet(selectedIds)));
$('remove-triplet').addEventListener('click', () => applyEditorChange(() => editor.changeTriplet(selectedIds, true)));
$('insert-measure').addEventListener('change', () => {
  selectedMeasure = Number($('insert-measure').value);
  selectedMeasures = [selectedMeasure];
  syncMeterRange(selectedMeasure);
  selectedIds = [];
  selectionAnchor = null;
  pendingPitch = null;
  renderEditorSelection();
  focusMeasure(selectedMeasure + 1);
});
$('insert-slot').addEventListener('change', updateInsertPanel);
$('insert-duration').addEventListener('change', updateInsertPanel);
$('insert-pitch').addEventListener('change', () => updatePitchPanel(null, null));
for (const [id, offset] of [['insert-before', 0], ['insert-after', 1]]) {
  $(id).addEventListener('click', () => applyEditorChange(() => {
    if (editScope !== 'measures' || !selectedMeasures.length) return null;
    const index = (offset ? selectedMeasures.at(-1) : selectedMeasures[0]) + offset;
    const xml = editor.insertMeasure(index);
    selectedMeasure = index;
    selectedMeasures = [index]; measureAnchor = index;
    syncMeterRange(index);
    selectedIds = [];
    selectionAnchor = null;
    return xml;
  }));
}
$('insert-note').addEventListener('click', () => applyEditorChange(() => {
  if (editScope !== 'notes') return null;
  const slot = JSON.parse($('insert-slot').value);
  const xml = editor.insertNote(selectedMeasure, slot, Number($('insert-start').value), Number($('insert-pitch').value), Number($('insert-duration').value));
  selectedIds = editor.lastInsertedNoteId ? [editor.lastInsertedNoteId] : [];
  selectionAnchor = selectedIds[0] || null;
  return xml;
}));
$('delete-notes').addEventListener('click', () => applyEditorChange(() => {
  if (editScope !== 'notes' || noteTool !== 'select') return null;
  const xml = editor.deleteNotes(selectedIds);
  selectedIds = []; selectionAnchor = null;
  return xml;
}));
$('add-tie').addEventListener('click', () => applyEditorChange(() => editor.changeTie(selectedIds[0], selectedIds[1])));
$('remove-tie').addEventListener('click', () => applyEditorChange(() => editor.changeTie(selectedIds[0], selectedIds[1], true)));
$('edit-undo').addEventListener('click', () => applyEditorChange(() => editor.undo()));
$('edit-redo').addEventListener('click', () => applyEditorChange(() => editor.redo()));
$('editor-issue-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-measure]');
  if (!button) return;
  if (editScope === 'measures') selectMeasure(Number(button.dataset.measure) - 1, event);
  focusMeasure(Number(button.dataset.measure));
});
$('edit-download').addEventListener('click', () => {
  if (!editor || !score) return;
  const blob = new Blob([editor.serialize()], { type: 'application/vnd.recordare.musicxml+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${score.title.replace(/[\\/:*?"<>|]/g, '_') || 'score'}-edited.musicxml`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function openFile(file) {
  if (!file) return;
  sessionStorage.removeItem('choir-import-job');
  beginImport(file);
  try {
    let xml;
    const ext = file.name.split('.').at(-1).toLowerCase();
    if (['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      if (staticBuild) throw new Error(staticOmrMessage);
      if (!omrStatus) omrStatus = await probeOmr();
      if (!omrStatus.available) throw new Error(staticOmrMessage);
      if (!omrStatus.omr) throw new Error('本机还没装 Audiveris，暂时只能导入 MusicXML；运行 scripts/setup-audiveris.ps1 可补齐。');
      if (file.size > 200 * 1024 * 1024) throw new Error('扫描文件不能超过 200 MB。');
      const id = await submitRecognition(file, ext);
      sessionStorage.setItem('choir-import-job', JSON.stringify({ id, name: file.name, size: file.size }));
      const recognition = await waitForRecognition(id);
      xml = recognition.xml;
      toast(recognition.cached ? '已打开本机保存的识谱结果，请对照原谱校对。' : '识谱完成，请对照原谱检查声部、音符与表情记号。');
    } else { importProgress('正在读取 MusicXML', '解压或读取文件', 25); await nextPaint(); xml = await readScoreFile(file); }
    await loadXML(xml, importProgress, fileTitle(file.name));
    sessionStorage.removeItem('choir-import-job');
    finishImport();
  }
  catch (error) { sessionStorage.removeItem('choir-import-job'); finishImport(error); toast(error.message || '读取乐谱失败。'); }
}

$('file-input').addEventListener('change', event => { openFile(event.target.files[0]); event.target.value = ''; });
$('dropzone').addEventListener('click', () => $('file-input').click());
$('dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') $('file-input').click(); });
for (const eventName of ['dragenter', 'dragover']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => openFile(event.dataTransfer.files[0]));
$('sample-button').addEventListener('click', () => loadXML(sampleXML).catch(error => toast(error.message)));
$('empty-sample').addEventListener('click', () => loadXML(sampleXML).catch(error => toast(error.message)));

$('tracks').addEventListener('click', event => {
  const row = event.target.closest('.track');
  if (!row) return;
  const index = Number(row.dataset.index);
  const track = score.tracks[index];
  if (event.target.closest('.toggle')) track.enabled = !track.enabled;
  else if (event.target.closest('.solo')) score.tracks.forEach((t, i) => { t.enabled = i === index; });
  else return;
  renderTracks();
  player.updateMix();
});
$('tracks').addEventListener('input', event => {
  if (!event.target.matches('.volume')) return;
  const index = Number(event.target.closest('.track').dataset.index);
  const track = score.tracks[index];
  track.volume = Number(event.target.value) / 100;
  if (player.synth) player.synth.controllerChange(track.channel, 7, Math.round(track.volume * 127));
});
$('all-tracks').addEventListener('click', () => { score.tracks.forEach(t => { t.enabled = true; }); renderTracks(); player.updateMix(); });
$('none-tracks').addEventListener('click', () => { score.tracks.forEach(t => { t.enabled = false; }); renderTracks(); player.updateMix(); });

let exportingAudio = false;
$('export-audio').addEventListener('click', async () => {
  const button = $('export-audio');
  if (exportingAudio) { player.cancelExport(); return; }
  if (!score) { toast('先打开一份乐谱。'); return; }
  const enabled = score.tracks.filter(t => t.enabled);
  if (!enabled.length) { toast('至少开启一个声部再导出。'); return; }
  const formatSelect = $('export-format');
  const format = formatSelect.value;

  exportingAudio = true;
  formatSelect.disabled = true;
  button.textContent = '取消导出';
  button.classList.add('active');
  const bar = $('soundfont-progress');
  try {
    const result = await player.exportAudio({ format, onProgress: (fraction, elapsed, total, phase) => {
      if (!Number.isFinite(fraction)) return;
      bar.hidden = false;
      bar.value = Math.round(fraction * 100);
      $('status').textContent = phase === 'encoding'
        ? `正在压缩 MP3 ${Math.round(fraction * 100)}%`
        : `导出音频 ${Math.round(fraction * 100)}% · ${formatTime(elapsed)} / ${formatTime(total)}`;
    } });
    const suffix = `${player.mode === 'piano' ? 'piano' : 'voices'}-${enabled.map(track => track.role).join('')}`;
    const name = `${(score.title || 'choir').replace(/[\\/:*?"<>|]/g, '_')}-${suffix}.${format}`;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`已导出 ${name} · ${formatTime(result.seconds)} · ${(result.blob.size / 1048576).toFixed(1)} MB`);
    $('status').textContent = '导出完成';
  } catch (error) {
    const cancelled = /取消/.test(error.message || '');
    toast(cancelled ? '已取消导出。' : `导出失败：${error.message}`);
    $('status').textContent = cancelled ? '已取消导出' : '导出失败';
  } finally {
    exportingAudio = false;
    formatSelect.disabled = false;
    button.textContent = '导出音频';
    button.classList.remove('active');
    bar.hidden = true;
  }
});
$('timeline-content').addEventListener('click', event => {
  if (!score) return;
  const rect = $('timeline-content').getBoundingClientRect();
  const beat = Math.max(0, Math.min(score.totalBeats, (event.clientX - rect.left - TRACK_LABEL_WIDTH) / BEAT_WIDTH));
  player.seek(beatToSeconds(score, beat, player.tempoScale));
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === button));
  player.setMode(button.dataset.mode);
  renderTracks();
}));
$('play-button').addEventListener('click', async () => {
  if (exportingAudio) { toast('正在导出音频；要播放请先取消导出。'); return; }
  if (player.playing || player.starting) { player.pause(); $('status').textContent = '已暂停'; return; }
  try { await player.play(); if (player.playing) $('status').textContent = '正在播放'; }
  catch (error) { toast(`播放失败：${error.message}`); $('status').textContent = '播放失败'; }
});
$('back-to-start').addEventListener('click', () => player.seek(0));
$('seek').addEventListener('input', event => player.seek(Number(event.target.value) / 1000 * player.duration));
$('follow-score').addEventListener('click', () => {
  followScore = !followScore;
  $('follow-score').classList.toggle('active', followScore);
  $('follow-score').setAttribute('aria-pressed', String(followScore));
  $('follow-score').textContent = followScore ? '● 跟随播放' : '○ 自由看谱';
  if (followScore) revealScoreCursor('smooth');
});
$('tempo').addEventListener('change', event => { const amount = Number(event.target.value); $('tempo-value').textContent = `${amount}%`; player.setTempo(amount / 100); });
$('tempo').addEventListener('input', event => { $('tempo-value').textContent = `${event.target.value}%`; });

try {
  const pendingImport = JSON.parse(sessionStorage.getItem('choir-import-job') || 'null');
  if (pendingImport?.id) {
    beginImport({ name: pendingImport.name, size: pendingImport.size || 0 });
    waitForRecognition(pendingImport.id)
      .then(result => loadXML(result.xml, importProgress, fileTitle(pendingImport.name)))
      .then(() => { sessionStorage.removeItem('choir-import-job'); finishImport(); })
      .catch(error => { sessionStorage.removeItem('choir-import-job'); finishImport(error); });
  }
} catch { sessionStorage.removeItem('choir-import-job'); }

// Dev-only hook so the smoke scripts can assert on the real mixer state.
if (import.meta.env.DEV) {
  window.choirOsmd = () => osmd;
window.choirDebug = () => ({
    mode: player.mode,
    tempo: player.tempoScale,
    exporting: player.exporting,
    lastMix: player.lastMix,
    tracks: (score?.tracks || []).map(track => ({ role: track.role, enabled: track.enabled, volume: track.volume, channel: track.channel, program: track.program })),
  });
}

// Tell the visitor up front what this build can do: the static site can read
// MusicXML but has no OMR, so the sidebar says so before a failed upload.
(async () => {
  if (staticBuild) { showStandaloneNotice('线上版不跑识谱服务'); return; }
  omrStatus = await probeOmr();
  if (omrStatus.available && omrStatus.omr) return;
  showStandaloneNotice(omrStatus.available ? '本机还没有安装 Audiveris' : '线上版不跑识谱服务');
})();
