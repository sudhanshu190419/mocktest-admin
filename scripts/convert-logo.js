const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '../public/brand/Enlarged Make Me Topper Tagline Logo.png');
const svgPath = path.join(__dirname, '../public/brand/logo-primary-horizontal.svg');

const pngBuf = fs.readFileSync(pngPath);
const base64 = pngBuf.toString('base64');
const dataUri = `data:image/png;base64,${base64}`;

// Content bounding box for 'Enlarged Make Me Topper Tagline Logo.png':
// minX: 63, maxX: 2105, minY: 88, maxY: 586 (width: 2043, height: 499)
// Framing viewBox with balanced padding:
// x: 40, y: 75, width: 2090, height: 510 (ratio: 4.098 : 1)
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="40 75 2090 510" width="100%" height="100%">
  <image width="2172" height="724" href="${dataUri}" xlink:href="${dataUri}" preserveAspectRatio="xMidYMid meet" />
</svg>
`;

fs.writeFileSync(svgPath, svgContent, 'utf8');
console.log('Successfully generated', svgPath, 'Size:', svgContent.length, 'bytes');
