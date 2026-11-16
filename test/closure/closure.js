// Chain closure: a proof that no sequence of chunks the generator can place is a dead end for a fair player.
//
// The question it answers, for one speed: starting from a grounded cube, can a player who only makes FAIR jumps
// survive any sequence of chunks, when the generator picks each next chunk against them? A jump is fair when it
// works across 9 consecutive 1-step launch positions (8 steps = 67 ms, the same window the planner demands).
//
// How: a greatest fixed point. For every chunk D and every successor E, and every grounded "run" of D (a stretch
// of ground with no hazard in it), Ok[D][E][run][i] says the grounded cube i steps into the run is safe, given
// that E comes next and the player sees E (but not the chunk after it). It is true when
//   - idling to the end of the run is safe, and what it reaches at E's entry is safe for EVERY chunk after E; or
//   - some fair window of launches at or after i exists whose every landing is a safe state.
// A landing in E must be safe for every F after E (the generator's choice), a landing in D only for the same E.
// Everything starts true and falsified entries are removed until nothing changes.
//
// What is exact and what is not (also printed by run.js):
//  - Exact at the planner's own resolution: states are grounded cubes on a 1-step grid along each run; a landing
//    between two grid points is rounded UP to the next one (later = harder), so the proof errs toward proving less.
//  - Plays that are still airborne at the end of the next chunk are not available (proves less).
//  - Idle dominance: a grounded cube can always just keep running, so a later position on a run is never easier.
//    That is why only a threshold per run matters, and is why a landing is checked at one grid point.
//  - Cube state carried between chunks is reset to what the run itself produces (coyote full, no buffered press,
//    crumble timers from the run's own idle trajectory). Boost, orbs and movers are NOT covered here (see EXCLUDED).
'use strict';
const L = require('../../src/logic.js');
const { buildWorld } = require('../support.js');

const DT = 1 / 120;
const HOLDS = [1, 4, 8, 12, 16, 20, 24, 32, 44, 57, 80, 114];
// A fair window: the jump works at 9 consecutive steps (8 steps, 67 ms: the planner's MIN_STREAK of 5 samples 2 steps
// apart). Every step in the window must work, not every other one: a real press lands on any frame.
const WINDOW_SAMPLES = 9;
const WINDOW = 9;
const COYOTE_STEPS = Math.round(L.COYOTE / DT) + 1;
// positions are kept at 1/Q of a step, so rounding a landing UP to the next position costs at most 1/Q step
const Q = +process.env.CLOSURE_Q || 4;
const EXTRA = (WINDOW_SAMPLES - 1) * Q;      // launch positions past the chunk end a window starting inside the chunk can reach
const MAX_AIR_STEPS = 500;
// how a landing between two grid positions is rounded: 'up' (later = harder) is the only setting that proves anything;
// 'down' is an optimistic bound for judging how tight a result is
const ROUND = process.env.CLOSURE_ROUND || 'up';

// Nothing is left out of the chunk set any more. What the model does for the pieces that are not plain ground:
//  - steady pieces (orb gaps, float gaps) exist only at their own level speed, so they are in the set only there
//  - cue pieces (tunnels, orb gaps, float gaps): the ONLY play is the cue script (the gems), with every press shifted
//    by the same wobble of -4..4 steps; all nine wobbles must work, and the cube must still be on the ground before
//    the first press even at the earliest wobble
//  - moving platforms: 16 phases, each its own copy of the chunk, and any phase may come after a non-mover (worst case)
//  - boost: a run that touched the pad is a different state from one that jumped over it, so each is its own run
const EXCLUDED = [];
function included() { return true; }
function steadyOk(c, speed) { return c.steadyLevel === null || Math.abs(L.levelSpeed(c.steadyLevel) - speed) < 1e-6; }
function classKey(c) { return c.name.split('@')[0] + ':' + (c.exitH - c.entryH); }
const PHASES = 16;
// press shifts tried for a cue play, in steps. A cue play is fair when some 9 consecutive shifts (67 ms) all work, the
// same bar as the existing orb-window test; the player is then free to aim at the middle of that window.
const CUE_DELTAS = [];
for (let d = -20; d <= 20; d++) CUE_DELTAS.push(d);

