import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = path.resolve('./public/icon.svg');
const publicDir = path.resolve('./public');

async function generate() {
  try {
    console.log('Generating PWA icons using Sharp...');
    
    // 192x192
    await sharp(svgPath)
      .resize(192, 192)
      .toFile(path.join(publicDir, 'pwa-192x192.png'));
    console.log('Generated pwa-192x192.png');

    // 512x512
    await sharp(svgPath)
      .resize(512, 512)
      .toFile(path.join(publicDir, 'pwa-512x512.png'));
    console.log('Generated pwa-512x512.png');

    // apple-touch-icon (180x180)
    await sharp(svgPath)
      .resize(180, 180)
      .toFile(path.join(publicDir, 'apple-touch-icon.png'));
    console.log('Generated apple-touch-icon.png');

    // pwa-maskable-512x512
    const baseIcon = await sharp(svgPath)
      .resize(430, 430)
      .toBuffer();

    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 } // slate-900 background
      }
    })
      .composite([{ input: baseIcon, top: 41, left: 41 }])
      .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
    console.log('Generated pwa-maskable-512x512.png');

    console.log('All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
  }
}

generate();
