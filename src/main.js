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
        <div class="section-row"><div><span class="section-index">01</span><h3 id="score-section-title">乐谱预览</h3></div><div class="score-follow-controls"><span id="score-page-status">第 1 页</span><button id="follow-score" class="active" type="button" aria-pressed="true">● 跟随播放</button></div></div>
        <div class="score-edit-layout"><div class="score-paper" id="score-paper"><div id="score-view"></div></div>
          <aside class="editor-panel" id="editor-panel" aria-label="乐谱编辑器">
            <div class="editor-panel-head"><strong>修改乐谱</strong><span id="editor-state">点击谱面上的音符</span></div>
            <p class="editor-help">单击选中音符；选中后直接在五线谱上点你想放的音高，虚线音符是预览。Enter 确认，Esc 取消。Ctrl 点选增减，Shift 点选连续音符。</p>
            <div class="editor-selection" id="editor-selection">尚未选中音符</div>
            <div class="editor-group-title-row"><strong class="editor-group-title">音高</strong><span class="editor-group-hint">点谱面拾取</span></div>
            <div class="pitch-compare">
              <div class="pitch-slot current"><span class="pitch-name" id="pitch-current">—</span><span class="pitch-caption">当前</span></div>
              <span class="pitch-arrow" aria-hidden="true">→</span>
              <div class="pitch-slot target" id="pitch-target-slot"><span class="pitch-name" id="pitch-target">—</span><span class="pitch-caption">待确认</span></div>
            </div>
            <div class="pitch-actions">
              <button class="editor-chip" id="pitch-flat" type="button" aria-label="降半音" title="降半音">♭</button>
              <button class="editor-chip" id="pitch-sharp" type="button" aria-label="升半音" title="升半音">♯</button>
              <button class="editor-primary" id="apply-pitch" type="button">确认音高</button>
              <button class="editor-secondary" id="cancel-pitch" type="button">取消</button>
            </div>
            <div class="editor-group-title-row"><strong class="editor-group-title">时值</strong><span class="editor-group-hint">点一下即应用</span></div>
            <div class="rhythm-field">
              <button class="rhythm-trigger" id="rhythm-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
                <span class="rhythm-trigger-glyph" id="rhythm-trigger-glyph"></span>
                <span class="rhythm-trigger-label" id="rhythm-trigger-label">选择时值</span>
                <span class="rhythm-caret" aria-hidden="true">⌄</span>
              </button>
              <div class="rhythm-menu" id="rhythm-menu" role="listbox" aria-label="时值" hidden></div>
            </div>
            <div class="editor-divider"></div>
            <strong class="editor-group-title" id="editor-measure-title">小节拍号</strong>
            <div class="editor-meter"><input id="edit-beats" type="number" min="1" max="12" aria-label="每小节拍数"><span>/</span><select id="edit-beat-type" aria-label="拍号单位"><option>2</option><option>4</option><option>8</option><option>16</option></select></div>
            <button class="editor-secondary" id="apply-meter" type="button">修改本小节拍号</button>
            <div class="editor-divider"></div>
            <strong class="editor-group-title">延音线</strong><p class="editor-help">选中同声部、同音高的两个相邻音符，可跨小节或跨谱行。</p>
            <div class="editor-button-row"><button class="editor-secondary" id="add-tie" type="button">连接延音线</button><button class="editor-secondary" id="remove-tie" type="button">取消延音线</button></div>
            <div class="editor-divider"></div>
            <div class="editor-button-row"><button class="editor-secondary" id="edit-undo" type="button">↶ 撤销</button><button class="editor-secondary" id="edit-redo" type="button">↷ 重做</button></div>
            <button class="editor-download" id="edit-download" type="button">下载修改后的 MusicXML</button>
            <p class="editor-message" id="editor-message" role="status"></p>
          </aside></div>
        <div class="section-row timeline-heading"><div><span class="section-index">02</span><h3>实际发声轨道</h3></div><span class="hint">点击轨道定位播放 · 彩色块代表实际唱出的音</span></div>
        <div class="timeline-panel">
          <div class="timeline-info"><span>实际播放音符 · 延音线已连接</span><span class="wave-caption">实时总波形 <canvas id="live-wave" width="150" height="34" aria-label="实时音频波形"></canvas></span></div>
          <div class="timeline-scroll" id="timeline-scroll"><div class="timeline-content" id="timeline-content"></div></div>
          <p class="timeline-help">每一行对应一个声部；延音线连接的音符显示为连续长条，跨小节持续发声。竖线跟随播放，点击轨道可跳到该位置。</p>
        </div>
        <div class="section-row mixer-heading"><div><span class="section-index">03</span><h3>声部混音台</h3></div><span class="hint">点亮想听的声部，独奏可快速定位旋律</span></div>
        <div class="mix-toolbar"><div class="mode-switch" role="group" aria-label="音色模式"><button data-mode="voice" class="active">◉ 人声版</button><button data-mode="piano">♫ 纯音乐版</button></div><div class="mix-actions"><button id="all-tracks">全部开启</button><button id="none-tracks">全部静音</button><button id="export-audio" title="按当前声部开关、每个声部的音量、音色和速度导出 WAV">导出音频</button></div></div>
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