// copies of a moving-platform chunk, one per phase of the platform at the chunk's start
function withPhases(list) {
  const out = [];
  for (const c of list) {
    if (!c.moving.length) { out.push(c); continue; }
    for (let ph = 0; ph < PHASES; ph++) {
      const [base, h] = c.name.split('@');
      out.push(Object.assign({}, c, { name: `${base}#${ph}@${h}`, phase: ph }));
    }
  }
  return out;
}
function phaseClock(c) { return c.phase === undefined ? 0 : (c.phase * c.period) / PHASES; }
// how long the cube takes to get from x to x (it only depends on position: slow fields scale it)
function elapsedAcross(world, speed, xa, xb) {
  const c = { x: xa };
  let t = 0;
  while (c.x < xb) { const dt = DT * L.timeScale(world, c); c.x += speed * dt; t += dt; }
  return t;
}

// the cube a fraction f of the way from snapshot a to snapshot b (position, height, clock; the rest as in a)
function lerpCube(a, b, f) {
  if (f === 0 || !b) return L.cloneCube(a);
  const c = L.cloneCube(a);
  for (const k of ['x', 'y', 'vy', 't', 'coyote', 'buffer']) c[k] = a[k] + (b[k] - a[k]) * f;
  return c;
}
function stepIdle(cube, world, speed) { return L.stepCube(cube, world, { pressed: false, held: false }, DT, speed * L.boostMul(cube)); }

// The grounded runs of a chunk, from its geometry: where a cube can be standing and keep running until something
// ahead stops it. Each run gets its canonical idle trajectory (one snapshot per step).
function runStarts(c) {
  const T = L.TILE;
  const out = [];
  const topOf = h => L.FLOOR_Y - h * T;
  c.ground.forEach((g, k) => {
    // after a drop the cube cannot overhang the higher ground it just left; after a gap or a rise it can
    const prev = c.ground[k - 1];
    const drop = prev && prev.x1 === g.x0 && prev.h > g.h;
    out.push({ x: k === 0 ? 0 : drop ? g.x0 * T - L.CUBE_INSET + 0.5 : g.x0 * T - L.CUBE + L.CUBE_INSET + 0.5, top: topOf(g.h) });
  });
  const hw = (T * L.SPIKE_HIT_W) / 2;
  for (const s of c.spikes) {
    const seg = c.ground.find(g => s.x >= g.x0 && s.x < g.x1 && g.h === s.h);
    if (!seg) continue;
    const x = s.x * T + T / 2 + hw - L.CUBE_INSET + 0.5;
    if (x < seg.x1 * T) out.push({ x, top: topOf(s.h) });
  }
  for (const p of c.platforms.concat(c.crumble)) out.push({ x: p.x * T - L.CUBE + L.CUBE_INSET + 0.5, top: topOf(p.h) });
  // a floating block is stood on like a platform
  for (const b of c.boxes) out.push({ x: b.x * T - L.CUBE + L.CUBE_INSET + 0.5, top: topOf(b.top) });
  // standing past a boost pad without having touched it is a different state from having run over it
  for (const p of c.pads) out.push({ x: (p.x + p.w) * T - L.CUBE_INSET + 0.5, top: topOf(p.h), noBoost: true });
  // having taken a shield pickup is a different state from not having: stand just past the pickup holding it
  const groundTopAt = tx => { const g = c.ground.find(q => tx >= q.x0 && tx < q.x1); return topOf(g ? g.h : c.entryH); };
  for (const q of c.pickups) {
    const x = q.x * T + T / 2 + L.PICKUP_R_TILES * T;
    out.push({ x, top: groundTopAt(x / T), shield: true });
  }
  // and the ground after a gate is its own run: the beam is behind the cube there
  for (const q of c.gates) {
    const x = (q.x + q.w) * T - L.CUBE_INSET + 0.5;
    out.push({ x, top: groundTopAt(x / T) });
  }
  // riding a moving platform: the cube sits on it wherever it is at that moment
  for (const m of c.moving) out.push({ x: m.x * T - L.CUBE + L.CUBE_INSET + 0.5, top: topOf(m.h), mover: m });
  out.sort((a, b) => a.x - b.x || b.top - a.top);
  return out;
}

