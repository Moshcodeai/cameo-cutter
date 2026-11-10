// Cameo Cutter core — pure logic, no UI.
// Protocol port of fablabnbg/inkscape-silhouette (GPLv2), Cameo 4/5 family path.
// Units: everything in mm until command generation; 1 mm = 20 SU.

export const ETX = 0x03;
export const ESC = 0x1b;

// ---------------------------------------------------------------- hardware

export const BLE = {
  SERVICE: 'e2088282-4fde-42f9-bb22-6ec3c7ed8f91',
  WRITE: '6d92661d-f429-4d67-929b-28e7a9780912',
  READ: '8dcf199a-30e7-4bd4-beb6-beb57dca866c',
  CONTROL: '61490654-b5b4-458c-a867-9e15bc1471e0',
  INIT: [0x1b, 0x04],
  CHUNK: 20,
};

export const USB = { WRITE_EP: 1, READ_EP: 2, VENDORS: [0x0b4d, 0x3844] };

// All of these are in the Python driver's PRODUCT_LINE_CAMEO4 (same command set).
const HW = {
  cameo4:          { name: 'Cameo 4',            width: 304.8, twoTools: true },
  cameo4plus:      { name: 'Cameo 4 Plus',       width: 372,   twoTools: true },
  cameo4pro:       { name: 'Cameo 4 Pro',        width: 600,   twoTools: true },
  cameo5:          { name: 'Cameo 5',            width: 330.2, twoTools: true },
  cameo5plus:      { name: 'Cameo 5 Plus',       width: 372,   twoTools: true },
  cameoProMk2:     { name: 'Cameo Pro MK II',    width: 609,   twoTools: true },
  cameo5alpha:     { name: 'Cameo 5 Alpha',      width: 330.2, twoTools: true, maxPressure: 40 },
  cameo5alphaplus: { name: 'Cameo 5 Alpha Plus', width: 372,   twoTools: true, maxPressure: 40 },
};
export const HARDWARE = HW;

const USB_IDS = {
  '0b4d:1137': 'cameo4', '0b4d:1138': 'cameo4plus', '0b4d:1139': 'cameo4pro',
  '0b4d:1140': 'cameo5', '0b4d:1141': 'cameo5plus', '0b4d:1146': 'cameoProMk2',
  '3844:0001': 'cameo5alpha', '3844:0002': 'cameo5alphaplus',
};

// Order matters: most specific first.
const NAMES = [
  ['CAMEO 5 ALPHA PLUS', 'cameo5alphaplus'], ['CAMEO 5 ALPHA', 'cameo5alpha'],
  ['CAMEO 5 PLUS', 'cameo5plus'], ['CAMEO 5', 'cameo5'],
  ['CAMEO PRO MARK2', 'cameoProMk2'], ['CAMEO 4 PLUS', 'cameo4plus'],
  ['CAMEO 4 PRO', 'cameo4pro'], ['CAMEO 4', 'cameo4'],
];

const hex4 = (n) => n.toString(16).padStart(4, '0');
export function hardwareFromUsb(vendorId, productId) {
  const key = USB_IDS[`${hex4(vendorId)}:${hex4(productId)}`];
  return key ? { key, ...HW[key] } : null;
}
export function hardwareFromName(s) {
  if (!s) return null;
  const n = s.trim().toUpperCase();
  for (const [name, key] of NAMES) if (n.startsWith(name) || n.includes(name)) return { key, ...HW[key] };
  return null;
}

// ---------------------------------------------------------------- commands

// Python's round() is round-half-to-even; match it so output is identical.
const pyRound = (v) => {
  const f = Math.floor(v), d = v - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(v) + 0; // + 0 turns -0 into 0
};
const su = (mm) => pyRound(mm * 20);
const inSU = (inch) => pyRound(inch * 508);
const M = (y, x) => `M${su(y)},${su(x)}`;
const D = (y, x) => `D${su(y)},${su(x)}`;

export const MATS = {
  cameo_12x12: { code: '1', w: 12, h: 12, label: '12 × 12 mat' },
  cameo_12x24: { code: '2', w: 12, h: 24, label: '12 × 24 mat' },
  cameo_plus_15x15: { code: '8', w: 15, h: 15, label: '15 × 15 mat' },
  no_mat: { code: '0', w: 0, h: 0, label: 'No mat (roll)' },
};

