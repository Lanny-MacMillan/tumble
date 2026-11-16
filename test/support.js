// Shared helpers for the node tests: a world builder and a jump-search bot.
const L = require('../src/logic.js');

const DT = 1 / 120;
const WAIT_STEP = 2;
const WAIT_SPAN = 100;
const HOLDS = [1, 4, 8, 12, 16, 20, 24, 32, 44, 57, 80, 114];
// a jump has to work across at least this many consecutive start times
const MIN_STREAK = 5;
const MAX_TRIAL_STEPS = 1500;

function buildWorld(chunks, leadTiles = 8, tailTiles = 16) {
  const world = L.createEmptyWorld();
  const entryH = chunks[0].entryH;
  L.addGround(world, -400, leadTiles, entryH);
  world.endX = leadTiles * L.TILE;
  for (const c of chunks) L.placeChunk(world, c);
  L.addGround(world, world.endX / L.TILE, world.endX / L.TILE + tailTiles, world.exitH);
  world.endX += tailTiles * L.TILE;
  return world;
}

function clone(c) { return L.cloneCube(c); }

// speed may be a number, or a function of the cube's x so a run can speed up part-way through a chunk
function spd(speed, c) { return (typeof speed === 'function' ? speed(c.x) : speed) * L.boostMul(c); }

function idle(cube0, world, speed, targetX) {
  const c = clone(cube0);
  for (let i = 0; i < MAX_TRIAL_STEPS; i++) {
    const ev = L.stepCube(c, world, { pressed: false, held: false }, DT, spd(speed, c));
    if (ev.dead) return { steps: i, dead: true, reason: ev.dead };
    if (c.x >= targetX) return { steps: i, dead: false };
  }
  return { steps: MAX_TRIAL_STEPS, dead: false };
}

function trial(cube0, world, speed, wait, hold, targetX) {
  const c = clone(cube0);
  let jumped = false;
  for (let i = 0; i < MAX_TRIAL_STEPS; i++) {
    const input = { pressed: i === wait, held: i >= wait && i < wait + hold };
    const ev = L.stepCube(c, world, input, DT, spd(speed, c));
    if (ev.dead) return { r: 'dead' };
    // a jump still in the air at the target is not yet safe: it has to land before it counts
    if (c.x >= targetX && c.onGround) return { r: 'reach', cube: c };
    if (ev.jumped) jumped = true;
    if (jumped && ev.landed) return { r: 'land', cube: c };
  }
  return { r: 'dead' };
}

// the saved state of a spot: where the cube is, which crumble pieces it has touched, and the clock
function key(c) {
  return `${Math.round(c.x)}:${Math.round(c.y)}:${Math.round(c.t * 10)}:${JSON.stringify(c.cr)}:${c.stand || ''}:${c.boostX0 === null ? '' : Math.round(c.boostX0)}:${Object.keys(c.orbs).join(',')}:${Object.keys(c.warps).join(',')}:${c.bouncing ? 1 : 0}:${c.shield ? 1 : 0}:${Math.round(c.inv * 120)}:${Object.keys(c.picked).join(',')}:${Object.keys(c.broken).join(',')}:${Object.keys(c.dropAt).join(',')}`;
}

// Looks for a jump plan that clears everything up to targetX. A plan only
// counts when the first jump works across a window of start times, and so
// does every follow-up jump after it. Returns the chosen first action or null.
function plan(cube, world, speed, targetX, memo) {
  const k = key(cube);
  if (memo.has(k)) return memo.get(k);
  memo.set(k, null);

  const quiet = idle(cube, world, speed, targetX);
  if (!quiet.dead) {
    const res = { wait: 0, hold: 0, free: true };
    memo.set(k, res);
    return res;
  }
  const last = quiet.steps - 1;
  // a pickup still ahead may have to be taken well before the first hazard, so look further back for the jump
  const pickupAhead = world.pickups.some(q => !cube.picked[q.id] && q.x > cube.x && q.x < targetX);
  const first = Math.max(0, last - (pickupAhead ? 3 * WAIT_SPAN : WAIT_SPAN));

  for (const hold of HOLDS) {
    let streak = [];
    for (let w = last; w >= first; w -= WAIT_STEP) {
      const t = trial(cube, world, speed, w, hold, targetX);
      let ok = false;
      if (t.r === 'reach') ok = true;
      else if (t.r === 'land') ok = plan(t.cube, world, speed, targetX, memo) !== null;
      if (ok) {
        streak.push(w);
        if (streak.length >= MIN_STREAK) {
          const res = { wait: streak[Math.floor(streak.length / 2)], hold, streak: streak.slice() };
          memo.set(k, res);
          return res;
        }
      } else {
        streak = [];
      }
    }
  }
  return null;
}

// clock offsets that cover one full cycle of a chunk's moving platforms
function phaseTimes(chunks, count) {
  const mover = chunks.find(c => c.moving.length);
  if (!mover) return [0];
  const out = [];
  for (let i = 0; i < count; i++) out.push((i / count) * mover.period);
  return out;
}

