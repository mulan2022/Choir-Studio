export const editorToolbar = `
  <div class="editor-toolbar" aria-label="编辑工具栏">
    <div class="editor-mode-switch" role="group" aria-label="编辑模式">
      <button id="mode-measures" type="button" class="active" aria-pressed="true"><span aria-hidden="true">▥</span> 小节模式</button>
      <button id="mode-notes" type="button" aria-pressed="false"><span aria-hidden="true">♪</span> 音符模式</button>
    </div>
    <span class="editor-toolbar-hint" id="editor-mode-hint">单击选小节 · Shift 连选 · Ctrl 点选</span>
    <div class="editor-history"><button id="edit-undo" type="button" title="撤销（Ctrl+Z）">↶ <span>撤销</span></button><button id="edit-redo" type="button" title="重做（Ctrl+Shift+Z）">↷ <span>重做</span></button></div>
  </div>`;

export const editorPanel = `
  <aside class="editor-panel" id="editor-panel" aria-label="乐谱编辑器">
    <div class="editor-panel-head"><strong id="editor-panel-title">小节设置</strong><span id="editor-state"></span></div>
    <div class="editor-selection" id="editor-selection" aria-live="polite">点击谱面选择小节</div>
    <div id="measure-tools">
      <section class="editor-card">
        <div class="editor-group-title-row"><strong class="editor-group-title">选择小节</strong><button class="editor-text-button" id="select-all-measures" type="button">全选</button></div>
        <p class="editor-help">Shift 选择连续小节，Ctrl / ⌘ 增减选择。</p>
        <div class="editor-meter-range"><label>从 <input id="meter-start" type="number" min="1" aria-label="起始小节"></label><span>—</span><label>到 <input id="meter-end" type="number" min="1" aria-label="结束小节"></label><button id="select-measure-range" type="button" class="editor-secondary">选择</button></div>
      </section>
      <section class="editor-card">
        <div class="editor-group-title-row"><strong class="editor-group-title" id="editor-measure-title">拍号</strong><span class="editor-group-hint">应用到高亮小节</span></div>
        <div class="meter-presets" role="group" aria-label="常用拍号">${['2/4', '3/4', '4/4', '6/8', '3/8'].map(meter => `<button type="button" data-meter="${meter}" aria-pressed="false">${meter}</button>`).join('')}</div>
        <div class="editor-meter"><input id="edit-beats" type="number" min="1" max="12" aria-label="每小节拍数"><span>/</span><select id="edit-beat-type" aria-label="拍号单位"><option>2</option><option>4</option><option>8</option><option>16</option></select><span class="editor-meter-caption">自定义拍号</span></div>
        <button class="editor-primary" id="apply-meter" type="button">应用拍号</button>
        <p class="editor-help compact">自动适配所选小节；无法平衡时保留修改并标记，方便继续校正。</p>
      </section>
      <section class="editor-card">
        <strong class="editor-group-title">插入空白小节</strong>
        <div class="editor-button-row"><button class="editor-secondary" id="insert-before" type="button">＋ 在选区前</button><button class="editor-secondary" id="insert-after" type="button">＋ 在选区后</button></div>
        <p class="editor-help compact">沿用相邻拍号，各声部自动填入整小节休止符。</p>
      </section>
    </div>
    <div id="note-tools" hidden>
      <div class="note-tool-switch" role="group" aria-label="音符操作"><button id="note-select-tool" type="button" aria-pressed="true" class="active">↖ 选择音符</button><button id="note-insert-tool" type="button" aria-pressed="false">＋ 添加音符</button></div>
        <section class="editor-card" id="note-rhythm-card"><div class="editor-group-title-row"><strong class="editor-group-title">节奏</strong><span class="editor-group-hint" id="rhythm-help">选择一个音符后应用</span></div>
          <div class="rhythm-palette" id="rhythm-palette" role="group" aria-label="常用音符时值"></div>
          <div class="rhythm-field"><button class="rhythm-trigger" id="rhythm-trigger" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="rhythm-trigger-glyph" id="rhythm-trigger-glyph"></span><span class="rhythm-trigger-label" id="rhythm-trigger-label">更多时值与附点</span><span class="rhythm-caret" aria-hidden="true">⌄</span></button><div class="rhythm-menu" id="rhythm-menu" role="listbox" aria-label="时值" hidden></div></div>
        </section>
      <section class="editor-card pitch-card">
        <div class="editor-group-title-row"><strong class="editor-group-title">音高</strong><span class="editor-group-hint">点击五线谱选择</span></div>
        <div class="pitch-staff-wrap"><svg id="pitch-staff" viewBox="0 0 280 142" role="slider" tabindex="0" aria-label="五线谱音高选择，方向键调整" aria-valuemin="21" aria-valuemax="108"></svg></div>
        <div class="pitch-register"><button id="pitch-octave-down" type="button" title="显示低一个八度">−8va</button><span id="pitch-staff-caption">高音谱表</span><button id="pitch-octave-up" type="button" title="显示高一个八度">＋8va</button></div>
        <div class="pitch-compare"><div class="pitch-slot current"><span class="pitch-name" id="pitch-current">—</span><span class="pitch-caption" id="pitch-current-caption">当前音高</span></div><span class="pitch-arrow" aria-hidden="true">→</span><div class="pitch-slot target" id="pitch-target-slot"><span class="pitch-name" id="pitch-target">—</span><span class="pitch-caption">选定音高</span></div></div>
        <div class="pitch-actions"><button class="editor-chip" id="pitch-flat" type="button" aria-label="降半音">♭</button><button class="editor-chip" id="pitch-sharp" type="button" aria-label="升半音">♯</button><button class="editor-primary" id="apply-pitch" type="button">确认音高</button><button class="editor-secondary" id="cancel-pitch" type="button">取消</button></div>
        <button id="pick-score-pitch" type="button" class="editor-text-button pitch-pick-button" aria-pressed="false">⌖ 在原谱上点选音高</button>
      </section>
      <div id="note-edit-tools">

        <section class="editor-card"><strong class="editor-group-title">连音与延音</strong><div class="editor-button-row"><button class="editor-secondary" id="add-triplet" type="button">⌜3⌝ 加三连音</button><button class="editor-secondary" id="remove-triplet" type="button">去三连音</button></div><div class="editor-button-row"><button class="editor-secondary" id="add-tie" type="button">⌒ 加延音线</button><button class="editor-secondary" id="remove-tie" type="button">去延音线</button></div><p class="editor-help compact">加三连音：选连续三个同值音符。去三连音：选组内任一音符，整组恢复记谱时值；拍数冲突可继续修改。延音线：选相邻两个同音高音符。</p></section>
        <button class="editor-danger" id="delete-notes" type="button">删除所选音符 <span>Del</span></button><p class="editor-help compact">删除后保留等长休止符，小节拍数不变。</p>
      </div>
      <div id="note-insert-tools" hidden>
        <section class="editor-card"><div class="editor-group-title-row"><strong class="editor-group-title">写入位置</strong><span class="editor-group-hint">可直接点击谱上的休止符</span></div>
          <div class="editor-insert-fields"><label>小节<select id="insert-measure" aria-label="目标小节"></select></label><label>声部<select id="insert-slot" aria-label="插入音符的声部"></select></label><label>音高<select id="insert-pitch" aria-label="插入音符的音高"></select></label><label>起拍<select id="insert-start" aria-label="插入音符的起拍"></select></label></div>
          <strong class="editor-group-title">音符时值</strong><div class="rhythm-palette" id="insert-rhythm-palette" role="group" aria-label="插入音符时值"></div><label class="insert-duration-label">更多时值<select id="insert-duration" aria-label="插入音符的时值"></select></label>
          <button class="editor-primary" id="insert-note" type="button">＋ 在空拍插入音符</button><p class="editor-insert-hint" id="insert-hint"></p>
        </section>
      </div>
    </div>
    <details class="editor-issues" id="editor-issues" hidden><summary>待校对小节 <span id="editor-issue-count"></span></summary><div class="editor-issue-list" id="editor-issue-list"></div></details>
    <button class="editor-download" id="edit-download" type="button">↓ 下载修改后的 MusicXML</button>
    <p class="editor-message" id="editor-message" role="status"></p>
  </aside>`;