function trajectory(world, x0abs, start, speed, stopAbs, extra, t0) {
  const cube = L.newCube(0, 0);
  cube.x = x0abs + start.x;
  cube.y = start.top - L.CUBE;
  cube.t = (t0 || 0) + (start.x > 0 ? elapsedAcross(world, speed, x0abs, cube.x) : 0);
  if (start.shield) cube.shield = true;
  // pickups behind the cube are taken and gates behind it are gone, whatever the start
  for (const q of world.pickups) if (q.x < cube.x) cube.picked[q.id] = true;
  for (const q of world.gates) if (q.x1 <= cube.x) cube.broken[q.id] = true;
  // a drop block the cube is past the trigger of has long since landed
  for (const q of world.gates) if (q.kind === 'drop' && cube.x + L.CUBE / 2 >= q.trigger) cube.dropAt[q.id] = cube.t - 10;
  if (start.mover) {
    const m = world.movers.find(q => Math.abs(q.x0 - (x0abs + start.mover.x * L.TILE)) < 1);
    if (!m) return null;
    cube.y = L.moverTop(m, cube.t) - L.CUBE;
    cube.stand = m.id;
  }
  const snaps = [];
  let airborneFor = 0;
  let reached = -1;
  for (let i = 0; i < 4000; i++) {
    if (i === 0) {
      // the start must really be standing on something
      const probe = L.cloneCube(cube);
      const pe = stepIdle(probe, world, speed);
      if (pe.dead || !probe.onGround || Math.abs(probe.y - cube.y) > (start.mover ? 3 : 1.5)) return null;
    }
    snaps.push(L.cloneCube(cube));
    if (reached < 0 && cube.x >= stopAbs) reached = i;
    if (reached >= 0 && i >= reached + extra) break;
    const ev = stepIdle(cube, world, speed);
    if (ev.dead) break;
    if (cube.onGround) airborneFor = 0;
    else if (++airborneFor > COYOTE_STEPS) break;
  }
  // grounded snapshots only count as states; the coyote tail is launch-only
  return { snaps, reached };
}

// A chunk's own runs (positions relative to its start): for each, xs[j] and the number of grounded states n.
const runCache = new Map();
function runsOf(c, speed) {
  const key = c.name + '@' + speed;
  if (runCache.has(key)) return runCache.get(key);
  const world = buildWorld([c], 8, 16);
  const x0 = 8 * L.TILE, x1 = x0 + c.w * L.TILE;
  const runs = [];
  for (const st of runStarts(c)) {
    const tr = trajectory(world, x0, st, speed, x1, 0, phaseClock(c));
    if (!tr) continue;
    const xs = [], ys = [], bs = [];
    let g = 0;
    while (g < tr.snaps.length && tr.snaps[g].onGround && tr.snaps[g].x < x1) g++;
    for (let i = 0; i < g; i++) {
      const s = tr.snaps[i], nx = i + 1 < g ? tr.snaps[i + 1] : null;
      for (let q = 0; q < (nx ? Q : 1); q++) {
        xs.push(s.x - x0 + (nx ? ((nx.x - s.x) * q) / Q : 0));
        ys.push(nx ? s.y + ((nx.y - s.y) * q) / Q : s.y);
        bs.push(flagsOf(s));
      }
    }
    if (!xs.length) continue;
    // the same run can be found twice (a spike start inside an already-listed run is fine; duplicates are dropped)
    if (runs.some(r => Math.abs(r.xs[0] - xs[0]) < 0.6 && Math.abs(r.ys[0] - ys[0]) < 0.6 && r.bs[0] === bs[0])) continue;
    runs.push({ xs, ys, bs, moving: !!st.mover, n: xs.length, reachesEnd: tr.reached >= 0 && tr.snaps[tr.reached] && tr.snaps[tr.reached].onGround });
  }
  runCache.set(key, runs);
  return runs;
}

// where a landing at relative x, height y falls in the runs of a chunk: [run, index] rounded up, or null
function locate(runs, relx, y, boosted) {
  let best = null;
  for (let r = 0; r < runs.length; r++) {
    const R = runs[r];
    if (!R.moving && Math.abs(R.ys[0] - y) > 1.5) continue;
    if (relx < R.xs[0] - 0.01 || relx > R.xs[R.n - 1] + 0.01) continue;
    let lo = 0, hi = R.n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (R.xs[mid] >= relx - 0.01) hi = mid; else lo = mid + 1; }
    if (ROUND === 'down' && lo > 0 && R.xs[lo] > relx + 0.01) lo--;
    else if (ROUND === 'nearest' && lo > 0 && R.xs[lo] - relx > relx - R.xs[lo - 1]) lo--;
    if (R.moving && Math.abs(R.ys[lo] - y) > 3.5) continue;
    if (R.bs[lo] !== boosted) continue;
    if (!best || R.xs[lo] - relx < best.gap) best = { r, j: lo, gap: R.xs[lo] - relx };
  }
  return best;
}

