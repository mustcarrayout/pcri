// 从 design/logo/*.svg 渲染 Android 启动图标与启动屏资源
// 用法: node design/logo/render.mjs
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const res = join(repo, "android", "app", "src", "main", "res");

const svg = async (name) => readFile(join(here, name));

const densityBySize = {
  48: "mipmap-mdpi",
  72: "mipmap-hdpi",
  96: "mipmap-xhdpi",
  144: "mipmap-xxhdpi",
  192: "mipmap-xxxhdpi",
};
const fgSizes = { 108: "mipmap-mdpi", 162: "mipmap-hdpi", 216: "mipmap-xhdpi", 324: "mipmap-xxhdpi", 432: "mipmap-xxxhdpi" };

const iconSvg = await svg("icon.svg");
const roundSvg = await svg("icon-round.svg");
const fgSvg = await svg("adaptive-foreground.svg");
const bgSvg = await svg("adaptive-background.svg");

for (const [size, folder] of Object.entries(densityBySize)) {
  const px = Number(size);
  await sharp(Buffer.from(iconSvg), { density: 72 })
    .resize(px, px)
    .png()
    .toFile(join(res, folder, "ic_launcher.png"));
  await sharp(Buffer.from(roundSvg), { density: 72 })
    .resize(px, px)
    .png()
    .toFile(join(res, folder, "ic_launcher_round.png"));
}
for (const [size, folder] of Object.entries(fgSizes)) {
  const px = Number(size);
  await sharp(Buffer.from(fgSvg), { density: 72 })
    .resize(px, px)
    .png()
    .toFile(join(res, folder, "ic_launcher_foreground.png"));
  await sharp(Buffer.from(bgSvg), { density: 72 })
    .resize(px, px)
    .png()
    .toFile(join(res, folder, "ic_launcher_background.png"));
}

// 启动屏：奶油底 + 居中 logo（约短边 34%）
const splashSizes = [
  ["drawable/splash.png", 320, 480],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 960],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 960, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
];
const iconPng = await sharp(Buffer.from(iconSvg), { density: 72 }).resize(256, 256).png().toBuffer();
for (const [rel, w, h] of splashSizes) {
  const logoSize = Math.round(Math.min(w, h) * 0.34);
  const logo = await sharp(iconPng).resize(logoSize, logoSize).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: "#F5F6F1" } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(join(res, rel));
}

// 预览图：不同尺寸 + 圆形版本
const previews = [
  { input: await sharp(Buffer.from(iconSvg), { density: 72 }).resize(220, 220).png().toBuffer(), left: 60, top: 90 },
  { input: await sharp(Buffer.from(iconSvg), { density: 72 }).resize(110, 110).png().toBuffer(), left: 330, top: 145 },
  { input: await sharp(Buffer.from(iconSvg), { density: 72 }).resize(56, 56).png().toBuffer(), left: 490, top: 172 },
  { input: await sharp(Buffer.from(roundSvg), { density: 72 }).resize(220, 220).png().toBuffer(), left: 620, top: 90 },
];
await sharp({ create: { width: 900, height: 400, channels: 4, background: "#F5F6F1" } })
  .composite(previews)
  .png()
  .toFile(join(here, "preview.png"));

console.log("done");