/**
 * Setup commands for the Cameo 4/5 family, mirroring Graphtec.setup().
 * opts: { mat, pressure, speed, depth, tool: 'autoblade'|'blade'|'pen',
 *         toolholder, bladeDiameter, sharpenCorners, sharpenStart, sharpenEnd }
 * currentTool: number from the ESC NAK query for this holder, or null.
 */
export function setupCommands(hw, opts, currentTool = null) {
  const o = {
    mat: 'cameo_12x12', toolholder: 1, bladeDiameter: 0.9, sharpenCorners: false,
    sharpenStart: 0.1, sharpenEnd: 0.1, tool: 'autoblade', ...opts,
  };
  const th = o.toolholder;
  const pen = o.tool === 'pen';
  const cmds = [];

  // set_cutting_mat
  const mat = MATS[o.mat] || MATS.cameo_12x12;
  cmds.push('TG' + mat.code);
  cmds.push('FN0', 'TB50,0');
  if (mat.w) cmds.push('\\0,0', `Z${inSU(mat.h)},${inSU(mat.w)}`);
  else cmds.push('\\0,0', `Z${su(3000)},${su(hw.width)}`);

  // tool select
  if (hw.twoTools) cmds.push(`J${th}`);

  let pressure = o.pressure;
  const maxP = hw.maxPressure || 33;
  if (pressure > maxP) pressure = maxP;
  cmds.push(`FX${pressure},${th}`, 'TJ0');

  let speed = Math.min(30, Math.max(1, o.speed));
  cmds.push(`!${speed},${th}`);
  cmds.push(`FC0,1,${th}`);                       // cutter offset 0mm x 0.05mm
  cmds.push(`FE${o.sharpenCorners ? 1 : 0},${th}`); // lift
  if (pen) cmds.push(`FF0,0,${th}`, `FF0,0,${th}`);
  else {
    const s = Math.trunc((o.sharpenStart + 0.05) * 10);
    const e = Math.trunc((o.sharpenEnd + 0.05) * 10);
    cmds.push(`FF${s},0,${th}`, `FF${s},${e},${th}`);
  }
  pressure = Math.min(33, Math.max(1, pressure));
  cmds.push(`FX${pressure},${th}`, 'TJ3');
  cmds.push(pen ? `FC0,1,${th}` : `FC${su(o.bladeDiameter)},1,${th}`);

  if (o.tool === 'autoblade' && o.depth != null) {
    const okTool = currentTool == null || currentTool === 2 || currentTool === 0;
    if (okTool && th === 1) cmds.push(`TF${Math.min(10, Math.max(0, o.depth))},${th}`);
  }
  return cmds;
}

/**
 * Plot commands, mirroring Graphtec.plot_cmds() with software clipping.
 * paths: [[[x,y],...],...] in mm (x across the machine, y down the feed).
 */
