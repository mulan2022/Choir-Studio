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

线上版是纯静态站：MusicXML 播放、分声部、变速、谱面跟随、导出音频都在浏览器里跑；**PDF／图片识谱需要本机服务，线上不可用**，页面会在侧栏直接写明（静态构建不去探活 `/api/health`，也就没有那条 404）。

```powershell
npm run deploy     # 构建 + 强推到 gh-pages（单 commit，54 MB 声库不累积历史）
```

一次性设置：仓库 → Settings → Pages → Source 选 **Deploy from a branch**，分支 `gh-pages`，目录 `/ (root)`。线上地址 `https://<用户名>.github.io/<仓库名>/`，当前部署在 <https://mulan2022.github.io/Choir-Studio/>。

`npm run deploy` 会用 `VITE_BASE=/<仓库名>/` 和 `VITE_STATIC=1` 构建，声库随站点同源发布（不需要 CORS），因此仓库本身不必存那个 54 MB 的二进制；新克隆用 `SOUNDFONT_URL=<直链> npm run fetch:soundfont` 取回来即可，或者本地重新 `npm run soundfont`。

> **大陆网络提醒**：GitHub Pages 在国内拉 54 MB 声库实测只有 ~10 KB/s，还容易连接中断，公网版更适合海外访问或接国内 CDN（把 `VITE_SOUNDFONT_URL` 指到 OSS/COS）。真正排练请用下面的本地包。

## 本地部署包（Windows）

```powershell
npm run pack       # → release/和声间-win64.zip
```

包里自带 Node、Python（含 Pillow）、Poppler、Audiveris、声库和站点，解压后双击 `启动.cmd` 就能用，浏览器自动打开 <http://127.0.0.1:4173/>；识谱、导出音频全部是本机能力，不需要联网也不需要管理员权限。打包前需要 `tools/audiveris/`、`tools/runtime/poppler/`、`tools/runtime/python/` 就位（都不进仓库）。


## 已支持

- MusicXML `score-partwise`，含多声部、同小节内 `<backup>`、歌词显示和速度标记。
- PDF、PNG、JPG、TIFF 通过本机 Audiveris 识别为 MusicXML，再进入同一播放器（单文件上限 200 MB）。PDF 会先查找连续的五线谱页，跳过封面、说明和简谱页；识谱时显示当前页、完成页数和耗时；13 页的《玉门关》在这台机器上跑了约 9 分钟。相同文件的成功识谱结果会保存在 `.cache/recognition/`，再次上传直接读取。
- 延音线跨小节连续播放。识谱校对模式暂不启用跳音、颤音、滑音和力度处理。
- 每条声部独立音轨，任意组合、独奏、音量与速度控制。
- 钢琴版与“doo”真人采样人声版。人声不唱谱上歌词，也不是 AI 声库。
- 编辑乐谱时，识谱后对不上拍的小节会用虚线框标出来，右侧列出全部编号，点编号直接跳到该小节。
- 本机识谱会综合原谱中识别出的拍号、连续小节的时值、多个声部和四分／附点四分的记谱形态补全漏识别的变拍。明确的拍号优先保留；3/4 与 6/8 无法区分或声部互相矛盾时保留原音符并标记待校对，不再自动补休止符掩盖冲突。识谱缓存已换版本，相同扫描件首次重新上传会重新识谱一次。
- 自动识谱关闭“隐式连音”推断，只考虑识别到连音数字的候选，并启用钢琴指法识别。密集指法段落还会结合相邻声部的相同节奏排查数字 3 与三连音的混淆；拍号推断不再自动改写已有三连音。模糊数字仍可能需要手工校正。
- 编辑区分为**小节模式**和**音符模式**，进入编辑时扩大谱面空间。每小节起始处显示编号，可直接点击编号定位选择。
- 小节模式：单击选择、Shift 连选、Ctrl／⌘ 增减选择，支持填写起止编号后点击“选择”。高亮小节可以统一改拍号（包括不连续选区，中间未选的小节保持原拍号），也可在选区前后插入空白小节；各声部按拍号填满休止符，整次改动可一步撤销。
- 音符模式：选择音符后，点击音高区的五线谱预览音高并确认，也可启用“在原谱上点选音高”；常用节奏提供音符图标，更多附点时值在菜单内。Ctrl／⌘ 点选和 Shift 连选支持批量删除；删除音符保留等长休止符，和弦中未删除的音保持原位置，相关延音线同步清理。
- “添加音符”可直接点击谱上的休止符定位，再选择声部、音高、时值和起拍写入。剩余空拍保留为休止符；超出小节的位置会被拒绝。即使删光音符，也能继续在空拍中写谱。支持撤销／重做、Ctrl+Z／Ctrl+Shift+Z、Del 删除和 MusicXML 下载。
- 三连音可选择同声部连续三个同值音符添加，选中已有三连音中的一个音符即可移除，实际时长与 MusicXML 连音标记同步更新。去三连音按记谱时值还原整组，也能处理识谱产生的重复结束标记。修改时优先用普通休止符补足或腾出拍数；无法平衡时保留修改并显示缺拍／超拍，允许继续改拍号或音符，支持撤销。
- 导出音频：把**当前**的声部开关、每个声部的音量、音色模式（人声／钢琴）和速度混成立体声音频下载。默认 MP3（192 kbps，4 分钟约 5.5 MB），也可选 48 kHz、16 位 WAV（4 分钟约 44 MB）。在后台离线渲染，无需把谱子播放一遍；进度显示在状态栏，可随时取消。峰值归一化到 −1 dBFS，所以不同声部比例会如实保留，绝对音量不会。实际导出时间取决于设备性能，MP3 渲染后还需压缩。

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
