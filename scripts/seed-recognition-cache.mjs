import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recognitionKey } from '../recognition-cache.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [input, result] = process.argv.slice(2);
const inputExtension = path.extname(input || '').slice(1).toLowerCase();
const resultExtension = path.extname(result || '').slice(1).toLowerCase();
if (!['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(inputExtension) || !['mxl', 'musicxml'].includes(resultExtension)) {
  throw new Error('用法: node scripts/seed-recognition-cache.mjs <PDF或图片> <已有MusicXML或MXL>');
}

const body = await fs.readFile(input);
const transcription = await fs.readFile(result);
const key = recognitionKey(inputExtension, body);
const cache = path.join(root, '.cache', 'recognition');
await fs.mkdir(cache, { recursive: true });
const target = path.join(cache, `${key}.${resultExtension}`);
await fs.writeFile(target, transcription);
console.log(`已缓存 ${path.basename(input)} → ${path.basename(result)} (${(transcription.length / 1024).toFixed(0)} KB)`);
