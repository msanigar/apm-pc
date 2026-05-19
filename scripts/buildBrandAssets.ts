#!/usr/bin/env tsx
/**
 * Derive every PWA / OpenGraph asset the site ships from the two source
 * images we hand-generated:
 *
 *   assets/source/og-card.png         → public/og/default.png  (1200×630)
 *   assets/source/app-icon-master.png → public/icons/icon-192.png
 *                                      public/icons/icon-512.png
 *                                      public/icons/icon-192-maskable.png
 *                                      public/icons/icon-512-maskable.png
 *                                      public/apple-touch-icon.png  (180×180)
 *                                      public/favicon.png           (32×32)
 *
 * Run after touching either source file:
 *
 *   npm run build:assets
 *
 * Notes on the icon variants:
 *   - "Standard" icons keep the rounded-tile shape with transparent corners.
 *     iOS Safari + Android non-adaptive launchers honour the existing shape.
 *   - "Maskable" icons fill the whole square with the brand gradient so
 *     Android adaptive icon masks can do their thing without showing
 *     transparent corners. The art still lives within the safe centre 80%.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const SRC_OG = path.join(ROOT, "assets/source/og-card.png");
const SRC_ICON = path.join(ROOT, "assets/source/app-icon-master.png");

async function ensureDir(p: string) {
  await mkdir(path.dirname(p), { recursive: true });
}

/** OG card: cover-fit to the canonical 1200×630 social card size. */
async function buildOgCard() {
  const out = path.join(ROOT, "public/og/default.png");
  await ensureDir(out);
  await sharp(SRC_OG)
    .resize(1200, 630, {
      fit: "cover",
      position: "centre",
    })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(out);
  console.log(`  ✓ ${path.relative(ROOT, out)}`);
}

/**
 * "Standard" icon: trim the white background of the master so the rounded
 * tile sits edge-to-edge inside the canvas, then resize. Transparent
 * corners are preserved so iOS/Android can apply their own masks cleanly.
 */
async function buildStandardIcon(size: number, outPath: string) {
  const out = path.join(ROOT, outPath);
  await ensureDir(out);
  const trimmed = await sharp(SRC_ICON)
    .trim({ background: "#ffffff", threshold: 12 })
    .ensureAlpha()
    .toBuffer();
  await sharp(trimmed)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(out);
  console.log(`  ✓ ${path.relative(ROOT, out)} (${size}×${size})`);
}

/**
 * "Maskable" icon: full-bleed brand gradient with the trimmed rounded tile
 * art composited at 80% scale so it sits inside Android's adaptive-icon
 * safe zone. No transparent corners.
 */
async function buildMaskableIcon(size: number, outPath: string) {
  const out = path.join(ROOT, outPath);
  await ensureDir(out);

  // Brand gradient background — same colours as the source tile but laid
  // out as a full-bleed diagonal so the safe zone outside the inner art
  // still reads as on-brand if a circular/squircle mask trims it.
  const gradientSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#88bbff" />
          <stop offset="55%" stop-color="#b89bff" />
          <stop offset="100%" stop-color="#ff97c1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#g)" />
    </svg>
  `);

  const innerSize = Math.round(size * 0.8);
  const trimmed = await sharp(SRC_ICON)
    .trim({ background: "#ffffff", threshold: 12 })
    .ensureAlpha()
    .toBuffer();
  const inner = await sharp(trimmed)
    .resize(innerSize, innerSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp(gradientSvg)
    .composite([{ input: inner, gravity: "centre" }])
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(out);
  console.log(`  ✓ ${path.relative(ROOT, out)} (${size}×${size}, maskable)`);
}

async function main() {
  console.log("Building OG card…");
  await buildOgCard();

  console.log("Building standard icons (transparent corners)…");
  await buildStandardIcon(512, "public/icons/icon-512.png");
  await buildStandardIcon(192, "public/icons/icon-192.png");
  await buildStandardIcon(180, "public/apple-touch-icon.png");
  await buildStandardIcon(32, "public/favicon.png");

  console.log("Building maskable icons (full-bleed gradient)…");
  await buildMaskableIcon(512, "public/icons/icon-512-maskable.png");
  await buildMaskableIcon(192, "public/icons/icon-192-maskable.png");

  console.log("Done.");
}

main().catch((err) => {
  console.error("Asset build failed:", err);
  process.exit(1);
});
