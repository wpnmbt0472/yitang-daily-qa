'use strict';
/**
 * make-icon.js —— 用纯 Node（零依赖）生成 1024×1024 的 App 图标 build/icon.png
 *
 * electron-builder 会在 macOS 上自动把它转成 .icns，在 Windows 上转成 .ico，
 * 所以只需维护这一个 PNG 源文件。
 *
 * 画面：橙色圆角方块（macOS squircle 近似）+ 白色问答卡片 + 绿色对勾徽章。
 * 用 SDF（有符号距离场）逐像素绘制，边缘自带抗锯齿，不依赖任何绘图库。
 *
 * 用法：node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

/* --------------------------- math helpers --------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax, pay = y - ay;
  const bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** 距离 → 覆盖率（1px 过渡带，等效抗锯齿） */
const cov = (d) => clamp(0.5 - d, 0, 1);

/* --------------------------- palette --------------------------- */
const ORANGE_TOP = [255, 150, 92];
const ORANGE_BOT = [242, 84, 22];
const WHITE = [255, 255, 255];
const CARD = [255, 255, 255];
const ACCENT = [255, 106, 43];
const GRAY = [232, 235, 239];
const GREEN = [34, 197, 94];

/* --------------------------- 绘制 --------------------------- */
function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4); // RGBA
  const C = SIZE / 2;

  // 关键几何（相对于 1024 画布）
  const ICON_HW = 412, ICON_R = 188;              // squircle
  const cardCX = 500, cardCY = 500, cardHW = 290, cardHH = 210, cardR = 62;
  const ringCX = 700, ringCY = 640, ringR = 100;  // 绿色徽章
  const barX0 = cardCX - cardHW + 54;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const fx = x + 0.5, fy = y + 0.5;

      let col = [0, 0, 0];
      let alpha = 0;

      // 1) 底色 squircle（带纵向渐变）
      const aIcon = cov(sdRoundRect(fx, fy, C, C, ICON_HW, ICON_HW, ICON_R));
      if (aIcon > 0) {
        const t = clamp((fy - (C - ICON_HW)) / (ICON_HW * 2), 0, 1);
        col = mixRGB(ORANGE_TOP, ORANGE_BOT, t * t * 0.9 + t * 0.1);
        alpha = aIcon;
      }

      // 2) 白色问答卡片
      const aCard = cov(sdRoundRect(fx, fy, cardCX, cardCY, cardHW, cardHH, cardR));
      if (aCard > 0) { col = mixRGB(col, CARD, aCard); alpha = Math.max(alpha, aCard); }

      // 3) 卡片内三条「题目行」：第一条橙色，其余浅灰
      const bars = [
        { y: 418, h: 30, w: 380, c: ACCENT },
        { y: 482, h: 24, w: 300, c: GRAY },
        { y: 538, h: 24, w: 226, c: GRAY }
      ];
      for (const b of bars) {
        const d = sdRoundRect(fx, fy, barX0 + b.w / 2, b.y, b.w / 2, b.h / 2, b.h / 2);
        const a = cov(d);
        if (a > 0) { col = mixRGB(col, b.c, a); alpha = Math.max(alpha, a); }
      }

      // 4) 徽章外的白色分离环
      const aRing = cov(sdCircle(fx, fy, ringCX, ringCY, ringR + 16)) -
                    cov(sdCircle(fx, fy, ringCX, ringCY, ringR + 4));
      if (aRing > 0) { col = mixRGB(col, WHITE, aRing); alpha = Math.max(alpha, aRing); }

      // 5) 绿色对勾徽章
      const aGreen = cov(sdCircle(fx, fy, ringCX, ringCY, ringR));
      if (aGreen > 0) { col = mixRGB(col, GREEN, aGreen); alpha = Math.max(alpha, aGreen); }

      // 6) 白色对勾（两段粗线）
      const stroke = 27;
      const dCheck = Math.min(
        sdSegment(fx, fy, ringCX - 46, ringCY - 4, ringCX - 13, ringCY + 30),
        sdSegment(fx, fy, ringCX - 13, ringCY + 30, ringCX + 50, ringCY - 40)
      ) - stroke / 2;
      const aCheck = cov(dCheck);
      if (aCheck > 0) { col = mixRGB(col, WHITE, aCheck); alpha = Math.max(alpha, aCheck); }

      const i = (y * SIZE + x) * 4;
      px[i] = Math.round(clamp(col[0], 0, 255));
      px[i + 1] = Math.round(clamp(col[1], 0, 255));
      px[i + 2] = Math.round(clamp(col[2], 0, 255));
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/* --------------------------- PNG 编码 --------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------- main --------------------------- */
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
const rgba = render();
const png = encodePNG(rgba, SIZE, SIZE);
fs.writeFileSync(out, png);
console.log(`icon.png 已生成：${out}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)} KB`);
