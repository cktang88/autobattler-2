// Screenshot the real Unit Designer (garage) for some starter designs: the 3D bench with its socket rings.
// Needs the game built and served: `npm run build && PORT=8790 DATA_DIR=/tmp/gdata node src/server/main.ts`.
//
//   NAMES='Ironclad,Aegis Wall,Field Medic' OUT=/tmp/shots NODE_PATH=$(npm root -g) node scripts/3d/garage-shots.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  p.setDefaultTimeout(240000);
  p.on('pageerror', (e) => console.log('err', e.message));
  const out = process.env.OUT || '.';
  await p.goto(`http://localhost:${process.env.PORT || 8790}/`, { waitUntil: 'load' });
  await p.waitForTimeout(3000);
  await p.getByText('Unit Designer').first().click();
  await p.waitForTimeout(8000);
  for (const name of (process.env.NAMES || '').split(',')) {
    await p.getByText(`${name} (Standard)`).first().click();
    await p.waitForTimeout(9000);
    await p.screenshot({ path: `${out}/garage_${name.replace(/\W/g, '')}.png`, clip: { x: 284, y: 184, width: 636, height: 460 } });
    console.log('shot', name);
  }
  await b.close();
  process.exit(0);
})();