const KIND_BAD = 0, KIND_OWN = 1, KIND_NEXT = 2, KIND_THIRD = 3;
const CODE_FAR = -1;   // still in the air past the end of the next chunk: decided later, once the chunk after it is known
function pack(kind, r, j) { return kind === KIND_BAD ? 0 : (kind | (r << 2) | (j << 6)); }

function pairClock(D, E, world, speed, x0D, x0E) {
  if (D.phase !== undefined) return phaseClock(D);
  if (E.phase !== undefined) {
    const per = E.period;
    const v = phaseClock(E) - elapsedAcross(world, speed, x0D, x0E);
    return ((v % per) + per) % per;
  }
  return 0;
}

// The one play of a cue chunk: press where the gems say (the same schedule the cue-following bots use), every press
// shifted by `delta` steps. Returns the packed landing after the last press, 0 if it dies, or `beyond` past the limit.
function runCue(world, cube0, D, speed, delta, x0D, classify, limit, beyond) {
  const T = L.TILE;
  // rings need no press: they throw the cube by themselves
  const cues = D.cue.filter(q => q.kind !== 'orb').map(q => (q.kind === 'jump' ? { x: x0D + q.at * T, centre: true, hold: q.hold }
    : { x: x0D + L.cueStartTile(q, speed) * T, centre: false, hold: q.hold }));
  cues.forEach(q => { q.fired = -1; });
  const c = L.cloneCube(cube0);
  for (let i = 0; i < MAX_AIR_STEPS; i++) {
    let pressed = false, held = false;
    for (const q of cues) {
      const at = (q.centre ? c.x + L.CUBE / 2 : c.x) - delta * speed * DT;
      if (q.fired < 0 && at >= q.x) { q.fired = i; pressed = true; }
      if (q.fired >= 0 && i >= q.fired && i < q.fired + q.hold) held = true;
    }
    const ev = L.stepCube(c, world, { pressed, held }, DT, speed * L.boostMul(c));
    if (ev.dead) return 0;
    if (c.x >= limit) return beyond;
    if (ev.landed && cues.every(q => q.fired >= 0)) return classify(c);
  }
  return 0;
}
// what makes two cubes on the same ground different states: running boosted, and holding a shield
const flagsOf = c => ((c.boostX0 !== null && c.boostX0 !== undefined) ? 1 : 0) | (c.shield ? 2 : 0);