export function plotCommands(hw, paths, { mediaWidth, mediaHeight, offset = [0, 0], slowTravel = null } = {}) {
  // slowTravel: { speed, cutSpeed, holder, minFeedMm } — blade-up moves that feed
  // the mat more than minFeedMm (e.g. from the top tape to the bottom tape) run
  // at `speed`, then the cut speed is put back, so the mat isn't jerked through
  // the rollers. Moves along the same strip stay at normal speed.
  const width = hw.width ?? mediaWidth;            // left-aligned: hardware width
  const clip = { llx: 0, urx: width, ury: 0, lly: mediaHeight };
  const fuzz = 0.05;
  const clipPt = (x, y) => {
    let inside = true;
    if (clip.llx - x > fuzz) { x = clip.llx; inside = false; }
    if (x - clip.urx > fuzz) { x = clip.urx; inside = false; }
    if (clip.ury - y > fuzz) { y = clip.ury; inside = false; }
    if (y - clip.lly > fuzz) { y = clip.lly; inside = false; }
    return [x, y, inside];
  };
  const bbox = {};
  const ext = (x, y) => {
    if (!('llx' in bbox) || x < bbox.llx) bbox.llx = x;
    if (!('urx' in bbox) || x > bbox.urx) bbox.urx = x;
    if (!('lly' in bbox) || y > bbox.lly) bbox.lly = y;
    if (!('ury' in bbox) || y < bbox.ury) bbox.ury = y;
  };
  const xo = offset[0] + clip.llx, yo = offset[1] + clip.ury;
  const cmds = [];
  let clipped = 0;
  let hx = 0, hy = 0, slowMoves = 0; // head starts at the mat origin
  for (const p of paths) {
    if (p.length < 2) continue;
    let x = p[0][0] + xo, y = p[0][1] + yo;
    ext(x, y);
    let last;
    [x, y, last] = clipPt(x, y);
    if (!last) clipped++;
    const far = slowTravel && Math.abs(y - hy) > (slowTravel.minFeedMm ?? 50);
    if (far) cmds.push(`!${slowTravel.speed},${slowTravel.holder}`);
    cmds.push(M(y, x));
    if (far) { cmds.push(`!${slowTravel.cutSpeed},${slowTravel.holder}`); slowMoves++; }
    for (let j = 1; j < p.length; j++) {
      x = p[j][0] + xo; y = p[j][1] + yo;
      ext(x, y);
      let inside;
      [x, y, inside] = clipPt(x, y);
      if (!inside) clipped++;
      cmds.push(inside && last ? D(y, x) : M(y, x));
      last = inside;
    }
    hx = x; hy = y;
  }
  return { cmds, bbox, clipped, slowMoves };
}

/**
 * Finish the job, mirroring Graphtec.plot()'s trailer.
 * 'start' (mats): bring the mat back to where it started, like Silhouette Studio,
 *   so one press of the unload button brings it out.
 * 'below' (roll): park the media just past the cut and make that the new origin.
 */
export function endCommands(bbox, endOffset = 0, endPosition = 'below') {
  if (endPosition === 'start') return ['L0', '\\0,0', 'M0,0', 'J0', 'FN0', 'TB50,0'];
  return [M((bbox.lly || 0) + endOffset, 0), 'SO0'];
}

export function encodeCommands(list) {
  const s = list.map((c) => c + '\x03').join('');
  return new TextEncoder().encode(s);
}

/** Split into ≤ max-byte chunks that each end on an ETX (Graphtec.safe_write). */
export function safeChunks(bytes, max = 1024) {
  const out = [];
  let o = 0;
  while (o < bytes.length) {
    const cand = bytes.subarray(o, Math.min(o + max, bytes.length));
    let cut = cand.lastIndexOf(ETX) + 1;
    if (cut === 0) cut = cand.length; // single command longer than max (never in practice)
    out.push(cand.subarray(0, cut));
    o += cut;
  }
  return out;
}

// ---------------------------------------------------------------- SVG → paths

const NS_SVG = 'http://www.w3.org/2000/svg';
const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'title',
  'desc', 'metadata', 'style', 'script', 'linearGradient', 'radialGradient', 'filter']);

