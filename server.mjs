import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { inspectPdf } from './pdf-pages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const apiOnly = process.argv.includes('--api-only');
const port = apiOnly ? 4174 : 4173;
const allowed = new Set(['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff']);
const maxBytes = 20 * 1024 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.sf2': 'application/octet-stream', '.png': 'image/png', '.ico': 'image/x-icon' };
const jobs = new Map();
const activeJobs = new Map();
const recognitionCache = path.join(root, '.cache', 'recognition');
// Cache keys include the OMR postprocessor version so a changed recovery
// algorithm never serves an older score for an identical PDF upload.
const recognitionVersion = 'cross-noteheads-v2';
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

function runAudiveris(binary, input, output, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-batch', '-export', '-swap'];
    if (path.extname(input).toLowerCase() === '.pdf') args.push('-constant', 'org.audiveris.omr.image.ImageLoading.pdfResolution=400');
    if (options.sheets) args.push('-sheets', options.sheets);
    args.push('-output', output, '--', input);
    const child = spawn(binary, args, { shell: binary.toLowerCase().endsWith('.bat'), windowsHide: true, cwd: root });
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
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else if (/too low interline|Sheet ignored/i.test(log)) reject(new Error('谱表线太细，无法可靠识别。请上传更清晰的 PDF 或 MusicXML。'));
      else if (/Could not export since transcription did not complete|Created scores: \[\]/.test(log)) reject(new Error('没有检测到可导出的乐谱；请检查所选页是否包含五线谱。'));
      else reject(new Error(`Audiveris 识谱失败（退出码 ${code}）。${log.match(/(?:ERROR|WARN).*\|[^\r\n]+/g)?.at(-1)?.slice(-250) || '请尝试缩小页数或上传 MusicXML。'}`));
    });
  });
}

async function recoverCrossNoteheads(pdf, selected, output) {
  if (path.extname(pdf).toLowerCase() !== '.pdf' || path.extname(selected).toLowerCase() !== '.mxl') return { file: selected, count: 0 };
  const target = path.join(output, 'cross-noteheads.mxl');
  const count = await new Promise((resolve, reject) => {
    const child = spawn('python', [path.join(root, 'scripts', 'recover-x-noteheads.py'), pdf, selected, target], { windowsHide: true, cwd: root });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('叉形符头补识别超时。')); }, 180000);
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
    if (bytes > maxBytes) throw Object.assign(new Error('文件不能超过 20 MB。'), { status: 413 });
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
  const body = await readUpload(req);
  const key = createHash('sha256').update(recognitionVersion).update('\0').update(ext).update('\0').update(body).digest('hex');
  const cachedJob = activeJobs.get(key);
  if (cachedJob?.state === 'working') { sendJson(res, 202, { id: cachedJob.id }); return; }
  const cached = await readCachedResult(key);
  if (cached) {
    const id = randomUUID();
    jobs.set(id, { id, state: 'done', stage: '已载入本地识谱结果', startedAt: Date.now(), page: 0, pagesDone: 0, totalPages: 0, firstPage: 1, lastPage: 1, detected: false, step: '', body: cached.body, extension: cached.extension, cached: true, error: '' });
    sendJson(res, 202, { id });
    setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
    return;
  }
  const bin = await audiverisPath();
  if (!bin) throw Object.assign(new Error('本机尚未配置 Audiveris。'), { status: 503 });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'choirsinger-'));
  const input = path.join(temp, `score.${ext}`);
  await fs.writeFile(input, body);
  const id = randomUUID();
  const job = { id, state: 'working', stage: '正在分析文件', startedAt: Date.now(), page: 0, pagesDone: 0, totalPages: 0, firstPage: 1, lastPage: 1, detected: false, step: '', body: null, cached: false, error: '' };
  jobs.set(id, job);
  activeJobs.set(key, job);
  sendJson(res, 202, { id });
  processJob(job, bin, input, temp, key).catch(error => { job.state = 'failed'; job.error = error.message || '识谱失败。'; job.stage = '识谱失败'; }).finally(() => {
    activeJobs.delete(key);
    fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
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
  let sheets;
  if (path.extname(input).toLowerCase() === '.pdf') {
    const pdf = await inspectPdf(input, temp, progress => { job.stage = progress.stage; job.totalPages = progress.totalPages; });
    job.firstPage = pdf.firstPage;
    job.lastPage = pdf.lastPage;
    job.detected = pdf.detected;
    job.totalPages = pdf.pages;
    sheets = `${pdf.firstPage}-${pdf.lastPage}`;
    job.stage = pdf.detected ? `找到第 ${pdf.firstPage}–${pdf.lastPage} 页五线谱，开始识谱` : '未能自动定位五线谱页，尝试识别全部页面';
  } else { job.firstPage = 1; job.lastPage = 1; job.totalPages = 1; job.stage = '开始识谱'; }
  const count = job.lastPage - job.firstPage + 1;
  await runAudiveris(bin, input, output, {
    sheets,
    timeout: Math.min(30 * 60 * 1000, Math.max(180000, count * 180000)),
    onProgress: ({ page, step, stage }) => {
      job.page = page;
      job.step = step;
      job.pagesDone = Math.min(count, Math.max(0, page - job.firstPage + (step === 'PAGE' ? 1 : 0)));
      job.stage = `第 ${Math.max(1, page - job.firstPage + 1)} / ${count} 页 · ${stage}`;
    },
  });
  job.stage = '正在整理 MusicXML';
  const results = await findExports(output);
  if (!results.length) throw new Error('识谱结束，但没有生成 MusicXML。请尝试上传更清晰的谱页。');
  let selected = results.find(f => f.toLowerCase().endsWith('.mxl')) || results[0];
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'choirsinger-'));
  try {
    const body = await readUpload(req);
    const input = path.join(temp, `score.${ext}`);
    const output = path.join(temp, 'output');
    await fs.mkdir(output);
    await fs.writeFile(input, body);
    await runAudiveris(bin, input, output);
    const results = await findExports(output);
    if (!results.length) throw new Error('识谱已结束，但未生成 MusicXML。请换一份清晰的印刷乐谱。');
    let selected = results.find(f => f.toLowerCase().endsWith('.mxl')) || results[0];
    if (ext === 'pdf') {
      try { selected = (await recoverCrossNoteheads(input, selected, output)).file; }
      catch (error) { console.warn(`叉形符头补识别失败，使用原识谱结果：${error.message}`); }
    }
    const exported = await fs.readFile(selected);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': exported.length, 'X-Score-Extension': path.extname(selected).slice(1) });
    res.end(exported);
  } finally {
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('choirsinger-')) await fs.rm(temp, { recursive: true, force: true });
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
