import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inspectPdf } from './pdf-pages.mjs';
import { recognitionKey } from './recognition-cache.mjs';
import JSZip from 'jszip';

const root = path.dirname(fileURLToPath(import.meta.url));
const apiOnly = process.argv.includes('--api-only');
const port = apiOnly ? 4174 : 4173;
const allowed = new Set(['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff']);
const maxBytes = 200 * 1024 * 1024; // local use: a full printed score can be far bigger than 20 MB
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.sf2': 'application/octet-stream', '.png': 'image/png', '.ico': 'image/x-icon' };
const jobs = new Map();
const activeJobs = new Map();
const recognitionCache = path.join(root, '.cache', 'recognition');
const jobTempRoot = path.join(root, '.cache', 'omr-jobs');
const steps = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];
const stepNames = { LOAD: '读取图像', BINARY: '清理图像', SCALE: '检测五线谱', GRID: '定位谱表', HEADERS: '识别谱号调号', HEADS: '识别音符', TEXTS: '识别文字', MEASURES: '识别小节', RHYTHMS: '检查节奏', PAGE: '完成本页' };

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function audiverisPath() {
  const candidates = [process.env.AUDIVERIS_BIN, path.join(root, 'tools', 'audiveris', 'Audiveris', 'Audiveris.exe'), 'C:\\Program Files\\Audiveris\\Audiveris.exe'];
  for (const candidate of candidates) if (candidate && await exists(candidate)) return candidate;
  return null;
}
async function findExports(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findExports(full));
    else if (/\.(mxl|musicxml|xml)$/i.test(entry.name)) found.push(full);
  }
  return found;
}

async function findUsableExports(dir) {
  const files = await findExports(dir);
  const usable = [];
  for (const file of files) {
    try {
      let xml;
      if (file.toLowerCase().endsWith('.mxl')) {
        const zip = await JSZip.loadAsync(await fs.readFile(file));
        const entry = Object.values(zip.files).find(item => !item.dir && item.name.endsWith('.xml') && !item.name.startsWith('META-INF/'));
        xml = await entry?.async('text');
      } else xml = await fs.readFile(file, 'utf8');
      if (xml && /<score-partwise\b/.test(xml) && /<part\b/.test(xml)) usable.push(file);
    } catch { /* Incomplete export: try another file or the raster fallback. */ }
  }
  return usable;
}

async function createJobTemp() {
  await fs.mkdir(jobTempRoot, { recursive: true });
  const temp = await fs.mkdtemp(path.join(jobTempRoot, 'job-'));
  await fs.mkdir(path.join(temp, 'java-temp'));
  return temp;
}

async function removeJobTemp(temp) {
  const base = path.resolve(jobTempRoot) + path.sep;
  if (!path.resolve(temp).startsWith(base)) throw new Error('拒绝清理识谱目录外的文件。');
  await fs.rm(temp, { recursive: true, force: true });
}

function runCommand(binary, args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, cwd: root });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data.toString()).slice(-3000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(binary)} 超时。`)); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(binary)} 失败：${output.slice(-500)}`)); });
  });
}

async function rasterizePdf(input, temp, firstPage, lastPage) {
  const prefix = path.join(temp, 'raster-page');
  const bundledPoppler = path.join(root, 'tools', 'runtime', 'poppler', 'Library', 'bin', 'pdftoppm.exe');
  const pdftoppm = await exists(bundledPoppler) ? bundledPoppler : 'pdftoppm';
  await runCommand(pdftoppm, ['-f', String(firstPage), '-l', String(lastPage), '-r', '300', '-gray', '-png', input, prefix], Math.max(180000, (lastPage - firstPage + 1) * 30000));
  const names = (await fs.readdir(temp)).filter(name => /^raster-page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!names.length) throw new Error('PDF 转图像时没有生成页面。');
  const tiff = path.join(temp, 'raster-score.tif');
  await runCommand('python', [path.join(root, 'scripts', 'make-multipage-tiff.py'), tiff, ...names.map(name => path.join(temp, name))], Math.max(180000, names.length * 15000));
  return tiff;
}