const I = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(s) {
  let m = I;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s))) {
    const v = (t[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);
    let n;
    switch (t[1]) {
      case 'matrix': n = v.length === 6 ? v : I; break;
      case 'translate': n = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale': n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = ((v[0] || 0) * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
        n = [c, s2, -s2, c, 0, 0];
        if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

function lengthToMM(str) {
  if (str == null || str === '') return null;
  const m = String(str).trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*([a-z%]*)$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const f = { '': 25.4 / 96, px: 25.4 / 96, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 }[u];
  return f == null ? null : v * f;
}

// Tokenise path data. Arc flags may be packed without separators ("a1 1 0 00 10 10").
function* pathTokens(d) {
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let t;
  while ((t = re.exec(d))) yield t[1] ? { cmd: t[1] } : { num: t[2], idx: t.index };
}

function parsePathData(d) {
  // Returns list of segments in user space: {type:'M'|'L'|'C'|'Z', pts}
  const out = [];
  const toks = [...pathTokens(d)];
  let i = 0, cmd = null;
  let cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
  const num = () => {
    const t = toks[i];
    if (!t || t.cmd) throw new Error('bad path');
    i++;
    return parseFloat(t.num);
  };
  // Arc flags are a single 0/1 and may be packed: "a1 1 0 0110 10" → 0,1,10,10
  const flag = () => {
    const t = toks[i];
    if (!t || t.cmd) throw new Error('bad path');
    const s = t.num;
    if (s.length > 1 && (s[0] === '0' || s[0] === '1')) { t.num = s.slice(1); return +s[0]; }
    i++;
    return +s ? 1 : 0;
  };
  while (i < toks.length) {
    if (toks[i].cmd) {
      cmd = toks[i].cmd; i++;
      if (cmd === 'Z' || cmd === 'z') {
        out.push({ type: 'Z' });
        cx = sx; cy = sy; lc = lq = null;
        if (toks[i] && !toks[i].cmd) throw new Error('numbers after Z');
        continue;
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') throw new Error('path must start with a command');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ax = (v) => (rel ? cx + v : v), ay = (v) => (rel ? cy + v : v);
    {
      switch (C) {
        case 'M': {
          const x = ax(num()), y = ay(num());
          out.push({ type: 'M', pts: [[x, y]] });
          cx = sx = x; cy = sy = y; lc = lq = null;
          cmd = rel ? 'l' : 'L'; // implicit lineto
          break;
        }
        case 'L': { const x = ax(num()), y = ay(num()); out.push({ type: 'L', pts: [[x, y]] }); cx = x; cy = y; lc = lq = null; break; }
        case 'H': { const x = rel ? cx + num() : num(); out.push({ type: 'L', pts: [[x, cy]] }); cx = x; lc = lq = null; break; }
        case 'V': { const y = rel ? cy + num() : num(); out.push({ type: 'L', pts: [[cx, y]] }); cy = y; lc = lq = null; break; }
        case 'C': {
          const x1 = ax(num()), y1 = ay(num()), x2 = ax(num()), y2 = ay(num()), x = ax(num()), y = ay(num());
          out.push({ type: 'C', pts: [[x1, y1], [x2, y2], [x, y]] }); lc = [x2, y2]; lq = null; cx = x; cy = y; break;
        }
        case 'S': {
          const r1 = lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
          const x2 = ax(num()), y2 = ay(num()), x = ax(num()), y = ay(num());
          out.push({ type: 'C', pts: [r1, [x2, y2], [x, y]] }); lc = [x2, y2]; lq = null; cx = x; cy = y; break;
        }
        case 'Q': {
          const qx = ax(num()), qy = ay(num()), x = ax(num()), y = ay(num());
          out.push({ type: 'C', pts: q2c(cx, cy, qx, qy, x, y) }); lq = [qx, qy]; lc = null; cx = x; cy = y; break;
        }
        case 'T': {
          const q = lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy];
          const x = ax(num()), y = ay(num());
          out.push({ type: 'C', pts: q2c(cx, cy, q[0], q[1], x, y) }); lq = q; lc = null; cx = x; cy = y; break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag(), x = ax(num()), y = ay(num());
          for (const c of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) out.push({ type: 'C', pts: c });
          lc = lq = null; cx = x; cy = y; break;
        }
        default: throw new Error('unknown command ' + cmd);
      }
    }
  }
  return out;
}

function q2c(x0, y0, qx, qy, x, y) {
  return [[x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0)], [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)], [x, y]];
}

function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[[x1, y1], [x2, y2], [x2, y2]]];
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => {
    const x = rx * Math.cos(t), y = ry * Math.sin(t);
    return [cp * x - sp * y + cx, sp * x + cp * y + cy];
  };
  const dv = (t) => {
    const x = -rx * Math.sin(t), y = ry * Math.cos(t);
    return [cp * x - sp * y, sp * x + cp * y];
  };
  const res = [];
  for (let j = 0; j < n; j++) {
    const a = t1 + j * step, b = a + step;
    const p0 = pt(a), p3 = pt(b), d0 = dv(a), d3 = dv(b);
    res.push([[p0[0] + k * d0[0], p0[1] + k * d0[1]], [p3[0] - k * d3[0], p3[1] - k * d3[1]], p3]);
  }
  const last = res[res.length - 1];
  last[2] = [x2, y2];
  return res;
}

