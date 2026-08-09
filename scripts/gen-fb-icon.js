// One-off: generate a 1024×1024 PNG Facebook app icon from the site brand.
// Run: `node scripts/gen-fb-icon.js` — writes public/assets/icons/fb-app-icon.png.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<!DOCTYPE html><html><head><style>body{margin:0;padding:0;background:#010A13}</style></head><body><canvas id="c" width="1024" height="1024"></canvas><script>
    const ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#010A13'; ctx.fillRect(0,0,1024,1024);
    ctx.strokeStyle = '#C8AA6E'; ctx.lineWidth = 32; ctx.strokeRect(16,16,992,992);
    ctx.fillStyle = '#C8AA6E'; ctx.font = '900 640px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', 512, 540);
  </script></body></html>`);
  await page.waitForTimeout(100);
  const buf = await page.locator('#c').screenshot({ omitBackground: false });
  require('fs').writeFileSync('public/assets/icons/fb-app-icon.png', buf);
  await browser.close();
  console.log('wrote', buf.length, 'bytes →', 'public/assets/icons/fb-app-icon.png');
})();
