// 时值图标：用内联 SVG 画真正的音符形状（符头 / 符干 / 符尾 / 附点），
// 这样下拉里不用依赖系统的音乐符号字体。

const FILLED = new Set(['quarter', 'eighth', '16th', '32nd']);
const FLAG_COUNT = { eighth: 1, '16th': 2, '32nd': 3 };
const VIEW_WIDTH = 44;
const VIEW_HEIGHT = 56;
const HEAD_X = 16;
const HEAD_Y = 42;
const STEM_X = 23.2;
const STEM_TOP = 14;

function headMarkup(type) {
  if (type === 'breve') {
    return `<rect x="5.6" y="34.6" width="20.8" height="14.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="2.2"/>`
      + `<path d="M5.6 30.4 L5.6 53.6 M26.4 30.4 L26.4 53.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  if (type === 'whole') {
    return `<ellipse cx="${HEAD_X}" cy="${HEAD_Y}" rx="9.4" ry="6" fill="none" stroke="currentColor" stroke-width="2.4"/>`;
  }
  const filled = FILLED.has(type);
  const head = `<ellipse cx="${HEAD_X}" cy="${HEAD_Y}" rx="8" ry="5.6" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4"'}/>`;
  const stem = `<path d="M${STEM_X} 41 L${STEM_X} ${STEM_TOP}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  const flags = FLAG_COUNT[type] || 0;
  let flagMarkup = '';
  for (let index = 0; index < flags; index++) {
    const top = STEM_TOP + index * 4.6;
    flagMarkup += `<path d="M${STEM_X} ${top} C${STEM_X + 6.8} ${top + 3.2} ${STEM_X + 8.4} ${top + 6.4} ${STEM_X + 4.8} ${top + 9.4}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>`;
  }
  return head + stem + flagMarkup;
}

function dotsMarkup(dots) {
  let markup = '';
  for (let index = 0; index < dots; index++) {
    markup += `<circle cx="${28.6 + index * 4.8}" cy="${HEAD_Y - 1}" r="2.1" fill="currentColor"/>`;
  }
  return markup;
}

/** 返回一个音符 SVG 字符串，height 为像素高度，宽度按比例。 */
export function noteGlyph(type, dots = 0, { size = 24, className = '' } = {}) {
  const width = Math.round(size * VIEW_WIDTH / VIEW_HEIGHT * 100) / 100;
  const classes = ['note-glyph', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" width="${width}" height="${size}" aria-hidden="true" focusable="false">${headMarkup(type)}${dotsMarkup(dots)}</svg>`;
}
