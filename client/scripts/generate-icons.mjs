/**
 * Generates every PWA icon from the single source logo.
 *
 *   npm i -D sharp && npm run icons
 *
 * `sharp` is NOT kept as a dependency: the icons are committed artefacts, and
 * carrying a ~30 MB native image library into every deploy to regenerate files
 * that never change would be silly. Install it only when the logo changes.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SOURCE = 'src/app/images/Logo.png';
const OUT = 'public/icons';

/** The theme's canvas colour. An icon with a transparent background renders as
 *  a black void on some Android launchers, so every icon gets a real fill. */
const BACKGROUND = { r: 0xfa, g: 0xfa, b: 0xf9, alpha: 1 };

/**
 * `any` icons are shown as-is, so the logo can fill most of the square.
 *
 * `maskable` icons are CROPPED by the launcher into whatever shape it likes —
 * circle, squircle, teardrop. Only the middle 80% is guaranteed to survive, so
 * the logo has to sit well inside that or Android will slice its edges off. That
 * is why the two sets are not the same image at different sizes.
 */
const RECIPES = [
  { name: 'icon-192.png', size: 192, inset: 0.78 },
  { name: 'icon-512.png', size: 512, inset: 0.78 },
  { name: 'icon-maskable-192.png', size: 192, inset: 0.5 },
  { name: 'icon-maskable-512.png', size: 512, inset: 0.5 },
  // iOS never applies a mask and never shows transparency — it composites onto
  // black. Same generous-ish inset, opaque background.
  { name: 'apple-touch-icon.png', size: 180, inset: 0.72 },
];

await mkdir(OUT, { recursive: true });

for (const { name, size, inset } of RECIPES) {
  const logoBox = Math.round(size * inset);

  const logo = await sharp(SOURCE)
    // `contain` preserves the aspect ratio of a non-square logo instead of
    // squashing it into the box.
    .resize(logoBox, logoBox, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(`${OUT}/${name}`);

  console.log(`  ${name.padEnd(26)} ${size}×${size}  logo at ${Math.round(inset * 100)}%`);
}

console.log(`\nWrote ${RECIPES.length} icons to ${OUT}/`);
