const fs = require('fs');
const path = require('path');

// Exact Brand Colors from Brand Guidelines
const COLORS = {
  yellow: '#FAB416', // R250 G180 B22
  green: '#05AD66',  // R5 G173 B102
  purple: '#6023B6', // R96 G35 B182
  blue: '#0A40DF',   // R10 G64 B223
  darkText: '#0B132B', // High contrast rich dark for wordmark
  lightText: '#FFFFFF', // Clean white for dark mode
  subText: '#0A40DF',  // Tagline color
  subTextLight: '#60A5FA' // Tagline for dark mode
};

// Generate 4-pointed Star Path (Astroid / Sparkle with slight vertical aspiration)
function getStarPath(cx, cy, rx = 18, ry = 22) {
  return `M ${cx} ${cy - ry} Q ${cx} ${cy} ${cx + rx} ${cy} Q ${cx} ${cy} ${cx} ${cy + ry} Q ${cx} ${cy} ${cx - rx} ${cy} Q ${cx} ${cy} ${cx} ${cy - ry} Z`;
}

// 1. Standalone Submark With Progression (Icon only)
function generateSubmarkProgressionSVG() {
  const star = getStarPath(416, 42, 18, 22);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 270" fill="none" width="100%" height="100%">
  <!-- Blue Progression Wave (Starting Stage) -->
  <path d="M 40 220 C 60 220, 80 162, 104 162 C 128 162, 144 224, 164 224 C 178 224, 192 208, 204 195"
        stroke="${COLORS.blue}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Purple Progression Wave (Accelerating Stage) -->
  <path d="M 204 195 C 220 178, 236 124, 256 124 C 276 124, 288 200, 304 200 C 312 200, 320 188, 328 174"
        stroke="${COLORS.purple}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Green Student Figure (Torso & Upward Reaching Arm) -->
  <path d="M 328 174 C 338 154, 346 124, 352 112 C 362 92, 374 72, 388 56"
        stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Green Student Figure (Lower Leg/Base) -->
  <path d="M 352 112 L 352 232"
        stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Green Head Dot -->
  <circle cx="352" cy="56" r="15" fill="${COLORS.green}" />
  
  <!-- Gold Achievement Star -->
  <path d="${star}" fill="${COLORS.yellow}" />
</svg>`;
}

// 2. Standalone Minimal Submark (Figure + Star only)
function generateSubmarkSVG() {
  const star = getStarPath(175, 32, 16, 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 250" fill="none" width="100%" height="100%">
  <!-- Green Student Figure (Left Arm/Shoulder & Upward Reaching Arm) -->
  <path d="M 55 174 C 75 174, 102 128, 114 104 C 124 82, 136 62, 148 48"
        stroke="${COLORS.green}" stroke-width="23" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Green Student Figure (Lower Leg/Base) -->
  <path d="M 114 104 L 114 216"
        stroke="${COLORS.green}" stroke-width="23" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Green Head Dot -->
  <circle cx="114" cy="48" r="14" fill="${COLORS.green}" />
  
  <!-- Gold Achievement Star -->
  <path d="${star}" fill="${COLORS.yellow}" />
</svg>`;
}

// 3. Favicon (Optimized square icon)
function generateFaviconSVG() {
  const star = getStarPath(52, 12, 7, 9);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width="100%" height="100%">
  <!-- Green Figure -->
  <path d="M 16 44 C 22 44, 30 32, 34 26 C 37 20, 41 15, 45 12"
        stroke="${COLORS.green}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 34 26 L 34 54"
        stroke="${COLORS.green}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="34" cy="12" r="4" fill="${COLORS.green}" />
  <!-- Gold Star -->
  <path d="${star}" fill="${COLORS.yellow}" />
</svg>`;
}

// 4. Primary Stacked Logo (Mark on Top, Wordmark & Tagline Below)
function generatePrimaryStackedSVG(isDark = false) {
  const textColor = isDark ? COLORS.lightText : COLORS.darkText;
  const tagColor = isDark ? COLORS.subTextLight : COLORS.subText;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 330" fill="none" width="100%" height="100%">
  <g transform="translate(30, 12) scale(0.85)">
    <!-- Blue Progression Wave -->
    <path d="M 40 220 C 60 220, 80 162, 104 162 C 128 162, 144 224, 164 224 C 178 224, 192 208, 204 195"
          stroke="${COLORS.blue}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    
    <!-- Purple Progression Wave -->
    <path d="M 204 195 C 220 178, 236 124, 256 124 C 276 124, 288 200, 304 200 C 312 200, 320 188, 328 174"
          stroke="${COLORS.purple}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    
    <!-- Green Student Figure -->
    <path d="M 328 174 C 338 154, 346 124, 352 112 C 362 92, 374 72, 388 56"
          stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 352 112 L 352 232"
          stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="352" cy="56" r="15" fill="${COLORS.green}" />
    
    <!-- Star -->
    <path d="${getStarPath(416, 42, 18, 22)}" fill="${COLORS.yellow}" />
  </g>

  <!-- Wordmark: MAKE ME TOPPER -->
  <text x="220" y="265" 
        text-anchor="middle" 
        font-family="Arial, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
        font-size="28" 
        font-weight="900" 
        letter-spacing="1.8" 
        fill="${textColor}">MAKE ME TOPPER</text>

  <!-- Tagline: Learn. Aspire. Achieve. -->
  <text x="220" y="300" 
        text-anchor="middle" 
        font-family="Arial, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
        font-size="14.5" 
        font-weight="700" 
        letter-spacing="4.8" 
        fill="${tagColor}">Learn. Aspire. Achieve.</text>
</svg>`;
}

