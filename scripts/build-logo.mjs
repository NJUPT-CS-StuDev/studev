/**
 * StuDev Design-as-Code Asset Generator
 * Single Source of Truth (SSOT) for all Brand, Web, Android and ICP Filing Logo Assets.
 *
 * Safe-Zone Calibrated for Android Adaptive Icons (Strictly within 72dp viewport)
 */

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RES_DIR = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');

// =========================================================================
// 1. Master Mathematical Definitions (Calibrated to 60dp inner keyline, 72dp safe zone)
// =========================================================================
// Canvas: 108dp x 108dp. Safe zone: circle R=36dp at (54, 54).
// Glyph height = ~59.5dp, perfectly centered, giving ~6.5dp margin to 72dp mask boundary.
const MASTER_S_PATH = "M 66 40 C 66 30, 42 30, 42 42 C 42 53, 66 55, 66 66 C 66 78, 42 78, 42 68";
const MASTER_STROKE_WIDTH = 11.5;

// Pure Glyph Master SVG (Transparent background)
const MASTER_GLYPH_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="studevBrandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00C4FF" />
      <stop offset="50%" stop-color="#0066FF" />
      <stop offset="100%" stop-color="#4F46E5" />
    </linearGradient>
  </defs>
  <path d="${MASTER_S_PATH}"
        fill="none"
        stroke="url(#studevBrandGradient)"
        stroke-width="${MASTER_STROKE_WIDTH}"
        stroke-linecap="round"
        stroke-linejoin="round" />
</svg>`;

// App Icon Master SVG (With pure white squircle container)
const SQUIRCLE_ICON_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="studevBrandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00C4FF" />
      <stop offset="50%" stop-color="#0066FF" />
      <stop offset="100%" stop-color="#4F46E5" />
    </linearGradient>
  </defs>
  <!-- Squircle container (Radius 24dp on 108dp canvas) -->
  <rect x="0" y="0" width="108" height="108" rx="24" fill="#FFFFFF" />
  <!-- Glyph centered inside safe area with generous breathing margin -->
  <path d="${MASTER_S_PATH}"
        fill="none"
        stroke="url(#studevBrandGradient)"
        stroke-width="${MASTER_STROKE_WIDTH}"
        stroke-linecap="round"
        stroke-linejoin="round" />
</svg>`;

// Browser Favicon SVG (32x32 viewbox with squircle base)
const FAVICON_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="favGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00C4FF" />
      <stop offset="50%" stop-color="#0066FF" />
      <stop offset="100%" stop-color="#4F46E5" />
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7.5" fill="#FFFFFF" />
  <path d="M 19.55 11.85 C 19.55 8.89 12.44 8.89 12.44 12.44 C 12.44 15.70 19.55 16.30 19.55 19.55 C 19.55 23.11 12.44 23.11 12.44 20.15"
        fill="none" stroke="url(#favGrad)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

async function main() {
  console.log("🎨 Starting StuDev logo asset generation (Safe-Zone Calibrated)...");

  // 1. Export Master SVGs
  console.log("  -> Generating Master SVGs...");
  await fs.writeFile(path.join(ROOT_DIR, 'src', 'assets', 'logo.svg'), MASTER_GLYPH_SVG.trim(), 'utf-8');
  await fs.writeFile(path.join(ROOT_DIR, 'public', 'favicon.svg'), FAVICON_SVG.trim(), 'utf-8');

  // 2. Generate Master 512x512 High-Res PNGs via sharp
  console.log("  -> Rendering 512x512 Master PNGs via Sharp...");
  const png512Buffer = await sharp(Buffer.from(SQUIRCLE_ICON_SVG), { density: 300 })
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(ROOT_DIR, 'src', 'assets', 'logo.png'), png512Buffer);
  await fs.writeFile(path.join(ROOT_DIR, 'public', 'assets', 'logo.png'), png512Buffer);

  // 3. Generate Android Native VectorDrawables (Safe-zone compliant)
  console.log("  -> Writing Android VectorDrawables (Adaptive Icon)...");
  const backgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M0,0h108v108h-108z" />
</vector>`;

  const foregroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="${MASTER_S_PATH}"
        android:strokeWidth="${MASTER_STROKE_WIDTH}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round">
        <aapt:attr name="android:strokeColor">
            <gradient
                android:startX="66"
                android:startY="40"
                android:endX="42"
                android:endY="68"
                android:type="linear">
                <item android:color="#FF00C4FF" android:offset="0.0" />
                <item android:color="#FF0066FF" android:offset="0.5" />
                <item android:color="#FF4F46E5" android:offset="1.0" />
            </gradient>
        </aapt:attr>
    </path>
</vector>`;

  const monochromeXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="${MASTER_S_PATH}"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="${MASTER_STROKE_WIDTH}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
</vector>`;

  const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>`;

  await fs.mkdir(path.join(RES_DIR, 'drawable'), { recursive: true });
  await fs.mkdir(path.join(RES_DIR, 'mipmap-anydpi-v26'), { recursive: true });

  await fs.writeFile(path.join(RES_DIR, 'drawable', 'ic_launcher_background.xml'), backgroundXml.trim(), 'utf-8');
  await fs.writeFile(path.join(RES_DIR, 'drawable', 'ic_launcher_foreground.xml'), foregroundXml.trim(), 'utf-8');
  await fs.writeFile(path.join(RES_DIR, 'drawable', 'ic_launcher_monochrome.xml'), monochromeXml.trim(), 'utf-8');
  await fs.writeFile(path.join(RES_DIR, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptiveIconXml.trim(), 'utf-8');
  await fs.writeFile(path.join(RES_DIR, 'drawable', 'ic_launcher.xml'), adaptiveIconXml.trim(), 'utf-8');

  // 4. Generate Android Legacy Mipmap PNGs (Full DPI density fallback)
  console.log("  -> Generating Android Legacy Mipmap Bitmaps...");
  const mipmapDensities = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 }
  ];

  for (const { dir, size } of mipmapDensities) {
    const targetDir = path.join(RES_DIR, dir);
    await fs.mkdir(targetDir, { recursive: true });
    const buf = await sharp(Buffer.from(SQUIRCLE_ICON_SVG), { density: 300 })
      .resize(size, size)
      .png({ quality: 100 })
      .toBuffer();
    await fs.writeFile(path.join(targetDir, 'ic_launcher.png'), buf);
    await fs.writeFile(path.join(targetDir, 'ic_launcher_round.png'), buf);
  }

  console.log("✅ All StuDev logo assets safely calibrated, regenerated and synchronized!");
}

main().catch(err => {
  console.error("❌ Error generating logo assets:", err);
  process.exit(1);
});
