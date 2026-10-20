// Assembles the offline, double-click-to-run Windows package:
// bundled Node, Python (with Pillow), Poppler, Audiveris, the choir sound bank
// and the built site — everything the local version needs, nothing to install.
//
//   npm run pack
//
// Inputs it expects to find (all gitignored):
//   public/soundfonts/choir-practice-lite.sf2   built by npm run soundfont
//   tools/audiveris/Audiveris                   unpacked by scripts/setup-audiveris.ps1
//   tools/runtime/poppler/Library/bin           Poppler for Windows
//   tools/runtime/python/python.exe             Python embeddable + Pillow
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const name = '和声间-win64';
const out = path.join(root, 'release', name);
const zipName = path.join(root, 'release', `${name}.zip`);
const mb = bytes => (bytes / 1048576).toFixed(1);
const sizeOf = dir => fs.readdirSync(dir, { recursive: true })
  .reduce((sum, entry) => { const file = path.join(dir, entry); return sum + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0); }, 0);

function require_(relative, hint) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) throw new Error(`缺少 ${relative}${hint ? `\n  ${hint}` : ''}`);
  return full;
}

// --- inputs ---------------------------------------------------------------
const bank = require_('public/soundfonts/choir-practice-lite.sf2', 'run: npm run soundfont');
const audiveris = require_('tools/audiveris/Audiveris', 'run: powershell -File scripts/setup-audiveris.ps1');
const poppler = require_('tools/runtime/poppler/Library/bin', 'download Poppler for Windows into tools/runtime/poppler');
const nodeExe = process.execPath;

// The notehead recovery script needs CPython + Pillow. Prefer the machine's own
// installation (it already has Pillow) and trim the stdlib down to what runs.
function findPythonHome() {
  if (process.env.PYTHON_HOME) return process.env.PYTHON_HOME;
  const embeddable = path.join(root, 'tools', 'runtime', 'python');
  if (fs.existsSync(path.join(embeddable, 'python.exe'))) return embeddable;
  try {
    const found = execFileSync('where', ['python'], { encoding: 'utf8' }).split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (found) return path.dirname(found);
  } catch { /* fall through */ }
  throw new Error('找不到 Python：设置 PYTHON_HOME 指向 Python 3.13 安装目录，或用 tools/runtime/python 放一份嵌入式 Python。');
}
const pythonHome = findPythonHome();
const pythonExe = path.join(pythonHome, 'python.exe');
if (!fs.existsSync(pythonExe)) throw new Error(`${pythonHome} 里没有 python.exe`);

// --- build the site -------------------------------------------------------
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const dist = require_('dist/index.html');

// --- copy -----------------------------------------------------------------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'runtime', 'python', 'Lib', 'site-packages'), { recursive: true });
fs.mkdirSync(path.join(out, 'tools', 'audiveris'), { recursive: true });
fs.mkdirSync(path.join(out, 'tools', 'poppler'), { recursive: true });
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });

for (const file of ['server.mjs', 'pdf-pages.mjs']) fs.copyFileSync(path.join(root, file), path.join(out, file));
fs.copyFileSync(path.join(root, 'scripts', 'recover-x-noteheads.py'), path.join(out, 'scripts', 'recover-x-noteheads.py'));
fs.cpSync(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true });
fs.copyFileSync(nodeExe, path.join(out, 'runtime', 'node.exe'));
const nodeLicense = path.join(path.dirname(nodeExe), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(out, 'runtime', 'node-LICENSE.txt'));

fs.cpSync(audiveris, path.join(out, 'tools', 'audiveris', 'Audiveris'), { recursive: true });
fs.cpSync(path.join(poppler), path.join(out, 'tools', 'poppler', 'Library', 'bin'), { recursive: true });
const popplerShare = path.join(path.dirname(poppler), 'share');
if (fs.existsSync(popplerShare)) fs.cpSync(popplerShare, path.join(out, 'tools', 'poppler', 'Library', 'share'), { recursive: true });