// 5. Primary Horizontal Logo (Mark on Left, Wordmark & Tagline on Right)
function generatePrimaryHorizontalSVG(isDark = false) {
  const textColor = isDark ? COLORS.lightText : COLORS.darkText;
  const tagColor = isDark ? COLORS.subTextLight : COLORS.subText;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 130" fill="none" width="100%" height="100%">
  <!-- Icon Mark on Left -->
  <g transform="translate(10, 8) scale(0.44)">
    <!-- Blue Progression Wave -->
    <path d="M 40 220 C 60 220, 80 162, 104 162 C 128 162, 144 224, 164 224 C 178 224, 192 208, 204 195"
          stroke="${COLORS.blue}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    
    <!-- Purple Progression Wave -->
    <path d="M 204 195 C 220 178, 236 124, 256 124 C 276 124, 288 200, 304 200 C 312 200, 320 188, 328 174"
          stroke="${COLORS.purple}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    
    <!-- Green Student Figure -->
    <path d="M 328 174 C 338 154, 346 124, 352 112 C 362 92, 374 72, 388 56"
          stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 352 112 L 352 232"
          stroke="${COLORS.green}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="352" cy="56" r="15" fill="${COLORS.green}" />
    
    <!-- Star -->
    <path d="${getStarPath(416, 42, 18, 22)}" fill="${COLORS.yellow}" />
  </g>

  <!-- Wordmark & Tagline on Right -->
  <g transform="translate(210, 0)">
    <text x="0" y="60" 
          font-family="Arial, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
          font-size="27" 
          font-weight="900" 
          letter-spacing="1.4" 
          fill="${textColor}">MAKE ME TOPPER</text>

    <text x="2" y="90" 
          font-family="Arial, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" 
          font-size="13.5" 
          font-weight="700" 
          letter-spacing="4" 
          fill="${tagColor}">Learn. Aspire. Achieve.</text>
  </g>
</svg>`;
}

// Generate all files
const outDir = path.join(__dirname, 'brand');

const files = {
  'logo-submark-progression.svg': generateSubmarkProgressionSVG(),
  'logo-submark.svg': generateSubmarkSVG(),
  'logo-favicon.svg': generateFaviconSVG(),
  'logo-primary-stacked.svg': generatePrimaryStackedSVG(false),
  'logo-primary-horizontal.svg': generatePrimaryHorizontalSVG(false),
  'logo-white-stacked.svg': generatePrimaryStackedSVG(true),
  'logo-white-horizontal.svg': generatePrimaryHorizontalSVG(true),
};

for (const [filename, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
  console.log(`Generated: ${filename}`);
}

// Generate a brand guidelines and assets documentation file
const brandDoc = `# Make Me Topper — Brand Vector Assets

Generated from the official brand identity guide.

## Official Color Palette
- **Yellow / Gold (Achievement Star)**: \`#FAB416\` (\`rgb(250, 180, 22)\`)
- **Green (Topper Figure)**: \`#05AD66\` (\`rgb(5, 173, 102)\`)
- **Purple (Progression Wave)**: \`#6023B6\` (\`rgb(96, 35, 182)\`)
- **Blue (Brand Baseline & Tagline)**: \`#0A40DF\` (\`rgb(10, 64, 223)\`)
- **Dark Charcoal (Wordmark)**: \`#0B132B\` (\`rgb(11, 19, 43)\`)

## Typography
- **Wordmark**: Arial Bold / Branding Pro Bold (\`MAKE ME TOPPER\`)
- **Tagline**: Arial / Branding Pro (\`Learn. Aspire. Achieve.\`)

## Asset Files Inventory
| File | Description | Usage |
|---|---|---|
| \`logo-primary-stacked.svg\` | Full vertical lockup (Progression mark + Wordmark + Tagline) | Hero sections, splash screens, documents |
| \`logo-primary-horizontal.svg\` | Full horizontal lockup | Desktop / mobile navigation header |
| \`logo-submark-progression.svg\` | Full emblem icon (Blue + Purple + Green figure + Star) | App icon, profile badge, social avatars |
| \`logo-submark.svg\` | Minimal emblem icon (Green figure + Gold star) | Compact indicators, sub-branding |
| \`logo-favicon.svg\` | 64x64 favicon optimized mark | Browser tab favicon |
| \`logo-white-stacked.svg\` | Dark-mode vertical lockup | Dark mode splash / footer |
| \`logo-white-horizontal.svg\` | Dark-mode horizontal lockup | Dark navigation header / dark footer |
| \`preview.html\` | Interactive visual preview & inspection sheet | Visual verification |
`;

fs.writeFileSync(path.join(outDir, 'README.md'), brandDoc, 'utf8');

// Update preview.html
const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Make Me Topper — Brand Vector Assets</title>
<style>
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f8fafc;
    margin: 0;
    padding: 40px 20px;
    color: #1e293b;
  }
  .container {
    max-width: 1200px;
    margin: 0 auto;
  }
  header {
    margin-bottom: 28px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 16px;
  }
  h1 {
    font-size: 28px;
    margin: 0 0 8px 0;
    color: #0f172a;
    font-weight: 800;
  }
  .palette {
    display: flex;
    gap: 16px;
    margin: 20px 0 32px;
    flex-wrap: wrap;
  }
  .swatch {
    display: flex;
    align-items: center;
    gap: 10px;
    background: white;
    padding: 8px 16px 8px 8px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }
  .swatch-color {
    width: 28px;
    height: 28px;
    border-radius: 6px;
  }
  .swatch-info {
    font-size: 13px;
    font-weight: 700;
  }
  .swatch-sub {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 24px;
  }
  .card {
    background: #ffffff;
    border-radius: 12px;
    padding: 24px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
  }
  .card.dark {
    background: #0f172a;
    border-color: #1e293b;
    color: #ffffff;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 16px;
  }
  .card h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .file-badge {
    font-family: monospace;
    font-size: 12px;
    background: #f1f5f9;
    color: #475569;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .card.dark .file-badge {
    background: #1e293b;
    color: #94a3b8;
  }
  .preview-box {
    flex: 1;
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fdfdfd;
    border: 1px dashed #e2e8f0;
    border-radius: 8px;
    padding: 24px;
    box-sizing: border-box;
  }
  .card.dark .preview-box {
    background: #090d16;
    border-color: #334155;
  }
  svg {
    max-width: 100%;
    max-height: 180px;
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Make Me Topper — Brand Vector Assets</h1>
    <p style="color: #64748b; margin: 0;">Exact vector representations from brand identity specifications</p>
  </header>

  <div class="palette">
    <div class="swatch">
      <div class="swatch-color" style="background: ${COLORS.yellow};"></div>
      <div><div class="swatch-info">Gold Star</div><div class="swatch-sub">${COLORS.yellow} | R250 G180 B22</div></div>
    </div>
    <div class="swatch">
      <div class="swatch-color" style="background: ${COLORS.green};"></div>
      <div><div class="swatch-info">Topper Green</div><div class="swatch-sub">${COLORS.green} | R5 G173 B102</div></div>
    </div>
    <div class="swatch">
      <div class="swatch-color" style="background: ${COLORS.purple};"></div>
      <div><div class="swatch-info">Progression Purple</div><div class="swatch-sub">${COLORS.purple} | R96 G35 B182</div></div>
    </div>
    <div class="swatch">
      <div class="swatch-color" style="background: ${COLORS.blue};"></div>
      <div><div class="swatch-info">Brand Blue</div><div class="swatch-sub">${COLORS.blue} | R10 G64 B223</div></div>
    </div>
  </div>

  <div class="grid">
    <!-- 1. Full Stacked Logo -->
    <div class="card">
      <div class="card-header">
        <h3>Primary Logo (Stacked)</h3>
        <span class="file-badge">logo-primary-stacked.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-primary-stacked.svg']}
      </div>
    </div>

    <!-- 2. Primary Horizontal Logo -->
    <div class="card">
      <div class="card-header">
        <h3>Primary Logo (Horizontal / Navbar)</h3>
        <span class="file-badge">logo-primary-horizontal.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-primary-horizontal.svg']}
      </div>
    </div>

    <!-- 3. Submark with Progression -->
    <div class="card">
      <div class="card-header">
        <h3>Submark with Progression</h3>
        <span class="file-badge">logo-submark-progression.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-submark-progression.svg']}
      </div>
    </div>

    <!-- 4. Submark (Minimal) -->
    <div class="card">
      <div class="card-header">
        <h3>Submark (Minimal Figure)</h3>
        <span class="file-badge">logo-submark.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-submark.svg']}
      </div>
    </div>

    <!-- 5. Favicon -->
    <div class="card">
      <div class="card-header">
        <h3>Favicon (64x64)</h3>
        <span class="file-badge">logo-favicon.svg</span>
      </div>
      <div class="preview-box">
        <div style="width: 64px; height: 64px;">${files['logo-favicon.svg']}</div>
      </div>
    </div>

    <!-- 6. Dark Mode Stacked -->
    <div class="card dark">
      <div class="card-header">
        <h3>Dark Mode (Stacked)</h3>
        <span class="file-badge">logo-white-stacked.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-white-stacked.svg']}
      </div>
    </div>

    <!-- 7. Dark Mode Horizontal -->
    <div class="card dark">
      <div class="card-header">
        <h3>Dark Mode (Horizontal)</h3>
        <span class="file-badge">logo-white-horizontal.svg</span>
      </div>
      <div class="preview-box">
        ${files['logo-white-horizontal.svg']}
      </div>
    </div>
  </div>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'preview.html'), previewHtml, 'utf8');
console.log('Complete brand suite generated successfully!');