// Launch outcomes of one (D, E) pair: for each run of D, each hold, each launch position.
function pairOutcomes(D, E, speed) {
  const world = buildWorld([D, E], 8, 16);
  const x0D = 8 * L.TILE, x1D = x0D + D.w * L.TILE;
  const x0E = x1D, x1E = x0E + E.w * L.TILE;
  const runsD = runsOf(D, speed), runsE = runsOf(E, speed);
  const t0 = pairClock(D, E, world, speed, x0D, x0E);
  const result = [];
  result.t0 = t0;
  for (const st of runStarts(D)) {
    const tr = trajectory(world, x0D, st, speed, x1D, (WINDOW_SAMPLES - 1) + 2, t0);
    if (!tr) continue;
    // match to the same run as runsOf produced
    const first = tr.snaps[0];
    const r = runsD.findIndex(R => Math.abs(R.xs[0] - (first.x - x0D)) < 0.6 && Math.abs(R.ys[0] - first.y) < (R.moving ? 3 : 0.6) && R.bs[0] === flagsOf(first));
    if (r < 0 || result[r]) continue;
    const R = runsD[r];
    const sub = [];
    for (let i = 0; i < tr.snaps.length; i++) {
      const nx = i + 1 < tr.snaps.length ? tr.snaps[i + 1] : null;
      for (let q = 0; q < (nx ? Q : 1); q++) sub.push(lerpCube(tr.snaps[i], nx, q / Q));
    }
    const total = sub.length;
    const classify = c => {
      if (c.x < x1D) {
        const loc = locate(runsD, c.x - x0D, c.y, flagsOf(c));
        return loc ? pack(KIND_OWN, loc.r, loc.j) : 0;
      }
      const loc = locate(runsE, c.x - x0E, c.y, flagsOf(c));
      return loc ? pack(KIND_NEXT, loc.r, loc.j) : 0;
    };
    const codes = new Int32Array(HOLDS.length * total);
    // the entry run of a cue chunk has one play, the cue; its other runs and every other chunk use free launches
    const isCueRun = D.cue.length > 0 && r === 0;
    if (!isCueRun) {
      for (let hi = 0; hi < HOLDS.length; hi++) {
        const hold = HOLDS[hi];
        for (let i = 0; i < total; i++) {
          const c = L.cloneCube(sub[i]);
          let code = 0, jumped = false;
          for (let k = 0; k < MAX_AIR_STEPS; k++) {
            const ev = L.stepCube(c, world, { pressed: k === 0, held: k < hold }, DT, speed * L.boostMul(c));
            if (ev.dead) break;
            if (ev.jumped) jumped = true;
            if (c.x >= x1E) { code = CODE_FAR; break; }
            if (jumped && ev.landed) { code = classify(c); break; }
          }
          codes[hi * total + i] = code;
        }
      }
    }
    // where idling to the end of the run leads: the first grounded state at or past the end of D
    let end = null;
    if (tr.reached >= 0 && tr.snaps[tr.reached].onGround && Math.abs(tr.snaps[tr.reached].y - first.y) < 1e-6 && !isCueRun) {
      const s = tr.snaps[tr.reached];
      const loc = locate(runsE, s.x - x0E, s.y, flagsOf(s));
      if (loc) end = { r: loc.r, j: loc.j };
    }
    // a run that ends at a ledge: idling carries the cube off it, and it lands without a jump
    let idleCode = 0;
    if (!end && !isCueRun) {
      const c = L.cloneCube(tr.snaps[tr.snaps.length - 1]);
      for (let k = 0; k < MAX_AIR_STEPS; k++) {
        const ev = stepIdle(c, world, speed);
        if (ev.dead || c.x >= x1E) break;
        if (ev.landed) { idleCode = classify(c); break; }
      }
    }
    // the cue play, for each shift: the latest start from which that shift has not pressed yet
    let cue = null;
    if (isCueRun) {
      const q0 = D.cue[0];
      const fx = q0.kind === 'jump' ? x0D + q0.at * L.TILE : x0D + L.cueStartTile(q0, speed) * L.TILE;
      const centre = q0.kind === 'jump';
      const p0s = new Int32Array(CUE_DELTAS.length).fill(-1);
      const cc = new Int32Array(CUE_DELTAS.length);
      const starts = [];
      CUE_DELTAS.forEach((d, k) => {
        let p0 = -1;
        for (let i = 0; i < total; i++) {
          const pos = centre ? sub[i].x + L.CUBE / 2 : sub[i].x;
          if (pos < fx + d * speed * DT - 1e-6 && sub[i].onGround) p0 = i; else if (pos >= fx + d * speed * DT) break;
        }
        p0s[k] = p0;
        starts[k] = p0 >= 0 ? sub[p0] : null;
        if (p0 >= 0) cc[k] = runCue(world, sub[p0], D, speed, d, x0D, classify, x1E, CODE_FAR);
      });
      cue = { p0s, codes: cc, starts };
    }
    // the launches that fly past the next chunk need the one after it; keep their cubes for that
    const far = new Map();
    for (let hi = 0; hi < HOLDS.length; hi++) for (let i = 0; i < total; i++) if (codes[hi * total + i] === CODE_FAR && !far.has(i)) far.set(i, sub[i]);
    result[r] = { n: R.n, total, codes, end, idleCode, far, cue };
  }
  return result;
}