// Python: the interpreter plus a trimmed standard library. Tests, Tk, pip and
// bytecode caches are all dead weight for one script that only needs zipfile,
// ElementTree, statistics and Pillow.
const pythonOut = path.join(out, 'runtime', 'python');
const skipLib = /^(site-packages|test|idlelib|tkinter|turtledemo|lib2to3|ensurepip|unittest|pydoc_data|distutils|__pycache__)[\\/]/i;
fs.mkdirSync(pythonOut, { recursive: true });
for (const entry of fs.readdirSync(pythonHome, { withFileTypes: true })) {
  if (entry.isDirectory()) continue;
  if (!/\.(exe|dll)$/i.test(entry.name) && !/^(LICENSE|python\d+\._pth)/i.test(entry.name)) continue;
  fs.copyFileSync(path.join(pythonHome, entry.name), path.join(pythonOut, entry.name));
}
// Standard-library extension modules live in DLLs/ (builtin ones are in the dll).
const dllsSource = path.join(pythonHome, 'DLLs');
if (fs.existsSync(dllsSource)) fs.cpSync(dllsSource, path.join(pythonOut, 'DLLs'), { recursive: true });
const libSource = path.join(pythonHome, 'Lib');
if (fs.existsSync(libSource)) {
  fs.cpSync(libSource, path.join(pythonOut, 'Lib'), {
    recursive: true,
    filter: source => {
      const relative = path.relative(libSource, source).replace(/\\/g, '/');
      if (!relative) return true;
      return !skipLib.test(`${relative}/`) && !/\.pyc$/i.test(relative);
    },
  });
}
const pillowSource = path.join(pythonHome, 'Lib', 'site-packages', 'PIL');
if (fs.existsSync(pillowSource)) {
  const pillowOut = path.join(pythonOut, 'Lib', 'site-packages', 'PIL');
  fs.mkdirSync(pillowOut, { recursive: true });
  for (const entry of fs.readdirSync(pillowSource, { withFileTypes: true })) {
    if (/_avif|_webp|_imagingtk/i.test(entry.name)) continue;
    const from = path.join(pillowSource, entry.name);
    const to = path.join(pillowOut, entry.name);
    if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
}

// --- launcher and notes ---------------------------------------------------
const startCmd = `@echo off
chcp 65001 >nul
title 和声间 · 合唱分声部训练（本地版）
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%runtime;%ROOT%runtime\\python;%ROOT%tools\\poppler\\Library\\bin;%PATH%"
set "AUDIVERIS_BIN=%ROOT%tools\\audiveris\\Audiveris\\Audiveris.exe"
if not exist "%ROOT%dist\\index.html" goto broken
echo Starting Harmonic Room on http://127.0.0.1:4173/
echo Close this window to stop the server.
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4173/"
"%ROOT%runtime\\node.exe" "%ROOT%server.mjs"
echo.
echo Server stopped.
pause
exit /b 0
:broken
echo Site files are missing. Please unpack the whole archive again.
pause
exit /b 1
`;
fs.writeFileSync(path.join(out, '启动.cmd'), startCmd.replace(/\n/g, '\r\n'));

fs.writeFileSync(path.join(out, '使用说明.txt'), `和声间 · 合唱分声部训练（Windows 本地版）
================================================

怎么用
  1. 解压整个压缩包到任意目录（路径里最好别有中文以外的奇怪字符，放桌面或 D 盘都行）。
  2. 双击「启动.cmd」。会弹出一个黑色窗口并自动打开浏览器。
     浏览器地址是 http://127.0.0.1:4173/ —— 这个窗口就是服务本身，关掉它程序就停了。
  3. 上传 MusicXML（.musicxml/.xml/.mxl）直接听；上传 PDF 或扫描图片会先自动识谱，
     第一次可能要几分钟，之后同样的文件会走缓存，几秒就出。

能做什么
  · 分声部开关、独奏、每个声部调音量、整体变速
  · 人声版（真人采样 doo）与钢琴版一键切换
  · 谱面跟随播放，点击小节/时间轴跳转
  · 导出音频：按当前声部开关与音量混成 48 kHz WAV（导出时长约等于曲长）
  · 识谱后的乐谱可以改音高、时值、拍号和延音线，再导出 MusicXML

别删的东西
  runtime\\        自带的 Node 和 Python，删了程序起不来
  tools\\          识谱引擎 Audiveris、PDF 渲染 Poppler
  dist\\           网页本体和合唱音色（约 54 MB）

占用的东西
  只监听本机 127.0.0.1:4173，不联网、不需要管理员权限，也不会往系统里装任何东西。
  识谱结果缓存在本目录的 .cache\\recognition\\ 里，想清空直接删这个文件夹。

授权
  · 合唱音色来自 Choir-practice-midi-player，原始人声采样 CC BY-NC-ND 4.0、
    编译声库 CC BY-NC-SA 4.0，仅限非商业使用，版权归 Vocal Group Jammin' 与 Birkeeper。
  · Audiveris（AGPL-3.0）、Poppler（GPL-2.0）、Node.js（MIT）、Pillow（HPND）各自保留原有授权，
    详见 LICENSES.txt。
  · 上传乐谱的版权归上传者自行确认。

版本：${new Date().toISOString().slice(0, 10)}
`);

fs.writeFileSync(path.join(out, 'LICENSES.txt'), `本安装包内含以下第三方组件，均保留其原始授权：

Node.js            MIT                 https://github.com/nodejs/node/blob/main/LICENSE
Python             PSF-2.0             https://docs.python.org/3/license.html
Pillow             HPND                https://github.com/python-pillow/Pillow/blob/main/LICENSE
Poppler            GPL-2.0-or-later    https://poppler.freedesktop.org/
Audiveris          AGPL-3.0-or-later   https://github.com/Audiveris/audiveris
spessasynth_lib    Apache-2.0          https://github.com/spessasus/spessasynth_lib
OpenSheetMusicDisplay BSD-3-Clause     https://github.com/opensheetmusicdisplay/opensheetmusicdisplay

合唱音色（dist\\soundfonts\\choir-practice-lite.sf2）
  来源：Choir-practice-midi-player（birkeeper）的 Choir_practice.sf2
  原始独唱人声采样 CC BY-NC-ND 4.0；编译声库 CC BY-NC-SA 4.0
  版权归 Vocal Group Jammin' 与 Birkeeper 所有，仅限非商业用途。
  https://github.com/birkeeper/Choir-practice-midi-player/blob/main/LICENSE
`);

// --- zip ------------------------------------------------------------------
fs.rmSync(zipName, { force: true });
const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${out.replace(/'/g, "''")}','${zipName.replace(/'/g, "''")}',[System.IO.Compression.CompressionLevel]::Optimal,$true)`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

console.log(`\n${name}/  ${mb(sizeOf(out))} MB`);
console.log(`${path.basename(zipName)}  ${mb(fs.statSync(zipName).size)} MB`);
