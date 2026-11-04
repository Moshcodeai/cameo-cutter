// Tests: SVG parsing sanity + byte-for-byte comparison with the Python driver.
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../cutter-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO || '/root/inkscape-silhouette';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;

const parse = (svg) => new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
const len = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

// 1. units + square
{
  const r = core.svgToPaths(parse(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="50" height="50" fill="none" stroke="#000"/></svg>`));
  const b = core.bboxOf(r.paths);
  ok(r.paths.length === 1 && near(b.x0, 10) && near(b.x1, 60) && near(b.y1, 60), 'rect 50mm in mm viewBox');
  ok(near(len(r.paths[0]), 200), 'rect perimeter 200mm (got ' + len(r.paths[0]).toFixed(3) + ')');
}
// 2. circle accuracy
{
  const r = core.svgToPaths(parse(`<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><circle cx="100" cy="100" r="40"/></svg>`));
  const p = r.paths[0];
  const maxErr = Math.max(...p.map(([x, y]) => Math.abs(Math.hypot(x - 100, y - 100) - 40)));
  ok(maxErr < 0.03, 'circle stays within 0.03mm of true radius (max ' + maxErr.toFixed(4) + ')');
  ok(near(len(p), 2 * Math.PI * 40, 0.1), 'circle length ≈ 2πr');
}
// 3. px units, transforms, use, hidden, text warning, packed arc flags
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="96" height="96">
    <defs><path id="tri" d="M0,0 L10,0 L5,8z"/></defs>
    <g transform="translate(48,0) scale(2)"><line x1="0" y1="0" x2="24" y2="0"/></g>
    <use xlink:href="#tri" x="10" y="10"/>
    <rect width="5" height="5" style="display:none"/>
    <text x="0" y="50">Hi</text>
    <path d="M10 60a5 5 0 0110 0"/>
  </svg>`;
  const r = core.svgToPaths(parse(svg));
  const px = 25.4 / 96;
  ok(r.paths.length === 3, 'line + used triangle + arc; hidden rect skipped (got ' + r.paths.length + ')');
  const line = r.paths[0];
  ok(near(line[0][0], 48 * px, 0.001) && near(line[1][0], 96 * px, 0.001), 'translate+scale applied, px→mm');
  ok(r.warnings.some((w) => /Text/.test(w)), 'text warning raised');
  const arc = r.paths[2];
  ok(near(arc[arc.length - 1][0], 20 * px, 0.001) && near(Math.min(...arc.map((q) => q[1])), 55 * px, 0.02), 'packed arc flags parsed (half circle over the top)');
}
// 4. ordering: inner first
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/><rect x="40" y="40" width="10" height="10"/></svg>`;
  const o = core.orderPaths(core.svgToPaths(parse(svg)).paths);
  ok(core.bboxOf([o[0]]).w < 20, 'inner shape is cut before the outer one');
}

// 5. byte-for-byte vs Python driver
const tmp = mkdtempSync(join(tmpdir(), 'cutter-'));
function compare(label, hwName, hwKey, paths, settings, mediaHeight) {
  const hw = { key: hwKey, ...core.HARDWARE[hwKey] };
  const js = [
    Uint8Array.of(0x1b, 0x04),
    core.encodeCommands(core.setupCommands(hw, settings, null)),
  ];
  const plot = core.plotCommands(hw, paths, { mediaHeight, offset: [0, 0] });
  js.push(core.encodeCommands(plot.cmds), core.encodeCommands(core.endCommands(plot.bbox, 0)));
  const jsBytes = Buffer.concat(js.map((b) => Buffer.from(b)));
  const jobFile = join(tmp, label + '.json'), out = join(tmp, label + '.bin');
  writeFileSync(jobFile, JSON.stringify({ hardware: hwName, paths, settings, mediaWidth: hw.width, mediaHeight }));
  execFileSync('python3', ['-I', join(here, 'make-reference.py'), REPO, jobFile, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  const py = readFileSync(out);
  const same = py.equals(jsBytes);
  ok(same, `${label}: identical to Python driver (${jsBytes.length} bytes)`);
  if (!same) {
    const a = py.toString('latin1').split('\x03'), b = jsBytes.toString('latin1').split('\x03');
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log('   first diff at cmd', i, JSON.stringify(a[i]), 'vs', JSON.stringify(b[i])); break; }
  }
}
const design = core.orderPaths(core.svgToPaths(parse(`<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
  <rect x="5" y="5" width="50" height="50" rx="6"/><circle cx="85" cy="30" r="22.5"/><path d="M10 70 C 30 60, 50 80, 70 70 S 110 60, 115 75"/>
  <path d="M-5 -5 L 20 20"/></svg>`)).paths);
compare('autoblade-12x12', 'Silhouette_Cameo5', 'cameo5', design,
  { mat: 'cameo_12x12', tool: 'autoblade', pressure: 14, speed: 5, depth: 3, toolholder: 1 }, 304.8);
compare('pen-nomat', 'Silhouette_Cameo5', 'cameo5', design,
  { mat: 'no_mat', tool: 'pen', pressure: 10, speed: 8, toolholder: 2 }, 500);
compare('alpha-blade-12x24', 'Silhouette_Cameo5_Alpha', 'cameo5alpha', design,
  { mat: 'cameo_12x24', tool: 'blade', pressure: 38, speed: 40, toolholder: 1 }, 609.6);
compare('half-steps', 'Silhouette_Cameo5', 'cameo5', [[[0.025, 0.075], [10.125, 3.175], [-0.025, 2.5]]],
  { mat: 'cameo_12x12', tool: 'autoblade', pressure: 10, speed: 10, depth: 1 }, 304.8);

// 6. chunking keeps whole commands
{
  const bytes = core.encodeCommands(Array.from({ length: 400 }, (_, i) => `D${i * 7},${i * 3}`));
  const ch = core.safeChunks(bytes);
  ok(ch.every((c) => c.length <= 1024 && c[c.length - 1] === 0x03) && ch.reduce((a, c) => a + c.length, 0) === bytes.length,
    `chunks ≤1024 bytes, end on a whole command (${ch.length} chunks)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
