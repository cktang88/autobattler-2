// Render one proto3d lab lineup from several camera views in ONE browser session (fast, survives a loaded machine).
// Needs `npm run build:proto3d` and a static server on public/ (e.g. `cd public && python3 -m http.server 8766`).
//
//   LAB='raider:legs:0:laser|laser' VIEWS='front@0,0,4.5,10,50,0.8;game@0,0,14,57,40,0' OUT=/tmp/shots \
//     NODE_PATH=$(npm root -g) node scripts/3d/shots.cjs
//
// LAB  = chassis:mobility[:seed[:w1|w2|..]] (comma-separate several units; see proto3d/main.ts ?lab=)
// VIEW = name@targetX,targetZ,distance,tiltDeg,yawDeg,targetY   (writes OUT/name.png, 900x600)
// Q    = extra query string, e.g. '&simp=0' (no mesh simplification) for a before / after
// PORT = server port (8766)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  p.setDefaultTimeout(240000);
  p.on('pageerror', (e) => console.log('err', e.message));
  const port = process.env.PORT || 8766, out = process.env.OUT || '.';
  await p.goto(`http://localhost:${port}/proto3d.html?labels=0&ao=0&t=3&freeze=1${process.env.Q || ''}&lab=${process.env.LAB}`, { waitUntil: 'commit' });
  await p.waitForFunction(() => window.unitStats && window.unitStats().length > 0, null, { polling: 500 });
  console.log(JSON.stringify(await p.evaluate(() => window.unitStats())));
  for (const v of process.env.VIEWS.split(';')) {
    const [name, view] = v.split('@');
    await p.evaluate((vv) => window.setView(...vv.split(',').map(Number)), view);
    await p.evaluate(() => window.renderOnce());
    await p.waitForFunction(() => window.done === true, null, { polling: 300 });
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log('shot', name);
  }
  await b.close();
  process.exit(0);
})();