// Launches that fly over the whole next chunk (E) and land in the one after it (G): decided per (D, E, G).
const tripleCache = new Map();
function farOutcomes(D, E, G, speed, pairOut) {
  const key = classKey(D) + '|' + classKey(E) + '|' + classKey(G);
  if (tripleCache.has(key)) return tripleCache.get(key);
  const world = buildWorld([D, E, G], 8, 16);
  const x0D = 8 * L.TILE, x1D = x0D + D.w * L.TILE, x1E = x1D + E.w * L.TILE, x1G = x1E + G.w * L.TILE;
  const runsG = runsOf(G, speed);
  // if only G moves, its phase is fixed by where the clock stands when the cube reaches it
  let shift = 0;
  if (D.phase === undefined && E.phase === undefined && G.phase !== undefined) {
    const per = G.period;
    const desired = (((phaseClock(G) - elapsedAcross(world, speed, x0D, x1E)) % per) + per) % per;
    shift = desired - (pairOut.t0 || 0);
  }
  const shifted = cube => { const c = L.cloneCube(cube); c.t += shift; return c; };
  const classifyG = c => {
    const loc = c.x >= x1E ? locate(runsG, c.x - x1E, c.y, flagsOf(c)) : null;
    return loc ? pack(KIND_THIRD, loc.r, loc.j) : 0;
  };
  const res = pairOut.map(O => {
    if (!O) return null;
    const out = { codes: null, cue: null };
    if (O.far.size) {
      out.codes = new Int32Array(O.codes.length);
      for (let hi = 0; hi < HOLDS.length; hi++) {
        for (const [i, cube] of O.far) {
          if (O.codes[hi * O.total + i] !== CODE_FAR) continue;
          const c = shifted(cube);
          let code = 0, jumped = false;
          for (let k = 0; k < MAX_AIR_STEPS; k++) {
            const ev = L.stepCube(c, world, { pressed: k === 0, held: k < HOLDS[hi] }, DT, speed * L.boostMul(c));
            if (ev.dead) break;
            if (ev.jumped) jumped = true;
            if (c.x >= x1G) break;
            if (jumped && ev.landed) { code = classifyG(c); break; }
          }
          out.codes[hi * O.total + i] = code;
        }
      }
    }
    if (O.cue && O.cue.codes.some(c => c === CODE_FAR)) {
      out.cue = new Int32Array(CUE_DELTAS.length);
      CUE_DELTAS.forEach((d, k) => { if (O.cue.codes[k] === CODE_FAR) out.cue[k] = runCue(world, shifted(O.cue.starts[k]), D, speed, d, x0D, classifyG, x1G, 0); });
    }
    return out;
  });
  tripleCache.set(key, res);
  return res;
}

// ---- the fixed point -----------------------------------------------------------------------------
//
// Same semantics as the planner, for every sequence at once: the player knows the whole chunk sequence ahead (the
// generator does not look at the player, so the sequence is fixed in advance) and every jump must be fair.
//
// Backward from the end of a sequence. For a chunk E followed by F, a "theta vector" has one number per run of E:
// theta[r] = how many grounded positions along run r (counted from its start) are safe, for a given suffix after E.
// Safe positions always form a prefix (a grounded cube can keep running, so a later position is never easier), so one
// number per run says everything. Theta(E, F, thetaF) is computed from the launch outcomes of the pair (E, F): a
// position is safe when idling is safe, or some fair window of launches from it or later has every landing safe;
// a landing in E needs E's own later positions safe, a landing in F needs F's theta. The set V(E) of theta vectors
// over ALL suffixes is the least fixed point of
//     V(E) = { Theta(E, F, thetaF) : F after E, thetaF in V(F) }  (plus a base case: followed by flat ground).
// Only the worst vectors are kept (a vector below another is a harder suffix). The fresh start is safe for every
// sequence if every vector of the first chunk has its starting position inside the safe prefix.
//
// The planner proves one sequence at a time; this proves all of them. It does NOT model a player who can only see
// one or two chunks ahead (that is stricter; see the report).