// TEST_SLICE=2/4 keeps every fourth case of the long checks, starting with the second, so CI can split them over
// parallel jobs. Unset, every case runs.
const SLICE = (() => {
  const m = /^(\d+)\/(\d+)$/.exec(process.env.TEST_SLICE || '');
  return m ? { k: +m[1] - 1, n: +m[2] } : { k: 0, n: 1 };
})();
function slicer() { let i = 0; return () => i++ % SLICE.n === SLICE.k; }

const FULL_PHASES = process.env.TUMBLE_PHASES ? +process.env.TUMBLE_PHASES : 4;

function chunkClearable(chunk, speed, phases) {
  const world = buildWorld([chunk]);
  const target = world.endX - 8 * L.TILE;
  for (const t0 of phaseTimes([chunk], phases || L.MOVER_PHASES)) {
    const cube = L.newCube(2 * L.TILE, chunk.entryH);
    cube.t = t0;
    if (plan(cube, world, speed, target, new Map()) === null) return false;
  }
  return true;
}

function pairClearable(a, b, speed, phases) {
  const world = buildWorld([a, b]);
  const target = world.endX - 8 * L.TILE;
  for (const t0 of phaseTimes([a, b], phases || FULL_PHASES)) {
    const cube = L.newCube(2 * L.TILE, a.entryH);
    cube.t = t0;
    if (plan(cube, world, speed, target, new Map()) === null) return false;
  }
  return true;
}

// A player who follows the tunnel's guide markers: hops where the cue says, holding as long as it says,
// with a bit of timing wobble. Returns true if they get through the whole chunk alive.
function cueBotClears(chunk, speed, wobbleSteps, opts) {
  const o = opts || {};
  const world = o.world || buildWorld([chunk]);
  const cube = o.cube || L.newCube(2 * L.TILE, chunk.entryH);
  if (o.boostAtStart) cube.boostX0 = o.boostAtStart;
  const startX = o.startX !== undefined ? o.startX : 8 * L.TILE; // buildWorld puts 8 lead tiles before the chunk
  const v0 = typeof speed === 'function' ? speed(startX) : speed;
  // Each cue is a press: where the cube reaches (its left edge for a tunnel stud, its centre for a take-off)
  // and how long to hold. Rings need no press: they throw the cube by themselves. An explicit .x is used when sweeping.
  const cues = chunk.cue.filter(c => c.kind !== 'orb').map(c => {
    let x;
    let centre = false;
    if (c.kind === 'jump') { x = startX + c.at * L.TILE; centre = true; }
    else x = startX + (c.x !== undefined ? c.x : L.cueStartTile(c, v0)) * L.TILE;
    return { x, hold: c.hold, centre, fired: -1 };
  });
  const target = o.target !== undefined ? o.target : world.endX - 8 * L.TILE;
  for (let i = 0; i < MAX_TRIAL_STEPS * 3; i++) {
    let pressed = false;
    let held = false;
    for (const c of cues) {
      const at = (c.centre ? cube.x + L.CUBE / 2 : cube.x) - (wobbleSteps * spd(speed, cube) * DT);
      if (c.fired < 0 && at >= c.x) { c.fired = i; pressed = true; }
      if (c.fired >= 0 && i >= c.fired && i < c.fired + c.hold) held = true;
    }
    const ev = L.stepCube(cube, world, { pressed, held }, DT, spd(speed, cube));
    if (ev.dead) return false;
    if (cube.x >= target) return true;
  }
  return false;
}

// Plays through a world with the planner, jumping at a slightly off-centre
// time inside the safe window to mimic a human.
function botRun(world, speed, jitterSteps, rng) {
  const cube = L.newCube(2 * L.TILE, 0);
  const finish = world.endX - 30 * L.TILE;
  let guard = 0;
  while (cube.x < finish && guard++ < 4000) {
    const lookahead = Math.min(finish, cube.x + 56 * L.TILE);
    const p = plan(cube, world, speed, lookahead, new Map());
    if (!p) return { ok: false, x: cube.x, why: 'no plan' };
    if (p.free) {
      // a free run is only trusted for 6 tiles, so a hazard just past the old view is planned for with room to jump
      const until = Math.min(lookahead, cube.x + 6 * L.TILE);
      for (let i = 0; i < MAX_TRIAL_STEPS && cube.x < until; i++) {
        const ev = L.stepCube(cube, world, { pressed: false, held: false }, DT, spd(speed, cube));
        if (ev.dead) return { ok: false, x: cube.x, why: 'free path died' };
      }
      continue;
    }
    let wait = p.wait;
    if (p.streak && p.streak.length > 2) {
      const jitter = Math.round((rng() * 2 - 1) * jitterSteps);
      wait = Math.min(Math.max(...p.streak), Math.max(Math.min(...p.streak), wait + jitter));
    }
    // decide at the moment of the jump, not when the hazard first comes into sight
    if (wait > 14) {
      for (let i = 0; i < wait - 14; i++) {
        if (L.stepCube(cube, world, { pressed: false, held: false }, DT, spd(speed, cube)).dead) return { ok: false, x: cube.x, why: 'waiting died' };
      }
      continue;
    }
    const t = trial(cube, world, speed, wait, p.hold, lookahead);
    if (t.r === 'dead') return { ok: false, x: cube.x, why: 'jump failed' };
    Object.assign(cube, t.cube);
  }
  return { ok: guard < 4000, x: cube.x };
}