function flattenCubic(p0, p1, p2, p3, tol, out, depth = 0) {
  const ux = 3 * p1[0] - 2 * p0[0] - p3[0], uy = 3 * p1[1] - 2 * p0[1] - p3[1];
  const vx = 3 * p2[0] - p0[0] - 2 * p3[0], vy = 3 * p2[1] - p0[1] - 2 * p3[1];
  const flat = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  if (flat <= 16 * tol * tol || depth > 18) { out.push(p3); return; }
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = m(p0, p1), p12 = m(p1, p2), p23 = m(p2, p3);
  const p012 = m(p01, p12), p123 = m(p12, p23), mid = m(p012, p123);
  flattenCubic(p0, p01, p012, mid, tol, out, depth + 1);
  flattenCubic(mid, p123, p23, p3, tol, out, depth + 1);
}

function segmentsToPolylines(segs, m, tol) {
  const lines = [];
  let cur = null, start = null;
  for (const s of segs) {
    if (s.type === 'M') {
      if (cur && cur.length > 1) lines.push(cur);
      start = ap(m, ...s.pts[0]);
      cur = [start];
    } else if (s.type === 'L') {
      if (!cur) cur = [start = [0, 0]];
      cur.push(ap(m, ...s.pts[0]));
    } else if (s.type === 'C') {
      if (!cur) cur = [start = [0, 0]];
      const p0 = cur[cur.length - 1];
      flattenCubic(p0, ap(m, ...s.pts[0]), ap(m, ...s.pts[1]), ap(m, ...s.pts[2]), tol, cur);
    } else if (s.type === 'Z') {
      if (cur && cur.length) {
        const a = cur[cur.length - 1];
        if (Math.hypot(a[0] - start[0], a[1] - start[1]) > 1e-9) cur.push([...start]);
        else cur[cur.length - 1] = [...start];
        if (cur.length > 1) lines.push(cur);
        cur = [[...start]];
      }
    }
  }
  if (cur && cur.length > 1) lines.push(cur);
  return lines;
}

const fnum = (el, a, d = 0) => {
  const v = parseFloat(el.getAttribute(a));
  return Number.isFinite(v) ? v : d;
};

