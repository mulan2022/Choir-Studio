# 和声间 · 合唱分声部训练原型

一个在本机处理乐谱的最小原型。上传 MusicXML（`.musicxml`、`.xml`、`.mxl`）或印刷谱 PDF／图片后可预览乐谱，按声部开关、独奏、调节音量与速度，并切换钢琴和真人采样人声版。项目自带四声部示例谱。

## 运行

需要 Node.js 20.19+。PDF 自动选页需要 Poppler 的 `pdfinfo` 和 `pdftoppm` 在 `PATH` 中。

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\setup-audiveris.ps1
npm run dev
```

打开 http://127.0.0.1:5187/ 。Audiveris 安装包约 85 MB，解压在本项目的 `tools/`，不修改系统 Java 环境。第一次播放需下载约 54 MB 的声库（状态栏显示百分比，下载后存进 Cache Storage，再次进入直接开始）。`npm run build` 生成 `dist/`，`npm start` 可运行打包后的本地网站。

## 部署（GitHub Pages）

线上版是纯静态站：MusicXML 播放、分声部、变速、谱面跟随都在浏览器里跑；**PDF／图片识谱需要本机服务，线上不可用**，页面会在侧栏直接写明，并且探活 `/api/health` 失败时给出提示而不是报网络错误。

1. 把 `public/soundfonts/choir-practice-lite.sf2`（约 54 MB）上传到 Cloudflare R2 或 GitHub Release，拿到直链；它不进 git 历史（见 `.gitignore`）。
2. 仓库 → Settings → Secrets and variables → Actions → Variables 里加 `SOUNDFONT_URL`，值是那个直链。
3. Settings → Pages → Source 选 **GitHub Actions**，推送到 `main` 即自动构建发布，站点在 `https://<用户名>.github.io/<仓库名>/`。

`.github/workflows/pages.yml` 会在构建前把声库下载进 `public/soundfonts/`，所以线上是**同源**加载，不需要配 CORS；想直接走 CDN 的话，构建时设 `VITE_SOUNDFONT_URL=<直链>` 即可，此时 CDN 必须允许跨域。

构建时的两个环境变量：

- `VITE_BASE=/<仓库名>/`：项目页要挂在子路径下，workflow 自动按仓库名填。
- `VITE_STATIC=1`：声明这是没有识谱后端的静态版，页面直接显示「线上试听版」，不再去探活 `/api/health`（省掉浏览器控制台里那条 404）。本地 `npm run build` 不设它，所以 `npm start` 打包版仍会探测本机服务、能力与 `npm run dev` 一致。

本地想预演线上效果：`VITE_BASE=/ VITE_STATIC=1 npm run build`，再把 `dist/` 用任意静态服务器打开即可。

本地没有声库时用 `SOUNDFONT_URL=<直链> npm run fetch:soundfont` 补齐。


## 已支持

- MusicXML `score-partwise`，含多声部、同小节内 `<backup>`、歌词显示和速度标记。
- PDF、PNG、JPG、TIFF 通过本机 Audiveris 识别为 MusicXML，再进入同一播放器（单文件不超过 20 MB）。PDF 会先查找连续的五线谱页，跳过封面、说明和简谱页；识谱时显示当前页、完成页数和耗时。相同文件的成功识谱结果会保存在 `.cache/recognition/`，再次上传直接读取。
- 延音线跨小节连续播放。识谱校对模式暂不启用跳音、颤音、滑音和力度处理。
- 每条声部独立音轨，任意组合、独奏、音量与速度控制。
- 钢琴版与“doo”真人采样人声版。人声不唱谱上歌词，也不是 AI 声库。
- 导出音频：把**当前**的声部开关、每个声部的音量、音色模式（人声／钢琴）和速度混成 48 kHz 立体声 WAV 直接下载。录制走独立的采样通路（与扬声器音量无关），导出时监视器静音、进度显示在状态栏、可随时取消；峰值归一化到 −1 dBFS，所以不同声部比例会如实保留，绝对音量不会。渲染按实时速度进行，一首 4 分钟的谱子大约要 4 分钟。

## 当前边界

- Audiveris 适合清晰的印刷谱，扫描件可能漏读音符、歌词和表情记号；手写谱未支持。网页会提示核对识谱结果。
- 新 PDF 的首次识谱仍可能耗时数分钟；缓存只缩短相同文件的重复上传。项目预存的《蒲公英》混合识谱结果有 48 个待校对小节，不应当作准确排练谱。
- PDF 自动选页依赖五线谱横线检测。遇到混排或每页只有很少谱表的文件，可能选错范围；识谱结果中没有声部名称时，SATB 标签按音域推测，需要人工核对。
- 反复记号、复杂装饰音、微分音及复调共享弯音的情况可能与乐谱不完全一致。导入后仍需听辨校对。
- 颤音暂按上方全音交替；实际作品可能需要半音、变音或特定起始音。
- 滑音限于一个八度内的连续弯音，音符跨越更远时会截断。

## 依赖与声库

- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)：MusicXML 谱面显示，BSD-3-Clause。
- [spessasynth_lib](https://github.com/spessasus/spessasynth_lib)：浏览器 SoundFont 合成，Apache-2.0。
- [Choir-practice-midi-player](https://github.com/birkeeper/Choir-practice-midi-player) 的 `Choir_practice.sf2`：四类真人声部采样。**原始独唱人声采样 CC BY-NC-ND 4.0；编译声库 CC BY-NC-SA 4.0，仅用于非商业原型。**版权归 Vocal Group Jammin' 与 Birkeeper 所有。详见[原项目许可](https://github.com/birkeeper/Choir-practice-midi-player/blob/main/LICENSE)。

### 声库瘦身

原始声库 70.2 MB，播放器只用到四个 `doo` 人声预设（program 1–4）和钢琴（program 21）；没被任何预设引用的 `da` 声部（11 MB）和 Clarinet（5.7 MB）可以安全砍掉。**钢琴原样保留**——原始库里那两档力度是叠着发声的，砍掉一层会明显变薄，所以精简后是 54.1 MB 而不是更小。

```powershell
npm run soundfont          # 从原始 sf2 重新打包出 54.1 MB 的精简声库
npm run soundfont:verify   # 逐 preset × 88 键 × 8 个力度比对采样与调音
```

重建时把原始 `Choir_practice.sf2` 放到 `tools/soundfonts/`（那个目录不进仓库，也不会被 `vite build` 拷进站点），输出写在 `public/soundfonts/choir-practice-lite.sf2`。

重建会改写 `shdr` 的采样偏移与 loop 点、`sampleLink` 的立体声配对和 `pbag/ibag` 索引；`soundfont:verify` 对每个 preset × 88 个键位 × 8 个力度比对「解析到的采样名 + PCM 内容 + rootKey/粗调/细调」，必须完全一致（当前 4224/4224 一致，结构检查 0 问题）。也就是说精简版里钢琴和人声逐字节等价于原始库，只是少了永远不会被调用的预设。

上传乐谱与其生成音频的版权归属应由使用者自行确认。本项目仅供本地练习和技术验证。
