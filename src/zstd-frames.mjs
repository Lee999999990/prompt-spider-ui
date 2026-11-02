// DSH 会话日志是「一条记录一个 zstd 帧」追加写的（实测单文件 2000+ 个帧头）。
// zlib.zstdDecompressSync 只解第一帧，所以整段必须按帧头切开逐帧解压再拼回去。
// 单独成模块是为了能被 selftest 直接 import —— extract.mjs 顶层会执行 CLI，不能当库用。
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function frameOffsets(buf) {
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) starts.push(i);
  }
  return starts;
}

export function unzstdAll(buf) {
  const starts = frameOffsets(buf);
  if (starts.length <= 1) return zlib.zstdDecompressSync(buf);
  const parts = [];
  for (let k = 0; k < starts.length; k += 1) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(s, e))); } catch { /* 尾帧写到一半，跳过 */ }
  }
  return Buffer.concat(parts);
}

export default { frameOffsets, unzstdAll };
