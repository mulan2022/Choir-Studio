// Builds the static site for a GitHub Pages project page and force-pushes it to
// the gh-pages branch as a single commit (the 54 MB sound bank makes history
// expensive, so the branch is always replaced instead of appended to).
//
//   npm run deploy                    # uses origin + repo name for the base path
//   PAGES_REMOTE=<url|remote> npm run deploy
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const work = path.join(root, '.cache', 'pages-work');
const remoteArg = process.env.PAGES_REMOTE || 'origin';
const branch = process.env.PAGES_BRANCH || 'gh-pages';

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

let remoteUrl = remoteArg;
try {
  if (!/[:/]/.test(remoteArg)) remoteUrl = git(['remote', 'get-url', remoteArg]);
} catch { /* keep the raw value; the user may have passed a URL */ }
if (!remoteUrl) throw new Error('找不到远程仓库地址：先 git remote add origin <url>，或用 PAGES_REMOTE=<url> npm run deploy');

const repoName = remoteUrl.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop();
const base = `/${repoName}/`;
console.log(`remote ${remoteUrl}\nbase   ${base}`);

if (!fs.existsSync(path.join(root, 'public', 'soundfonts', 'choir-practice-lite.sf2'))) {
  throw new Error('缺少 public/soundfonts/choir-practice-lite.sf2：先 npm run soundfont（或 npm run fetch:soundfont）。');
}

const dist = path.join(root, '.cache', 'pages-dist');
execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_BASE: base, VITE_STATIC: '1' },
});

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.cpSync(dist, work, { recursive: true });
fs.writeFileSync(path.join(work, '.nojekyll'), '');
fs.writeFileSync(path.join(work, '404.html'), fs.readFileSync(path.join(dist, 'index.html')));

const mb = directory => (fs.readdirSync(directory, { recursive: true })
  .reduce((sum, entry) => { const file = path.join(directory, entry); return sum + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0); }, 0) / 1048576).toFixed(1);
console.log(`site ${mb(work)} MB`);

const run = args => execFileSync('git', args, { cwd: work, stdio: 'inherit' });
run(['init', '-q']);
run(['checkout', '-q', '-b', branch]);
run(['add', '-A']);
run(['-c', 'user.name=Choir Studio', '-c', 'user.email=noreply@github.com', 'commit', '-q', '-m', `Deploy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`]);
run(['push', '-f', remoteUrl, `${branch}:${branch}`]);
console.log(`\n已推送到 ${branch}。启用 Pages：仓库 Settings → Pages → Source 选 “Deploy from a branch”，分支 ${branch}，目录 / (root)`);