function shapeToPathData(el) {
  const tag = el.localName;
  if (tag === 'path') return el.getAttribute('d') || '';
  if (tag === 'rect') {
    const x = fnum(el, 'x'), y = fnum(el, 'y'), w = fnum(el, 'width'), h = fnum(el, 'height');
    if (w <= 0 || h <= 0) return '';
    let rx = el.hasAttribute('rx') ? fnum(el, 'rx') : null, ry = el.hasAttribute('ry') ? fnum(el, 'ry') : null;
    if (rx == null) rx = ry ?? 0; if (ry == null) ry = rx;
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx || !ry) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
      `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
      `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = fnum(el, 'cx'), cy = fnum(el, 'cy');
    const rx = tag === 'circle' ? fnum(el, 'r') : fnum(el, 'rx');
    const ry = tag === 'circle' ? rx : fnum(el, 'ry');
    if (rx <= 0 || ry <= 0) return '';
    return `M${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx},${cy + ry}A${rx},${ry} 0 0 1 ${cx - rx},${cy}` +
      `A${rx},${ry} 0 0 1 ${cx},${cy - ry}A${rx},${ry} 0 0 1 ${cx + rx},${cy}Z`;
  }
  if (tag === 'line') return `M${fnum(el, 'x1')},${fnum(el, 'y1')}L${fnum(el, 'x2')},${fnum(el, 'y2')}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const v = (el.getAttribute('points') || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    if (v.length < 4) return '';
    let d = `M${v[0]},${v[1]}`;
    for (let k = 2; k + 1 < v.length; k += 2) d += `L${v[k]},${v[k + 1]}`;
    return tag === 'polygon' ? d + 'Z' : d;
  }
  return '';
}

function isHidden(el) {
  const st = (el.getAttribute('style') || '').replace(/\s/g, '');
  return el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden' ||
    /display:none/.test(st) || /visibility:hidden/.test(st);
}

/**
 * Parse an SVG Document into mm polylines.
 * Returns { paths, warnings, sizeMM: [w,h] }.
 */
export function svgToPaths(doc, { tolerance = 0.02 } = {}) {
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') throw new Error('Not an SVG file');
  const warnings = new Set();
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const wmm = lengthToMM(root.getAttribute('width'));
  const hmm = lengthToMM(root.getAttribute('height'));
  let base;
  let sizeMM;
  if (hasVB) {
    const sx = wmm != null ? wmm / vb[2] : hmm != null ? hmm / vb[3] : 25.4 / 96;
    const sy = hmm != null ? hmm / vb[3] : sx;
    const s = Math.min(sx, sy); // preserveAspectRatio xMidYMid meet, offsets ignored
    base = [s, 0, 0, s, -vb[0] * s, -vb[1] * s];
    sizeMM = [vb[2] * s, vb[3] * s];
  } else {
    const s = 25.4 / 96;
    base = [s, 0, 0, s, 0, 0];
    sizeMM = [wmm ?? 0, hmm ?? 0];
  }
  if (root.getAttribute('width')?.trim().endsWith('%')) warnings.add('Size given in %, assumed 96 dpi');

  const paths = [];
  const byId = (id) => doc.getElementById ? doc.getElementById(id) : root.querySelector(`#${CSS.escape(id)}`);
  const walk = (el, m, depth) => {
    if (depth > 30) return;
    for (const c of el.children) {
      const tag = c.localName;
      if (SKIP.has(tag) || isHidden(c)) continue;
      const cm = mul(m, parseTransform(c.getAttribute('transform')));
      if (tag === 'g' || tag === 'a' || tag === 'switch') { walk(c, cm, depth + 1); continue; }
      if (tag === 'svg') { // nested svg: treat as group with x/y offset
        walk(c, mul(cm, [1, 0, 0, 1, fnum(c, 'x'), fnum(c, 'y')]), depth + 1); continue;
      }
      if (tag === 'use') {
        const href = c.getAttribute('href') || c.getAttribute('xlink:href') ||
          c.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
        const ref = href && href.startsWith('#') ? byId(href.slice(1)) : null;
        if (ref) {
          const um = mul(cm, [1, 0, 0, 1, fnum(c, 'x'), fnum(c, 'y')]);
          const holder = { children: ref.localName === 'symbol' || ref.localName === 'g' ? ref.children : [ref] };
          walk(holder, um, depth + 1);
        }
        continue;
      }
      if (tag === 'text' || tag === 'tspan' || tag === 'textPath') { warnings.add('Text found: convert text to paths before cutting'); continue; }
      if (tag === 'image') { warnings.add('Images are ignored, only lines are cut'); continue; }
      const d = shapeToPathData(c);
      if (!d) continue;
      try {
        for (const pl of segmentsToPolylines(parsePathData(d), cm, tolerance)) paths.push(pl);
      } catch (e) {
        warnings.add('Skipped a shape the parser could not read');
      }
    }
  };
  walk(root, base, 0);
  return { paths: paths.map(dedupe).filter((p) => p.length > 1), warnings: [...warnings], sizeMM };
}

function dedupe(p) {
  const out = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = out[out.length - 1];
    if (Math.hypot(p[i][0] - a[0], p[i][1] - a[1]) >= 0.01 || i === p.length - 1) out.push(p[i]);
  }
  return out;
}

export function bboxOf(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Cut order: shapes inside other shapes first (so holes in letters are cut
 * before the outline frees the piece), then nearest-next to save travel.
 * Closed shapes start at the vertex nearest the head.
 */
export function orderPaths(paths) {
  const items = paths.map((p) => ({ p, b: bboxOf([p]) }));
  for (const a of items) {
    a.depth = 0;
    for (const b of items) {
      if (a === b) continue;
      if (b.b.x0 <= a.b.x0 + 1e-6 && b.b.y0 <= a.b.y0 + 1e-6 && b.b.x1 >= a.b.x1 - 1e-6 && b.b.y1 >= a.b.y1 - 1e-6 &&
        (b.b.w * b.b.h > a.b.w * a.b.h + 1e-6)) a.depth++;
    }
  }
  // Separate areas (e.g. a top tape and a bottom tape) are finished one at a
  // time, nearest first, so the head only makes the long trip once.
  const islands = clusterItems(items, 15);
  const out = [];
  let head = [0, 0];
  while (islands.length) {
    let bi = 0, bd = Infinity;
    islands.forEach((isl, i) => {
      for (const it of isl) {
        const d = Math.max(0, it.b.x0 - head[0], head[0] - it.b.x1) ** 2 + Math.max(0, it.b.y0 - head[1], head[1] - it.b.y1) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
    });
    head = orderIsland(islands.splice(bi, 1)[0], head, out);
  }
  return out;
}

function clusterItems(items, gap) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].b, b = items[j].b;
    if (a.x0 - b.x1 <= gap && b.x0 - a.x1 <= gap && a.y0 - b.y1 <= gap && b.y0 - a.y1 <= gap) parent[find(i)] = find(j);
  }
  const m = new Map();
  items.forEach((it, i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(it); });
  return [...m.values()];
}