function runAudiveris(binary, input, output, options = {}) {
  return new Promise((resolve, reject) => {
    // Only recognize explicit tuplet digits; do not invent tuplets to fit a bar.
    // Enable fingering classification so piano finger numbers can compete with tuplets.
    const args = ['-batch', '-export', '-swap',
      '-constant', 'org.audiveris.omr.sheet.ProcessingSwitches.implicitTuplets=false',
      '-constant', 'org.audiveris.omr.sheet.ProcessingSwitches.fingerings=true'];
    if (path.extname(input).toLowerCase() === '.pdf') args.push('-constant', 'org.audiveris.omr.image.ImageLoading.pdfResolution=400');
    if (options.sheets) args.push('-sheets', options.sheets);
    args.push('-output', output, '--', input);
    const javaTemp = options.javaTemp;
    const javaOption = javaTemp ? `-Djava.io.tmpdir="${javaTemp.replace(/\\/g, '/')}"` : '';
    const env = javaOption ? { ...process.env, JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, javaOption].filter(Boolean).join(' ') } : process.env;
    const child = spawn(binary, args, { shell: binary.toLowerCase().endsWith('.bat'), windowsHide: true, cwd: root, env });
    let log = '';
    let pending = '';
    const append = data => {
      const chunk = data.toString();
      log = (log + chunk).slice(-12000);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const page = Number(line.match(/\[[^\]]+#(\d+)\]/)?.[1]);
        const step = line.match(/StepMonitoring\s+\d+\s+\|\s+([A-Z_]+)/)?.[1];
        if (step && steps.includes(step)) options.onProgress?.({ page: page || 1, step, stage: stepNames[step] || '识谱中' });
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = options.timeout || 180000;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`识谱超过 ${Math.round(timeout / 60000)} 分钟，请缩小页数后重试。`)); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', async code => {
      clearTimeout(timer);
      try {
        if ((await findUsableExports(output)).length) { resolve(log); return; }
        if (code === 0) { reject(new Error('Audiveris 已处理页面，但没有导出 MusicXML。')); return; }
        if (/Load error on .*basic-classifier|network\.norms.*null|AccessDeniedException.*AbstractClassifier/.test(log)) reject(new Error('Audiveris 无法写入临时模型文件。'));
        else if (/Created scores: \[\]/.test(log)) reject(new Error('Audiveris 没有找到可识别的谱表。'));
        else if (/Error processing stub|Could not export since transcription did not complete|Measure\.purgeVoices/.test(log)) reject(new Error('Audiveris 在解析小节时出错。'));
        else if (/too low interline|Sheet ignored/i.test(log)) reject(new Error('谱表线太细，无法可靠识别。'));
        else reject(new Error(`Audiveris 识谱失败（退出码 ${code}）。${log.match(/(?:ERROR|WARN).*\|[^\r\n]+/g)?.at(-1)?.slice(-250) || '请尝试上传更清晰的谱页。'}`));
      } catch (error) { reject(error); }
    });
  });
}

