// 快速检查 WAV 的 RMS 电平（确认非静音导出）
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file);
  // 找 data chunk
  let off = 12, dataOff = -1, dataLen = 0, ch = 2, bits = 16, sr = 44100;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(off + 10); bits = buf.readUInt16LE(off + 14); sr = buf.readUInt32LE(off + 12); }
    if (id === 'data') { dataOff = off + 8; dataLen = Math.min(sz, buf.length - dataOff); break; }
    off += 8 + sz;
  }
  if (dataOff < 0) { console.log(file + ': 无 data chunk'); continue; }
  const n = Math.floor(dataLen / 2);
  let sum = 0, peak = 0;
  const stride = Math.max(1, Math.floor(n / 2000000)) * 2; // 抽样
  let cnt = 0;
  for (let i = 0; i < n; i += stride) {
    const s = buf.readInt16LE(dataOff + i * 2) / 32768;
    sum += s * s; cnt++;
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  const rms = Math.sqrt(sum / cnt);
  const secs = (n / ch / sr).toFixed(1);
  console.log(`${file}\n  rms=${rms.toFixed(4)} peak=${peak.toFixed(3)} ${ch}ch ${bits}bit ${(sr / 1000).toFixed(1)}kHz ${secs}s`);
}