function orderIsland(items, [hx, hy], out) {
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.depth)) groups.set(it.depth, []); groups.get(it.depth).push(it); }
  const depths = [...groups.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    const left = groups.get(d).slice();
    while (left.length) {
      let best = 0, bestD = Infinity, bestIdx = 0;
      for (let i = 0; i < left.length; i++) {
        const p = left[i].p;
        const closed = isClosed(p);
        const cands = closed ? p : [p[0], p[p.length - 1]];
        for (let k = 0; k < cands.length; k++) {
          const dd = (cands[k][0] - hx) ** 2 + (cands[k][1] - hy) ** 2;
          if (dd < bestD) { bestD = dd; best = i; bestIdx = closed ? k : k === 0 ? 0 : -1; }
        }
      }
      let p = left.splice(best, 1)[0].p;
      if (isClosed(p) && bestIdx > 0) p = rotateClosed(p, bestIdx);
      else if (bestIdx === -1) p = p.slice().reverse();
      out.push(p);
      [hx, hy] = p[p.length - 1];
    }
  }
  return [hx, hy];
}

const isClosed = (p) => p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.01;
function rotateClosed(p, k) {
  const ring = p.slice(0, -1);
  const r = ring.slice(k).concat(ring.slice(0, k));
  r.push([...r[0]]);
  return r;
}

/** Add a small overcut to closed shapes so the start/end join is clean (blades only). */
export function addOvercut(paths, mm) {
  if (!mm) return paths;
  return paths.map((p) => {
    if (!isClosed(p)) return p;
    const out = p.slice();
    let need = mm;
    for (let i = 1; i < p.length && need > 0; i++) {
      const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L >= need) { const t = need / L; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); need = 0; }
      else { out.push(b); need -= L; }
    }
    return out;
  });
}

export function translatePaths(paths, dx, dy) {
  return paths.map((p) => p.map(([x, y]) => [x + dx, y + dy]));
}

// ---------------------------------------------------------------- job runner

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = new TextDecoder();

/**
 * Transport interface: write(Uint8Array) → Promise, and an inbound byte
 * buffer fed by notifications / a background reader. Implemented in the page.
 */
export class Link {
  constructor() { this.buf = []; this.waiters = []; this.closed = false; }
  push(bytes) { for (const b of bytes) this.buf.push(b); this.waiters.splice(0).forEach((w) => w()); }
  clear() { this.buf.length = 0; }
  async readReply(timeout = 1000) {
    const end = Date.now() + timeout;
    for (;;) {
      const i = this.buf.indexOf(ETX);
      if (i >= 0) return Uint8Array.from(this.buf.splice(0, i + 1));
      if (this.closed) throw new Error('Cutter disconnected');
      const left = end - Date.now();
      if (left <= 0) throw new Error('No reply from cutter');
      await new Promise((r) => { this.waiters.push(r); setTimeout(r, Math.min(left, 100)); });
    }
  }
}

export class Cutter {
  constructor(transport, log = () => {}) { this.t = transport; this.log = log; this.hw = null; }

  async send(cmds) { await this.t.write(encodeCommands(Array.isArray(cmds) ? cmds : [cmds])); }
  async esc(code) { await this.t.write(Uint8Array.of(ESC, code)); }

  async ask(writeFn, timeout = 1000) {
    this.t.link.clear();
    await writeFn();
    try {
      const r = await this.t.link.readReply(timeout);
      return dec.decode(r.subarray(0, r.length - 1));
    } catch { return null; }
  }
  version() { return this.ask(() => this.send('FG'), 10000); }
  query(cmd) { return this.ask(() => this.send(cmd), 1000); }