function submitRecognition(file, ext) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/recognize-jobs?ext=${encodeURIComponent(ext)}`);
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
    osmd.cursor.reset();
    osmd.cursor.show();
    if (editorMode) osmd.cursor.hide();
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
  if (!active) pendingPitch = null;
  $('loaded').classList.toggle('editor-mode', active);
  $('practice-tab').classList.toggle('active', !active);
  $('edit-tab').classList.toggle('active', active);
  $('practice-tab').setAttribute('aria-selected', String(!active));
  $('edit-tab').setAttribute('aria-selected', String(active));
  $('score-section-title').textContent = active ? '编辑谱面' : '乐谱预览';
  if (active) player.pause();
  if (osmd?.cursor) active ? osmd.cursor.hide() : osmd.cursor.show();
  renderEditorSelection();
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
  document.querySelectorAll('.editor-selection-mark, .pitch-mark').forEach(node => node.remove());
}

function drawEditorMarks(first, pending) {
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
  $('pitch-current').textContent = currentPitchName(first) || '—';
  $('pitch-target').textContent = pending ? pending.name : '—';
  $('pitch-target-slot').classList.toggle('ready', !!pending);
  const editable = !!first?.pitched && !editorBusy;
  $('pitch-flat').disabled = !editable;
  $('pitch-sharp').disabled = !editable;
  $('cancel-pitch').disabled = !pending || editorBusy;
  $('apply-pitch').disabled = !pending || !pending.playable || editorBusy;
  $('apply-pitch').textContent = pending && !pending.playable ? '超出可用音域' : '确认音高';
}

function updateRhythmPanel(first) {
  const duration = first ? first.durationUnits / first.divisions : null;
  const match = duration === null ? null : RHYTHM_OPTIONS.find(option => Math.abs(option.beats - duration) < 0.0005);
  $('rhythm-trigger-glyph').innerHTML = match ? noteGlyph(match.type, match.dots, { size: 24 }) : '';
  $('rhythm-trigger-label').textContent = match ? `${match.label} · ${match.beats} 拍` : duration !== null ? `当前时值 · ${+duration.toFixed(4)} 拍（自定义）` : '选择时值';
  $('rhythm-trigger').disabled = !first || editorBusy;
  if (!first) setRhythmMenu(false);
  for (const option of $('rhythm-menu').querySelectorAll('.rhythm-option')) {
    option.setAttribute('aria-selected', String(!!match && Math.abs(Number(option.dataset.beats) - match.beats) < 1e-6));
  }
}

function renderEditorSelection() {
  clearEditorMarks();
  if (!editor) return;
  const first = editor.get(selectedIds[0]);
  const pending = pendingPitchInfo(first);
  $('editor-selection').textContent = selectedIds.length === 1 && first ? noteLabel(first) : selectedIds.length ? `已选择 ${selectedIds.length} 个音符` : selectedMeasure !== null ? `第 ${selectedMeasure + 1} 小节` : '尚未选中音符';
  $('editor-state').textContent = editorBusy ? '正在更新谱面…' : selectedIds.length ? `${selectedIds.length} 个音符` : selectedMeasure !== null ? `第 ${selectedMeasure + 1} 小节` : '点击谱面上的音符';
  updatePitchPanel(first, pending);
  updateRhythmPanel(first);
  if (selectedMeasure !== null) {
    const meter = editor.meterAt(selectedMeasure);
    $('editor-measure-title').textContent = `第 ${selectedMeasure + 1} 小节拍号`;
    $('edit-beats').value = String(meter.beats);
    $('edit-beat-type').value = String(meter.beatType);
  }
  drawEditorMarks(first, pending);
  $('apply-meter').disabled = selectedMeasure === null || editorBusy;
  $('add-tie').disabled = selectedIds.length !== 2 || editorBusy;
  $('remove-tie').disabled = selectedIds.length !== 2 || editorBusy;
  $('edit-undo').disabled = !editor.undoStack.length || editorBusy;
  $('edit-redo').disabled = !editor.redoStack.length || editorBusy;
}

function buildRhythmMenu() {
  $('rhythm-menu').innerHTML = RHYTHM_OPTIONS.map(option => `<button class="rhythm-option" type="button" role="option" data-beats="${option.beats}" aria-selected="false"><span class="rhythm-option-glyph">${noteGlyph(option.type, option.dots, { size: 22 })}</span><span class="rhythm-option-name">${option.label}</span><span class="rhythm-option-beats">${option.beats} 拍</span></button>`).join('');
}

function setRhythmMenu(open) {
  $('rhythm-menu').hidden = !open;
  $('rhythm-trigger').setAttribute('aria-expanded', String(open));
  $('rhythm-trigger').classList.toggle('open', open);
}

function nudgePendingPitch(delta) {
  const first = editor?.get(selectedIds[0]);
  if (!first?.pitched || editorBusy) return;
  if (!pendingPitch) {
    // 从音符当前的实际音高起步（不是从调号），第一次按 ♯/♭ 就是升／降半音。
    const fifths = editor.keyFifths(first.partIndex, first.measureIndex);
    pendingPitch = { diatonic: diatonicOf(first.step, first.octave), shift: first.alter - keyAlter(first.step, fifths) };
  }
  pendingPitch.shift += delta;
  renderEditorSelection();
}

function selectRecord(record, event) {
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
  pendingPitch = null;
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
    $('editor-message').textContent = '已更新。可试听或下载修改后的 MusicXML。';
  } catch (error) {
    $('editor-message').textContent = `更新失败：${error.message}`;
    toast(error.message);
  } finally { editorBusy = false; renderEditorSelection(); }
}

buildRhythmMenu();
$('practice-tab').addEventListener('click', () => setEditorMode(false));
$('edit-tab').addEventListener('click', () => setEditorMode(true));
$('score-view').addEventListener('click', event => {
  if (!editorMode || editorBusy || !osmd) return;
  const svg = event.target.closest('svg');
  if (!svg) return;
  const pageIndex = Array.from($('score-view').querySelectorAll('svg')).indexOf(svg);
  const page = osmd.GraphicSheet.MusicPages[pageIndex];
  if (!page) return;
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = event.clientX; svgPoint.y = event.clientY;
  const local = svgPoint.matrixTransform(svg.getScreenCTM().inverse());
  const point = osmd.GraphicSheet.svgToOsmd({ x: local.x, y: local.y });
  const note = osmd.GraphicSheet.GetNearestNote(point, { x: 1.9, y: 1.9 }, page);
  const center = note?.PositionAndShape?.AbsolutePosition;
  const hitNote = note && center && Math.hypot(center.x - point.x, center.y - point.y) < 1.9 ? editor.findFromSource(note.sourceNote) : null;
  const modifierClick = event.ctrlKey || event.metaKey || event.shiftKey;
  const single = selectedIds.length === 1 ? editor.get(selectedIds[0]) : null;
  // 点到的就是当前这个音时，不要重新选中它——用户是在给它挑音高。
  if (hitNote && (modifierClick || !single || hitNote.id !== single.id)) { selectRecord(hitNote, event); return; }
  // 选中音符后，点谱表现在只做「预览音高」，不直接写盘面。
  const hit = single?.pitched ? pitchLineHit(page, point) : null;
  const map = hit ? staffLineMap(hit.line) : null;
  if (single && hit && map && graphicStaffLine.get(single.id) === hit.line) {
    pendingPitch = { diatonic: map.toDiatonic(point.y), shift: 0 };
    const measureIndex = Number(hit.measure?.parentSourceMeasure?.MeasureNumber) - 1;
    if (Number.isInteger(measureIndex) && measureIndex >= 0 && measureIndex < score.measures) selectedMeasure = measureIndex;
    renderEditorSelection();
    $('editor-message').textContent = '虚线是预览；Enter 或「确认音高」写入谱面，Esc 取消。';
    return;
  }
  const measure = nearestMeasure(page, point);
  if (measure !== null && measure >= 0 && measure < score.measures) {
    selectedMeasure = measure;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) { selectedIds = []; pendingPitch = null; }
    renderEditorSelection();
  }
});
$('apply-pitch').addEventListener('click', () => {
  const first = editor?.get(selectedIds[0]);
  const pending = pendingPitchInfo(first);
  if (!first || !pending?.playable) return;
  const midi = pending.midi;
  pendingPitch = null;
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
document.addEventListener('click', event => { if (!event.target.closest?.('.rhythm-field')) setRhythmMenu(false); });
document.addEventListener('keydown', event => {
  if (!editorMode || editorBusy || !editor) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '')) return;
  if (event.key === 'Escape') {
    if (!$('rhythm-menu').hidden) { setRhythmMenu(false); event.preventDefault(); return; }
    if (pendingPitch) { pendingPitch = null; renderEditorSelection(); event.preventDefault(); }
    return;
  }
  if (event.key === 'Enter' && pendingPitch && !$('apply-pitch').disabled) {
    $('apply-pitch').click();
    event.preventDefault();
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (!editor.get(selectedIds[0])?.pitched) return;
    nudgePendingPitch(event.key === 'ArrowUp' ? 1 : -1);
    event.preventDefault();
  }
});
$('apply-meter').addEventListener('click', () => applyEditorChange(() => editor.changeMeter(selectedMeasure, Number($('edit-beats').value), Number($('edit-beat-type').value))));
$('add-tie').addEventListener('click', () => applyEditorChange(() => editor.changeTie(selectedIds[0], selectedIds[1])));
$('remove-tie').addEventListener('click', () => applyEditorChange(() => editor.changeTie(selectedIds[0], selectedIds[1], true)));
$('edit-undo').addEventListener('click', () => applyEditorChange(() => editor.undo()));
$('edit-redo').addEventListener('click', () => applyEditorChange(() => editor.redo()));
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

  exportingAudio = true;
  button.textContent = '取消导出';
  button.classList.add('active');
  const bar = $('soundfont-progress');
  try {
    const result = await player.exportAudio({ onProgress: (fraction, elapsed, total) => {
      if (!Number.isFinite(fraction)) return;
      bar.hidden = false;
      bar.value = Math.round(fraction * 100);
      $('status').textContent = `导出音频 ${Math.round(fraction * 100)}% · ${formatTime(elapsed)} / ${formatTime(total)}`;
    } });
    const suffix = `${player.mode === 'piano' ? 'piano' : 'voices'}-${enabled.map(track => track.role).join('')}`;
    const name = `${(score.title || 'choir').replace(/[\\/:*?"<>|]/g, '_')}-${suffix}.wav`;
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