// Presets a boost at a chunk's pad so a test can prove the chunk at boosted speed regardless of the route.
function boostedCube(chunk, entryX) {
  const cube = L.newCube(2 * L.TILE, chunk.entryH);
  cube.boostX0 = entryX + chunk.pads[0].x * L.TILE;
  return cube;
}

// Drive the cube to targetX by planning, as a player reading the track would.
function driveTo(cube, world, speed, targetX) {
  let guard = 0;
  while (cube.x < targetX && guard++ < 400) {
    const look = Math.min(targetX, cube.x + 56 * L.TILE);
    const p = plan(cube, world, speed, look, new Map());
    if (!p) return false;
    if (p.free) {
      for (let i = 0; i < MAX_TRIAL_STEPS && cube.x < look; i++) {
        if (L.stepCube(cube, world, { pressed: false, held: false }, DT, spd(speed, cube)).dead) return false;
      }
      continue;
    }
    const t = trial(cube, world, speed, p.wait, p.hold, look);
    if (t.r === 'dead') return false;
    Object.assign(cube, t.cube);
  }
  return cube.x >= targetX;
}

// A player who follows every cue: the planner for ordinary chunks, the cue bot for tunnels and orb gaps.
function hybridRun(world, speed, rng, jitterSteps, horizonTiles) {
  const horizon = (horizonTiles || 56) * L.TILE;
  const cube = L.newCube(2 * L.TILE, 0);
  const finish = world.endX - 30 * L.TILE;
  let guard = 0;
  const done = new Set();
  while (cube.x < finish && guard++ < 4000) {
    const cueChunk = world.placed.find(p => p.chunk.cue.length && p.x1 > cube.x && !done.has(p));
    if (cueChunk && cube.x >= cueChunk.x0 - 1) {
      const wobble = Math.round((rng() * 2 - 1) * jitterSteps);
      // after the last press the player is back on the ground with room to spare; hand over to the planner there
      const handOver = cueChunk.x1 - 4 * L.TILE;
      const ok = cueBotClears(cueChunk.chunk, speed, wobble, { world, cube, startX: cueChunk.x0, target: handOver });
      done.add(cueChunk);
      if (!ok) return { ok: false, x: cube.x, why: 'cue ' + cueChunk.chunk.name };
      continue;
    }
    let lookahead = Math.min(finish, cube.x + horizon);
    if (cueChunk) lookahead = Math.min(lookahead, cueChunk.x0);
    if (lookahead <= cube.x) lookahead = cube.x + L.TILE;
    const p = plan(cube, world, speed, lookahead, new Map());
    if (!p) return { ok: false, x: cube.x, why: 'no plan' };
    if (p.free) {
      // the player keeps looking as they run: re-plan every few tiles instead of running blind to the edge of the last plan
      const stop = Math.min(lookahead, cube.x + 6 * L.TILE);
      for (let i = 0; i < MAX_TRIAL_STEPS && cube.x < stop; i++) {
        const ev = L.stepCube(cube, world, { pressed: false, held: false }, DT, spd(speed, cube));
        if (ev.dead) return { ok: false, x: cube.x, why: 'free path died' };
      }
      continue;
    }
    let wait = p.wait;
    if (p.streak && p.streak.length > 2) {
      const jitter = Math.round((rng() * 2 - 1) * jitterSteps);
      wait = Math.min(Math.max(...p.streak), Math.max(Math.min(...p.streak), wait + jitter));
    }
    // a player decides at the moment of the jump, not when the hazard first comes into sight (a plan made a whole screen
    // ahead can land right in front of a hazard it never saw):
    // run up to just before it and plan again from there
    if (wait > 14) {
      for (let i = 0; i < wait - 14; i++) {
        if (L.stepCube(cube, world, { pressed: false, held: false }, DT, spd(speed, cube)).dead) return { ok: false, x: cube.x, why: 'waiting died' };
      }
      continue;
    }
    const t = trial(cube, world, speed, wait, p.hold, lookahead);
    if (t.r === 'dead') return { ok: false, x: cube.x, why: 'jump failed' };
    Object.assign(cube, t.cube);
  }
  return { ok: guard < 4000, x: cube.x };
}

module.exports = { L, DT, slicer, FULL_PHASES, phaseTimes, cueBotClears, hybridRun, boostedCube, driveTo, buildWorld, idle, trial, plan, chunkClearable, pairClearable, botRun, MIN_STREAK, WAIT_STEP };