  async status() {
    const r = await this.ask(() => this.esc(0x05), 5000);
    if (r == null) return 'none';
    const s = r.trim();
    return { '0': 'ready', '1': 'moving', '2': 'unloaded' }[s] || s;
  }

  async toolSetup() {
    const r = await this.ask(() => this.esc(0x15), 1000);
    if (!r) return null;
    const parts = r.split(',').map((v) => parseInt(v, 10));
    return parts.every(Number.isFinite) ? parts : null;
  }

  async waitReady(timeout = 120000, interval = 50, onWait) {
    const end = Date.now() + timeout;
    let s = await this.status();
    while (s !== 'ready') {
      if (Date.now() > end) throw new Error(`Cutter not ready (${s})`);
      if (s === 'unloaded' && onWait) onWait('Load the mat');
      await sleep(interval);
      s = await this.status();
    }
    return s;
  }

  /**
   * Feed the mat out from the app instead of pressing unload on the machine.
   * FO0 is the old Silhouette "feed the page out" command; it is not in the Python
   * driver and was unconfirmed on the Cameo 5 when added (10 Nov 2026), so the
   * result is checked: true only once the machine itself reports no mat loaded.
   */
  async unload(timeout = 12000) {
    if ((await this.status()) === 'unloaded') return true;
    await this.send('FO0');
    const end = Date.now() + timeout;
    await sleep(400);
    let s = await this.status();
    while (s !== 'unloaded' && Date.now() < end) { await sleep(250); s = await this.status(); }
    this.log(`After unload command: ${s}`);
    return s === 'unloaded';
  }

  async identify() {
    const fw = await this.version();
    this.firmware = fw;
    const byName = hardwareFromName(fw);
    if (byName) this.hw = byName;
    return fw;
  }

  /** Run a whole job. job: { paths (mm, ordered), settings, offset, endOffset, endPosition } */
  async run(job, { onProgress = () => {}, shouldStop = () => false } = {}) {
    const hw = this.hw || { key: 'cameo5', ...HW.cameo5 };
    const st = await this.status();
    if (st === 'unloaded') throw new Error('No mat loaded. Load the mat, then press Cut again.');
    if (st === 'none') throw new Error('The cutter is not answering');

    // initialize()
    await this.esc(0x04);
    await this.version();
    await this.query('TB71');
    await this.query('FA');

    const tools = await this.toolSetup();
    const th = job.settings.toolholder || 1;
    const current = tools ? tools[th - 1] : null;
    if (job.settings.tool === 'pen' && current != null && current !== 7 && current !== 0) {
      this.log(`Holder ${th} reports tool ${current}, not a pen`);
    }
    const setup = setupCommands(hw, job.settings, current);
    await this.send(setup);

    const matH = job.mediaHeight;
    const s = job.settings;
    const slowTravel = s.travelSpeed && s.travelSpeed < s.speed
      ? { speed: s.travelSpeed, cutSpeed: Math.min(30, Math.max(1, s.speed)), holder: th, minFeedMm: 50 } : null;
    const plot = plotCommands(hw, job.paths, { mediaHeight: matH, offset: job.offset || [0, 0], slowTravel });
    if (plot.slowMoves) this.log(`${plot.slowMoves} long move(s) at slow speed ${s.travelSpeed}`);
    const chunks = safeChunks(encodeCommands(plot.cmds));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    let sent = 0;
    for (const c of chunks) {
      if (shouldStop()) { this.log('Stopped by you'); break; }
      await this.t.write(c);
      sent += c.length;
      onProgress(sent / total);
      await this.waitReady(120000, 50);
    }
    // wait for the last cut to finish, then return the mat (rolls are parked below the cut)
    try { await this.waitReady(120000, 50); } catch {}
    const endPosition = job.endPosition || (s.mat === 'no_mat' ? 'below' : 'start');
    await this.send(endCommands(plot.bbox, job.endOffset || 0, endPosition));
    // wait until the mat is fully back before saying Done: pressing unload while it is
    // still travelling back gets swallowed, and then it needs a second press
    await sleep(300);
    try { await this.waitReady(60000, 100); } catch {}
    return { clipped: plot.clipped, bbox: plot.bbox };
  }
}
