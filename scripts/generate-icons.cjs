const sharp = require("sharp");

function makeSvg(size, showLabel) {
  const stroke = Math.max(2, Math.round(size * 0.06));
  const pad = Math.max(1, Math.round(size * 0.03));
  const fontSize = Math.round(size * 0.62);
  const labelSize = Math.round(size * 0.08);
  const labelY = Math.round(size * 0.88);
  const textY = Math.round(size * 0.68);
  const inner = size - pad * 2;

  const label = showLabel
    ? `<text x="${size / 2}" y="${labelY}" font-family="monospace" font-size="${labelSize}" font-weight="700" fill="#ffffff" text-anchor="middle">BLACKOUT</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#000000"/>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="#22c55e" stroke-width="${stroke}"/>
  <text x="${size / 2}" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#22c55e" text-anchor="middle">B</text>
  ${label}
</svg>`;

  return Buffer.from(svg);
}

async function main() {
  await sharp(makeSvg(32, false)).png().toFile("src/app/icon.png");
  await sharp(makeSvg(180, true)).png().toFile("src/app/apple-icon.png");
  await sharp(makeSvg(192, false)).png().toFile("public/icon-192.png");
  console.log("Created favicon assets");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