function closure(speed, opts) {
  const o = opts || {};
  const chunks = withPhases((o.list || L.CHUNKS).filter(c => steadyOk(c, speed))).filter(o.filter || (() => true));
  const N = chunks.length;
  const idx = new Map(chunks.map((c, i) => [c.name, i]));
  const byEntry = new Map();
  chunks.forEach((c, i) => { if (!byEntry.has(c.entryH)) byEntry.set(c.entryH, []); byEntry.get(c.entryH).push(i); });
  // after a moving platform the next moving platform's phase is fixed by the clock (to the nearest of 16 phases);
  // after anything else any phase can come (worst case)
  const nextPhase = D => {
    const per = D.period;
    const v = (phaseClock(D) + (D.w * L.TILE) / speed) % per;
    return Math.round(v / (per / PHASES)) % PHASES;
  };
  const succ = o.succ ? (i => o.succ(chunks[i].name).map(n => idx.get(n)).filter(x => x !== undefined))
    : (i => (byEntry.get(chunks[i].exitH) || []).filter(j => chunks[i].phase === undefined || chunks[j].phase === undefined || chunks[j].phase === nextPhase(chunks[i])));
  const preds = chunks.map(() => []);
  for (let e = 0; e < N; e++) for (const f of succ(e)) preds[f].push(e);

  const t0 = Date.now();
  const outCache = new Map();
  function outcomes(E, F) {
    const key = classKey(E) + '|' + classKey(F);
    if (!outCache.has(key)) outCache.set(key, pairOutcomes(E, F, speed));
    return outCache.get(key);
  }
  const runsOfChunk = chunks.map(c => runsOf(c, speed));
  const orderCache = new Map();
  function orderOf(E) {
    const key = classKey(E);
    if (!orderCache.has(key)) {
      const runs = runsOf(E, speed);
      const list = [];
      runs.forEach((R, r) => { for (let i = 0; i < R.n; i++) list.push([r, i, R.xs[i]]); });
      list.sort((a, b) => b[2] - a[2] || b[0] - a[0] || b[1] - a[1]);
      orderCache.set(key, list);
    }
    return orderCache.get(key);
  }

  function theta(e, f, recF) {
    const E = chunks[e], F = chunks[f];
    const out = outcomes(E, F);
    const thetaF = recF.th;
    const g = recF.from.f;
    const thetaG = recF.from.rec ? recF.from.rec.th : full(g);
    let far = null;     // decided lazily: only chains with a launch that clears all of F need the chunk after it
    const getFar = () => (far || (far = farOutcomes(E, F, chunks[g], speed, out)));
    const farCode = (r, hi, i) => { const f2 = getFar()[r]; return f2 && f2.codes ? f2.codes[hi * out[r].total + i] : 0; };
    const farCue = (r, d) => { const f2 = getFar()[r]; return f2 && f2.cue ? f2.cue[d] : 0; };
    const runs = runsOfChunk[e];
    const okE = runs.map(R => new Uint8Array(R.n));
    const anyW = runs.map(() => false);
    const idleMemo = runs.map(() => -1);
    const goodRaw = code => {
      if (code === 0) return false;
      const kind = code & 3, rr = (code >> 2) & 15, j = code >> 6;
      return kind === KIND_OWN ? okE[rr][j] === 1 : kind === KIND_NEXT ? j < thetaF[rr] : j < thetaG[rr];
    };
    const goodCode = (code, r, hi, i) => goodRaw(code === CODE_FAR ? farCode(r, hi, i) : code);
    // the last position of the cue run that is still safe: the latest start of any fair window of shifts
    const cueLive = runIdx => {
      const O = out[runIdx];
      if (memoCue[runIdx] !== undefined) return memoCue[runIdx];
      const good = CUE_DELTAS.map((d, k) => O.cue.p0s[k] >= 0 && goodRaw(O.cue.codes[k] === CODE_FAR ? farCue(runIdx, k) : O.cue.codes[k]));
      let live = -1, streak = 0;
      for (let k = 0; k < good.length; k++) {
        streak = good[k] ? streak + 1 : 0;
        // the window ends at k; its earliest press is shift k-8, which sets how late the cube may still be standing
        if (streak >= 9) live = Math.max(live, O.cue.p0s[k - 8]);
      }
      return (memoCue[runIdx] = live);
    };
    const memoCue = {};
    for (const [r, i] of orderOf(E)) {
      const O = out[r];
      if (!O) continue;
      const { total, codes } = O;
      if (O.cue) continue;   // a cue run is filled in below, once every landing it can lead to has been decided
      if (!anyW[r] && i + EXTRA < total) {
        for (let hi = 0; hi < HOLDS.length; hi++) {
          let all = true;
          for (let k = 0; k < WINDOW_SAMPLES; k++) if (!goodCode(codes[hi * total + i + Q * k], r, hi, i + Q * k)) { all = false; break; }
          if (all) { anyW[r] = true; break; }
        }
      }
      let v = anyW[r];
      if (!v) {
        if (idleMemo[r] < 0) idleMemo[r] = (O.end ? O.end.j < thetaF[O.end.r] : (O.idleCode ? goodCode(O.idleCode, r, 0, 0) : false)) ? 1 : 0;
        v = idleMemo[r] === 1;
      }
      okE[r][i] = v ? 1 : 0;
    }
    // the cue run: safe up to the latest start of a fair window of shifts (its landings are all decided by now)
    for (let r = 0; r < out.length; r++) {
      if (!out[r] || !out[r].cue) continue;
      const live = cueLive(r);
      for (let i = 0; i < okE[r].length; i++) okE[r][i] = i <= live ? 1 : 0;
    }
    return okE.map(a => { let c = 0; for (const v of a) c += v; return c; });
  }

  // V[e]: list of { th, from } (from = [f, index into V[f]] for the witness)
  const V = chunks.map(() => []);
  const keyOf = th => th.join(',');
  const queue = [];
  function add(e, th, from) {
    const list = V[e];
    // a vector is dominated by one that is at least as hard on every run, with the same chunk after it and a next-next
    // vector that is at least as hard (the chunk after the next only matters for launches that clear the next one)
    const gth = r => (r.from && r.from.rec && r.from.rec.from ? (r.from.rec.th) : null);
    const harder = (a, b) => a.from.f === b.from.f && a.th.every((x, k) => x <= b.th[k]) &&
      ((x, y) => (x === null ? true : y === null ? false : x.every((v, k) => v <= y[k])))(gth(a), gth(b));
    for (const q of list) if (harder(q, { th, from })) return false;
    for (let k = list.length - 1; k >= 0; k--) if (harder({ th, from }, list[k])) list.splice(k, 1);
    const rec = { th, from, id: ++add.n };
    list.push(rec);
    queue.push([e, rec]);
    return true;
  }
  add.n = 0;
  const full = e => runsOfChunk[e].map(R => R.n);
  // base: the word ends, flat ground follows (any flat chunk at the exit height)
  for (let e = 0; e < N; e++) {
    const flat = succ(e).find(f => chunks[f].name.startsWith('flat@'));
    if (flat === undefined) continue;
    const baseRec = { th: full(flat), from: { f: flat, rec: null } };
    add(e, theta(e, flat, baseRec), { f: flat, rec: baseRec });
  }
  let steps = 0;
  while (queue.length) {
    const [f, rec] = queue.shift();
    for (const e of preds[f]) {
      steps++;
      add(e, theta(e, f, rec), { f, rec });
    }
  }

  // fresh start: the first flat chunk, standing 6 tiles before the first chunk (the planner tests' start)
  const startIdx = chunks.findIndex(c => c.name === 'flat@0');
  let startOk = null, witness = null;
  const witnesses = [];
  if (startIdx >= 0) {
    const R = runsOfChunk[startIdx][0];
    let i0 = 0;
    while (i0 < R.n - 1 && R.xs[i0] < 2 * L.TILE) i0++;
    startOk = true;
    for (const rec of V[startIdx]) if (!(i0 < rec.th[0])) {
      startOk = false;
      const word = [chunks[startIdx].name];
      for (let cur = rec; cur && cur.from && cur.from.rec; cur = cur.from.rec) word.push(chunks[cur.from.f].name);
      witnesses.push(word);
      if (!witness || word.length < witness.length) witness = word;
    }
  }
  // entry margin per chunk: the fewest safe positions on its first run over all suffixes
  const margin = chunks.map((c, e) => ({ name: c.name, steps: V[e].length ? Math.min(...V[e].map(r => r.th[0])) : null, of: runsOfChunk[e][0] ? runsOfChunk[e][0].n : 0 }));
  const vectors = V.reduce((a, l) => a + l.length, 0);
  return { theta, full, idx, runsOfChunk, speed, chunks: N, pairs: [...outCache.keys()].length, steps, vectors, startOk, witness, witnesses, margin, V, chunkList: chunks, simMs: 0, totalMs: Date.now() - t0 };
}

module.exports = { closure, classKey, included, steadyOk, withPhases, EXCLUDED, HOLDS, WINDOW, runsOf };