// Repairs the meter and bar lengths of a recognised score (scripts/repair-measures.py).
async function runMeasureRepair(selected, output) {
  const extension = path.extname(selected).toLowerCase();
  if (!['.mxl', '.musicxml', '.xml'].includes(extension)) return null;
  const target = path.join(output, `repaired${extension === '.xml' ? '.musicxml' : extension}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [path.join(root, 'scripts', 'repair-measures.py'), selected, target], { windowsHide: true, cwd: root });
    let log = '';
    const append = data => { log = (log + data.toString()).slice(-4000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => { child.kill(); reject(new Error('小节校正超时。')); }, 600000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(log.trim().split(/\r?\n/).slice(-2).join(' ') || `退出码 ${code}`));
    });
  });
  return await exists(target) ? target : null;
}

async function recoverCrossNoteheads(pdf, selected, output) {
  if (path.extname(pdf).toLowerCase() !== '.pdf' || path.extname(selected).toLowerCase() !== '.mxl') return { file: selected, count: 0 };
  const target = path.join(output, 'cross-noteheads.mxl');
  const count = await new Promise((resolve, reject) => {
    const child = spawn('python', [path.join(root, 'scripts', 'recover-x-noteheads.py'), pdf, selected, target], { windowsHide: true, cwd: root });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('叉形符头补识别超时。')); }, 600000);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr || `叉形符头补识别退出码 ${code}`));
      else resolve(Number(stdout.trim()) || 0);
    });
  });
  return { file: count ? target : selected, count };
}

async function readUpload(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('文件不能超过 200 MB。'), { status: 413 });
    chunks.push(chunk);
  }
  if (!bytes) throw Object.assign(new Error('上传文件为空。'), { status: 400 });
  return Buffer.concat(chunks);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function createJob(req, res, url) {
  const ext = (url.searchParams.get('ext') || '').toLowerCase();
  if (!allowed.has(ext)) throw Object.assign(new Error('仅支持 PDF、PNG、JPG、TIFF 扫描谱。'), { status: 400 });
  // Recognising the first pages of a long score is a quick way to judge the
  // result before committing to a full run.
  const pageLimit = Math.max(0, Math.min(999, Number(url.searchParams.get('pages')) || 0));
  const body = await readUpload(req);
  // A partial run must not touch the cache, or a later full upload of the same
  // file would silently get the truncated score back.
  const key = pageLimit ? `partial-${pageLimit}-${recognitionKey(ext, body)}` : recognitionKey(ext, body);
  const cachedJob = activeJobs.get(key);
  if (cachedJob?.state === 'working') { sendJson(res, 202, { id: cachedJob.id }); return; }
  const cached = await readCachedResult(key);
  if (cached) {
    const id = randomUUID();
    jobs.set(id, { id, state: 'done', stage: '已载入本地识谱结果', startedAt: Date.now(), page: 0, pagesDone: 0, totalPages: 0, firstPage: 1, lastPage: 1, detected: false, step: '', body: cached.body, extension: cached.extension, cached: true, error: '' });
    sendJson(res, 202, { id });
    setTimeout(() => jobs.delete(id), 6 * 60 * 60 * 1000).unref();
    return;
  }
  const bin = await audiverisPath();
  if (!bin) throw Object.assign(new Error('本机尚未配置 Audiveris。'), { status: 503 });
  const temp = await createJobTemp();
  const input = path.join(temp, `score.${ext}`);
  await fs.writeFile(input, body);
  const id = randomUUID();
  const job = { id, pageLimit, state: 'working', stage: '正在分析文件', startedAt: Date.now(), page: 0, pagesDone: 0, totalPages: 0, firstPage: 1, lastPage: 1, detected: false, step: '', body: null, cached: false, error: '' };
  jobs.set(id, job);
  activeJobs.set(key, job);
  sendJson(res, 202, { id });
  processJob(job, bin, input, temp, key).catch(error => { job.state = 'failed'; job.error = error.message || '识谱失败。'; job.stage = '识谱失败'; }).finally(() => {
    activeJobs.delete(key);
    removeJobTemp(temp).catch(error => console.warn(`清理识谱目录失败：${error.message}`));
    setTimeout(() => jobs.delete(id), 6 * 60 * 60 * 1000).unref();
  });
}

async function readCachedResult(key) {
  for (const extension of ['musicxml', 'mxl']) {
    const file = path.join(recognitionCache, `${key}.${extension}`);
    try { return { body: await fs.readFile(file), extension }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

async function processJob(job, bin, input, temp, key) {
  const output = path.join(temp, 'output');
  await fs.mkdir(output);
  const javaTemp = path.join(temp, 'java-temp');
  let sheets;
  let preferRaster = false;
  if (path.extname(input).toLowerCase() === '.pdf') {
    const pdf = await inspectPdf(input, temp, progress => { job.stage = progress.stage; job.totalPages = progress.totalPages; });
    job.firstPage = pdf.firstPage;
    job.lastPage = pdf.lastPage;
    job.detected = pdf.detected;
    job.totalPages = pdf.pages;
    preferRaster = pdf.preferRaster;
    sheets = `${pdf.firstPage}-${pdf.lastPage}`;
    job.stage = pdf.detected ? `找到第 ${pdf.firstPage}–${pdf.lastPage} 页五线谱，开始识谱` : '未能自动定位五线谱页，尝试识别全部页面';
  } else { job.firstPage = 1; job.lastPage = 1; job.totalPages = 1; job.stage = '开始识谱'; }
  if (job.pageLimit && job.lastPage - job.firstPage + 1 > job.pageLimit) {
    job.lastPage = job.firstPage + job.pageLimit - 1;
    job.stage = `只识别前 ${job.pageLimit} 页（共 ${job.totalPages} 页）`;
  }
  const count = job.lastPage - job.firstPage + 1;
  const timeout = Math.min(6 * 60 * 60 * 1000, Math.max(600000, count * 300000));
  const onProgress = offset => ({ page, step, stage }) => {
    const originalPage = page + offset;
    job.page = originalPage;
    job.step = step;
    job.pagesDone = Math.min(count, Math.max(0, originalPage - job.firstPage + (step === 'PAGE' ? 1 : 0)));
    job.stage = `第 ${Math.max(1, originalPage - job.firstPage + 1)} / ${count} 页 · ${stage}`;
  };
  let selected;
  const pdfInput = path.extname(input).toLowerCase() === '.pdf';
  const methods = pdfInput ? (preferRaster ? ['raster', 'direct'] : ['direct', 'raster']) : ['direct'];
  const failures = [];
  for (const method of methods) {
    const methodOutput = path.join(output, method);
    await fs.mkdir(methodOutput);
    job.page = 0;
    job.pagesDone = 0;
    job.stage = method === 'raster' ? '正在用图像识别 PDF 乐谱' : pdfInput ? '正在直接读取 PDF 乐谱' : '正在识别图像乐谱';
    try {
      const source = method === 'raster' ? await rasterizePdf(input, temp, job.firstPage, job.lastPage) : input;
      await runAudiveris(bin, source, methodOutput, { sheets: method === 'direct' ? sheets : undefined, timeout, javaTemp, onProgress: onProgress(method === 'raster' ? job.firstPage - 1 : 0) });
      const results = await findUsableExports(methodOutput);
      selected = results.find(file => file.toLowerCase().endsWith('.mxl')) || results[0];
      if (selected) break;
      throw new Error('没有生成可读取的 MusicXML。');
    } catch (error) {
      failures.push(`${method === 'raster' ? '图像识谱' : '直接识谱'}：${error.message}`);
      if (methods.length > 1 && method !== methods.at(-1)) job.stage = '首次识谱失败，正在切换识谱方式';
    }
  }
  if (!selected) throw new Error(failures.join('；') || '没有生成 MusicXML。');
  job.stage = '正在整理 MusicXML';
  // Fix the meter and bar lengths before adding the breath noteheads: the
  // cross-notehead pass lines measures up with the printed bar numbers, so it
  // wants a score whose measure count already matches the page.
  job.stage = '正在校正拍号与小节长度';
  try {
    const repaired = await runMeasureRepair(selected, output);
    if (repaired) { selected = repaired; job.repaired = true; }
  } catch (error) { console.warn(`小节校正失败，使用原始识谱结果：${error.message}`); }
  if (path.extname(input).toLowerCase() === '.pdf') {
    job.stage = '正在检查叉形符头与气音';
    try {
      const recovered = await recoverCrossNoteheads(input, selected, output);
      selected = recovered.file;
      job.recoveredCrossheads = recovered.count;
    } catch (error) { console.warn(`叉形符头补识别失败，使用原识谱结果：${error.message}`); }
  }
  job.body = await fs.readFile(selected);
  job.extension = path.extname(selected).slice(1);
  try {
    await fs.mkdir(recognitionCache, { recursive: true });
    const target = path.join(recognitionCache, `${key}.${job.extension}`);
    const pending = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(pending, job.body);
      await fs.rename(pending, target);
    } finally { await fs.rm(pending, { force: true }); }
  } catch (error) { console.warn(`无法缓存识谱结果：${error.message}`); }
  job.pagesDone = count;
  job.state = 'done';
  job.stage = '识谱完成';
}

function jobResponse(req, res, url) {
  const match = url.pathname.match(/^\/api\/recognize-jobs\/([^/]+)(?:\/(result))?$/);
  const job = jobs.get(match?.[1]);
  if (!job) { sendJson(res, 404, { error: '识谱任务不存在或已过期。' }); return; }
  if (match[2] === 'result') {
    if (job.state !== 'done') { sendJson(res, 409, { error: job.error || '识谱尚未完成。' }); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': job.body.length, 'X-Score-Extension': job.extension });
    res.end(job.body);
    return;
  }
  sendJson(res, 200, { state: job.state, stage: job.stage, page: job.page, pagesDone: job.pagesDone, totalPages: job.totalPages, firstPage: job.firstPage, lastPage: job.lastPage, detected: job.detected, step: job.step, cached: job.cached, error: job.error, elapsedSeconds: Math.floor((Date.now() - job.startedAt) / 1000) });
}

async function recognize(req, res, url) {
  const ext = (url.searchParams.get('ext') || '').toLowerCase();
  if (!allowed.has(ext)) throw Object.assign(new Error('仅支持 PDF、PNG、JPG、TIFF 扫描谱。'), { status: 400 });
  const bin = await audiverisPath();
  if (!bin) throw Object.assign(new Error('本机尚未配置 Audiveris，当前可直接导入 MusicXML。'), { status: 503 });
  const body = await readUpload(req);
  const key = recognitionKey(ext, body);
  const cached = await readCachedResult(key);
  if (cached) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': cached.body.length, 'X-Score-Extension': cached.extension });
    res.end(cached.body);
    return;
  }
  const temp = await createJobTemp();
  try {
    const input = path.join(temp, `score.${ext}`);
    await fs.writeFile(input, body);
    const job = { state: 'working', stage: '', page: 0, pagesDone: 0, totalPages: 0, firstPage: 1, lastPage: 1, detected: false, step: '' };
    await processJob(job, bin, input, temp, key);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': job.body.length, 'X-Score-Extension': job.extension });
    res.end(job.body);
  } finally {
    await removeJobTemp(temp);
  }
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const target = path.resolve(root, 'dist', `.${pathname === '/' ? '/index.html' : pathname}`);
  const distRoot = path.resolve(root, 'dist');
  if (!target.startsWith(distRoot + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Content-Length': stat.size });
    createReadStream(target).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/recognize') await recognize(req, res, url);
    else if (req.method === 'GET' && url.pathname === '/api/health') {
      // The static build calls this to decide whether PDF recognition is on the
      // menu or whether it has to stay a local-only feature.
      const bin = await audiverisPath();
      sendJson(res, 200, { ok: true, omr: Boolean(bin) });
    } else if (req.method === 'POST' && url.pathname === '/api/recognize-jobs') await createJob(req, res, url);
    else if (req.method === 'GET' && url.pathname.startsWith('/api/recognize-jobs/')) jobResponse(req, res, url);
    else if (req.method === 'GET' && !apiOnly) await serveStatic(req, res, url);
    else { res.writeHead(404); res.end('Not found'); }
  } catch (error) {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || '识谱失败。' }));
  }
}).listen(port, '127.0.0.1', () => console.log(`ChoirSinger ${apiOnly ? 'OMR API' : 'site'} at http://127.0.0.1:${port}`));
