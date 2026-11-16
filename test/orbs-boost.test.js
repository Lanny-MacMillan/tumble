const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, chunkClearable, cueBotClears, boostedCube, hybridRun, driveTo } = require('./support.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const orbChunks = h => L.CHUNKS.filter(c => c.needsOrb && c.entryH === h);
const LEAD_X = 8 * L.TILE;
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

// ---- orb gaps: required, followable, fair ----

test('an orb gap cannot be crossed without the orbs, at its own level speed', () => {
  assert.equal(orbChunks(0).length, L.LAST_LEVEL + 1);
  for (const h of [0, 3]) {
    for (const c of orbChunks(h)) {
      const speed = L.levelSpeed(c.steadyLevel);
      const bare = Object.assign({}, c, { orbs: [], cue: c.cue.filter(q => q.kind !== 'orb') });
      assert.equal(chunkClearable(bare, speed), false, `${c.name}: the plain planner found a way across at ${Math.round(speed)} px/s`);
    }
  }
});

test('jumping at the gems clears each orb gap with no other press, with timing wobble, and uses every orb', () => {
  for (const h of [0, 3]) {
    for (const c of orbChunks(h)) {
      const speed = L.levelSpeed(c.steadyLevel);
      for (const wobble of [-2, -1, 0, 1, 2]) {
        const world = buildWorld([c]);
        const cube = L.newCube(2 * L.TILE, c.entryH);
        assert.equal(cueBotClears(c, speed, wobble, { world, cube }), true, `${c.name}, wobble ${wobble}`);
        assert.equal(Object.keys(cube.orbs).length, c.orbs.length, `${c.name}: not every orb was used`);
      }
    }
  }
});

test('a player who never jumps, or jumps far too early, misses the first ring and falls in the gap', () => {
  for (const c of orbChunks(0)) {
    const speed = L.levelSpeed(c.steadyLevel);
    const none = Object.assign({}, c, { cue: [] });
    assert.equal(cueBotClears(none, speed, 0), false, `${c.name} with no press`);
    assert.equal(cueBotClears(c, speed, 40), false, `${c.name} jumping 40 steps early`);
  }
});

test('the take-off window for each orb gap is at least 67 ms wide', () => {
  for (const c of orbChunks(0)) {
    const speed = L.levelSpeed(c.steadyLevel);
    let best = 0, run = 0;
    for (let w = -20; w <= 20; w++) {
      if (cueBotClears(c, speed, w)) { run++; best = Math.max(best, run); } else run = 0;
    }
    assert.ok(best * DT >= 0.067, `${c.name}: window only ${(best * DT * 1000).toFixed(0)} ms`);
  }
});

// ---- orb gaps next to other chunks ----

const { plan } = require('./support.js');
function orbPair(a, b, speed) {
  const world = buildWorld([a, b]);
  const cube = L.newCube(2 * L.TILE, a.entryH);
  const joinX = LEAD_X + a.w * L.TILE;
  if (a.needsOrb) {
    if (!cueBotClears(a, speed, 0, { world, cube, startX: LEAD_X, target: joinX - 4 * L.TILE })) return false;
  } else if (!driveTo(cube, world, speed, joinX)) return false;
  if (b.needsOrb) return cueBotClears(b, speed, 0, { world, cube, startX: joinX, target: world.endX - 8 * L.TILE });
  return plan(cube, world, speed, world.endX - 8 * L.TILE, new Map()) !== null;
}
// plan() above only reaches the join; continue from wherever the first chunk left the cube

test('every chunk that can sit before or after an orb gap is clearable around it, at the orb gap level speed', () => {
  const failed = [];
  for (const o of L.CHUNKS.filter(c => c.needsOrb && (c.entryH === 0 || c.entryH === 3))) {
    const speed = L.levelSpeed(o.steadyLevel);
    for (const c of L.CHUNKS) {
      if (c.needsOrb || c.steadyLevel !== null) continue;
      if (c.exitH === o.entryH && !orbPair(c, o, speed)) failed.push(`${c.name} -> ${o.name}`);
      if (o.exitH === c.entryH && !orbPair(o, c, speed)) failed.push(`${o.name} -> ${c.name}`);
    }
  }
  assert.deepEqual(failed, [], `not clearable: ${failed.slice(0, 15).join('; ')}`);
});

test('the rings lie over the gap, above the ground, and only one orb sits at each spot', () => {
  for (const c of orbChunks(0)) {
    const gapStart = c.ground[0].x1;
    for (const o of c.orbs) {
      assert.ok(o.x > gapStart && o.x < c.w, `${c.name}: ring outside the gap`);
      assert.ok(o.h >= c.entryH + 1, `${c.name}: ring too low`);
    }
    assert.equal(new Set(c.orbs.map(o => o.x)).size, c.orbs.length);
  }
});

// ---- the orb rule itself ----

function flight(vy0, speed) {
  const world = L.createEmptyWorld();
  const cube = L.newCube(0, 0);
  cube.onGround = false; cube.coyote = 0; cube.y = 200; cube.vy = vy0;
  const path = [];
  const probe = L.cloneCube(cube);
  for (let i = 0; i < 160; i++) {
    path.push({ x: probe.x + L.CUBE / 2, y: probe.y + L.CUBE / 2, vy: probe.vy });
    step(probe, world, false, false, speed);
  }
  return { world, cube, path };
}
function withOrb(world, at, dy) { world.orbs.push({ id: 'oT', x: at.x, y: at.y + (dy || 0), r: L.ORB_R_TILES * L.TILE }); }
function runFlight(f, pressAt, held, steps = 160) {
  const cube = L.cloneCube(f.cube);
  const events = [], ys = [];
  for (let i = 0; i < steps; i++) {
    const pressed = pressAt.includes(i);
    const ev = step(cube, f.world, held, pressed, 300);
    if (ev.orb) events.push({ i });
    ys.push(cube.y);
  }
  return { cube, events, ys };
}

test('passing through a ring throws the cube with no press, on the way up and on the way down', () => {
  const up = flight(-500, 300), down = flight(-500, 300);
  const apex = up.path.findIndex((p, i) => i > 0 && p.vy >= 0);
  withOrb(up.world, up.path[Math.floor(apex / 2)]);
  const rUp = runFlight(up, [], false);
  assert.equal(rUp.events.length, 1, 'rising through the ring');
  withOrb(down.world, down.path[apex + 25]);
  const rDown = runFlight(down, [], false);
  assert.equal(rDown.events.length, 1, 'falling through the ring');
  assert.ok(rDown.cube.vy > -L.ORB_V, 'and the throw was upward, then gravity took over');
});

test('the throw is the same whatever the buttons do: held, released, tapped or mashed', () => {
  const f = flight(0, 300);
  withOrb(f.world, f.path[30]);
  const base = runFlight(f, [], false).ys;
  const all = Array.from({ length: 160 }, (_, i) => i);
  for (const [press, held] of [[[], true], [[29, 31, 40], false], [all, true], [[35], true]]) {
    const ys = runFlight(f, press, held).ys;
    for (let i = 30; i < 160; i++) assert.ok(Math.abs(ys[i] - base[i]) < 1e-9, `step ${i}: ${ys[i]} vs ${base[i]}`);
  }
  // and it peaks ORB_APEX_TILES above the ring
  const fired = runFlight(f, [], false);
  const top = Math.min(...fired.ys.slice(fired.events[0].i));
  const ringTop = f.path[30].y - L.CUBE / 2;
  assert.ok(Math.abs((ringTop - top) / L.TILE - L.ORB_APEX_TILES) < 0.1, `apex ${((ringTop - top) / L.TILE).toFixed(2)} tiles`);
});

test('a cube that passes beside a ring, outside it, is not thrown', () => {
  const f = flight(0, 300);
  withOrb(f.world, f.path[30], L.ORB_R_TILES * L.TILE + 3);
  assert.equal(runFlight(f, [], false).events.length, 0, 'passing above');
  const g = flight(0, 300);
  withOrb(g.world, g.path[30], -(L.ORB_R_TILES * L.TILE + 3));
  assert.equal(runFlight(g, [], false).events.length, 0, 'passing below');
});

test('the ring never pulls the cube into ground, a roof or a spike, and still throws it', () => {
  // an orb whose centre sits inside the floor: the snap would bury the cube, so it must not move it
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 400, 0);
  world.orbs.push({ id: 'oBad', x: 300, y: L.FLOOR_Y - 4, r: L.ORB_R_TILES * L.TILE });
  const cube = L.newCube(300 - L.CUBE / 2 - 2, 0);
  cube.onGround = false; cube.coyote = 0; cube.y = L.FLOOR_Y - L.CUBE - 12; cube.vy = 0;
  let fired = null;
  for (let i = 0; i < 3 && !fired; i++) {
    const before = cube.y;
    const ev = step(cube, world, false, false, 300);
    if (ev.orb) fired = { before, after: cube.y };
  }
  assert.ok(fired, 'passing through fires the orb');
  assert.ok(L.boxClear(world, cube.x, cube.y + 0.0001) || cube.y + L.CUBE <= L.FLOOR_Y + 0.5, 'the cube is not inside the floor');
  assert.ok(cube.vy < 0, 'and it was thrown upward');
  assert.ok(Math.abs(fired.after - (L.FLOOR_Y - 4 - L.CUBE / 2)) > 5, 'the cube was not moved onto the ring centre');
  // a roof and a spike behave the same
  assert.equal(L.boxClear(world, 300, L.FLOOR_Y - 4), false);
  const w2 = L.createEmptyWorld();
  w2.ceilings.push({ x0: 0, x1: 1000, bottom: 100 });
  assert.equal(L.boxClear(w2, 300, 60), false);
  assert.equal(L.boxClear(w2, 300, 110), true);
  const w3 = L.createEmptyWorld();
  w3.spikes.push({ x0: 290, x1: 316, base: L.FLOOR_Y, low: false });
  assert.equal(L.boxClear(w3, 296, L.FLOOR_Y - L.CUBE - 2), false);
  assert.equal(L.boxClear(w3, 296, L.FLOOR_Y - L.CUBE - 20), true);
});

test('in every real orb gap, the exact centre of each ring is free space and out of reach of a cube on the ground', () => {
  for (const c of L.CHUNKS.filter(q => q.needsOrb)) {
    const world = buildWorld([c]);
    for (const o of world.orbs) {
      assert.equal(L.boxClear(world, o.x - L.CUBE / 2, o.y - L.CUBE / 2), true, `${c.name}: ring at ${Math.round(o.x)} is not in free space`);
      const groundCentre = L.FLOOR_Y - c.entryH * L.TILE - L.CUBE / 2;
      assert.ok(groundCentre - o.y > o.r, `${c.name}: a cube running on the ground would touch the ring`);
    }
  }
});

test('an orb throws only once', () => {
  const f = flight(0, 300);
  withOrb(f.world, f.path[30]);
  const all = Array.from({ length: 160 }, (_, i) => i);
  const r = runFlight(f, all, true);
  assert.equal(r.events.length, 1);
  assert.equal(Object.keys(r.cube.orbs).length, 1);
});

test('a press waiting in the buffer is spent by the throw, so it cannot add a jump', () => {
  const f = flight(0, 300);
  withOrb(f.world, f.path[30]);
  const cube = L.cloneCube(f.cube);
  for (let i = 0; i < 31; i++) step(cube, f.world, false, i === 28, 300);
  assert.equal(Object.keys(cube.orbs).length, 1);
  assert.equal(cube.buffer, 0);
});

// ---- boost pads ----

test('the boost profile: nothing without a pad, eases up, holds, eases down, and ends inside the run', () => {
  const c = L.newCube(0, 0);
  assert.equal(L.boostMul(c), 1);
  c.boostX0 = 1000;
  const run = L.BOOST_RUN_TILES * L.TILE, ramp = L.BOOST_RAMP_TILES * L.TILE;
  c.x = 1000; assert.equal(L.boostMul(c), 1);
  c.x = 1000 + ramp; assert.ok(Math.abs(L.boostMul(c) - L.BOOST_MUL) < 1e-9);
  c.x = 1000 + run / 2; assert.ok(Math.abs(L.boostMul(c) - L.BOOST_MUL) < 1e-9);
  c.x = 1000 + run - ramp; assert.ok(Math.abs(L.boostMul(c) - L.BOOST_MUL) < 1e-9);
  c.x = 1000 + run; assert.equal(L.boostMul(c), 1);
  let prev = 1;
  for (let x = 1000; x <= 1000 + ramp; x++) { c.x = x; const m = L.boostMul(c); assert.ok(m >= prev - 1e-12); prev = m; }
  assert.ok(Math.abs(L.BOOST_CAP - L.SPEED_MAX * L.BOOST_MUL) < 1e-9);
});

test('touching the pad on the ground boosts; the boost ends by itself and never leaks past the chunk', () => {
  const c = chunk('boostRun@0');
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 200, 0);
  world.pads.push({ x0: 400, x1: 400 + 3 * L.TILE });
  const cube = L.newCube(380, 0);
  let maxMul = 1, started = false, endedAt = null;
  for (let i = 0; i < 3000 && cube.x < 400 + 40 * L.TILE; i++) {
    const m = L.boostMul(cube);
    maxMul = Math.max(maxMul, m);
    step(cube, world, false, false, 300 * m);
    if (cube.boostX0 !== null) started = true;
    if (started && cube.boostX0 === null && endedAt === null) endedAt = cube.x;
  }
  assert.ok(started, 'the pad started a boost');
  assert.ok(Math.abs(maxMul - L.BOOST_MUL) < 1e-6);
  assert.ok(endedAt !== null && endedAt >= 400 + L.BOOST_RUN_TILES * L.TILE - 1, 'ended at the planned distance');
  // and in the real chunk the run ends before the chunk does, so the next chunk starts at level speed
  const pad = c.pads[0];
  assert.ok(pad.x + L.BOOST_RUN_TILES <= c.w, `run ends at tile ${pad.x + L.BOOST_RUN_TILES}, chunk ends at ${c.w}`);
  const end = L.createEmptyWorld();
  const probe = L.newCube(0, 0);
  probe.boostX0 = 0; probe.x = c.w * L.TILE - pad.x * L.TILE;
  assert.equal(L.boostMul(probe), 1, 'speed multiplier at the first tile of the next chunk');
});

test('jumping over the pad leaves the boost off for the whole chunk', () => {
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 200, 0);
  world.pads.push({ x0: 600, x1: 600 + 3 * L.TILE });
  const cube = L.newCube(300, 0);
  let jumped = false, maxMul = 1;
  for (let i = 0; i < 2000 && cube.x < 600 + 30 * L.TILE; i++) {
    const pressed = !jumped && cube.x >= 600 - 60;
    if (pressed) jumped = true;
    step(cube, world, true, pressed, 300 * L.boostMul(cube));
    maxMul = Math.max(maxMul, L.boostMul(cube));
  }
  assert.equal(maxMul, 1);
  assert.equal(cube.boostX0, null);
});

test('touching the pad while airborne gives no boost; landing on it does', () => {
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 200, 0);
  world.pads.push({ x0: 600, x1: 600 + 3 * L.TILE });
  const high = L.newCube(560, 0);
  high.onGround = false; high.coyote = 0; high.y = L.FLOOR_Y - 200;
  const seen = [];
  for (let i = 0; i < 60 && high.x < 640; i++) { step(high, world, false, false, 300); seen.push(high.onGround); }
  assert.equal(high.boostX0, null, 'passing over the pad in the air');
  const landing = L.newCube(560, 0);
  landing.onGround = false; landing.coyote = 0; landing.y = L.FLOOR_Y - L.CUBE - 8;
  for (let i = 0; i < 20; i++) step(landing, world, false, false, 300);
  assert.equal(landing.boostX0, 600, 'landing on the pad boosts from its start');
});

test('a death and restart clear the boost and every used orb', () => {
  const g = L.newGame(3, true, 0);
  g.cube.boostX0 = 100; g.cube.orbs = { a: true };
  const fresh = L.newGame(4, true, 0);
  assert.equal(fresh.cube.boostX0, null);
  assert.deepEqual(fresh.cube.orbs, {});
  const copy = L.cloneCube(g.cube);
  copy.orbs.b = true;
  assert.deepEqual(Object.keys(g.cube.orbs), ['a'], 'cloning does not share the used-orb set');
});

test('boostRun: clearable normally and clearly with the boost forced on, at every level speed and in between', () => {
  const failed = [];
  for (const h of [0, 1, 2, 3]) {
    const c = chunk(`boostRun@${h}`);
    for (let k = 0; k <= L.LAST_LEVEL; k++) {
      const speeds = [L.levelSpeed(k)];
      if (k > 0) for (const f of [0.15, 0.5, 0.85]) speeds.push(L.levelSpeed(k - 1) + (L.levelSpeed(k) - L.levelSpeed(k - 1)) * f);
      for (const sp of speeds) {
        if (!chunkClearable(c, sp)) failed.push(`${c.name} plain at ${Math.round(sp)}`);
        if (!forcedClearable(c, sp)) failed.push(`${c.name} boosted at ${Math.round(sp)}`);
      }
    }
  }
  assert.deepEqual(failed, []);
});

function forcedClearable(c, speed) {
  const { plan } = require('./support.js');
  const world = buildWorld([c]);
  const cube = boostedCube(c, LEAD_X);
  return plan(cube, world, speed, world.endX - 8 * L.TILE, new Map()) !== null;
}

test('boostRun with a level boundary falling inside it: the speed is level times boost, and it is still clearable', () => {
  const failed = [];
  const c = chunk('boostRun@0');
  for (let k = 1; k <= L.LAST_LEVEL; k++) {
    for (const at of [1, 4, 8, 12, 16, 20, 24, 28, c.w - 1]) {
      const boundaryX = LEAD_X + at * L.TILE;
      const sp = x => L.speedAt(L.LEVEL_STARTS_M[k] * L.METER_PX + (x - boundaryX));
      if (!forcedClearable(c, sp)) failed.push(`level ${k} starts ${at} tiles in (boosted)`);
      if (!chunkClearable(c, sp)) failed.push(`level ${k} starts ${at} tiles in (plain)`);
    }
  }
  assert.deepEqual(failed, []);
});

test('the 3-hazard cap holds at boosted speed in a boost chunk', () => {
  const c = chunk('boostRun@0');
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const sp = Math.min(L.levelSpeed(k) * L.BOOST_MUL, L.BOOST_CAP);
    const range = (sp * L.AIR_TIME_FULL) / L.TILE;
    const xs = c.spikes.map(s => s.x).concat(c.ceilings.map(r => r.x0)).sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i++) {
      const inReach = xs.filter(x => x >= xs[i] && x + 1 - xs[i] <= range).length;
      assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `level ${k}: ${inReach} hazards`);
    }
  }
});

// ---- where the new pieces appear ----

test('the level 0 orb gap is the gentlest: two rings and the shortest gap', () => {
  const first = chunk('orbGap0@0');
  assert.equal(first.orbs.length, 2);
  const gap = c => c.ground[1].x0 - c.ground[0].x1;
  for (const c of orbChunks(0)) assert.ok(gap(first) <= gap(c), `${c.name} has a shorter gap than the first one`);
});

test('orb gaps only appear where the speed is exactly their level speed along their whole length', () => {
  let found = 0;
  for (const seed of [51, 52, 53]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    for (const p of world.placed) {
      const c = p.chunk;
      assert.ok(c.minLevel <= L.levelAt(p.x0 - start), `${c.name} appears too early`);
      if (c.steadyLevel === null) continue;
      found++;
      const want = L.levelSpeed(c.steadyLevel);
      for (let x = p.x0; x <= p.x1; x += L.TILE / 2) {
        assert.ok(Math.abs(L.speedAt(x - start) - want) < 1e-9, `${c.name} at ${x - start} px: speed ${L.speedAt(x - start)} not ${want}`);
      }
    }
  }
  assert.ok(found >= 10, `only ${found} orb gaps in the test worlds`);
});

test('every piece exists from level 0, orb gaps are tied to their level speed, and each level can show its own', () => {
  for (const c of L.CHUNKS) {
    assert.equal(c.minLevel, 0, `${c.name} should be available from the start`);
    if (c.needsOrb) assert.ok(c.steadyLevel >= 0 && c.steadyLevel <= L.LAST_LEVEL);
  }
  const seen = new Set();
  for (const seed of [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    for (const p of world.placed) if (p.chunk.needsOrb) seen.add(p.chunk.steadyLevel);
  }
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(seen.has(k), `no orb gap for level ${k}; seen ${[...seen]}`);
});

test('practice starts at the level an orb gap was built for', () => {
  const seq = [chunk('boostRun@0'), chunk('orbGap1@0')];
  assert.equal(L.practiceStart(seq), 1);
  const g = L.newGame(7, true, 0, seq, L.practiceStart(seq));
  assert.equal(g.level, 1);
  assert.ok(Math.abs(L.speedAt(L.distancePx(g)) - L.levelSpeed(1)) < 1e-9);
  assert.equal(L.practiceStart([chunk('tunnel1@0')]), 0);
});

// ---- following every cue clears whole generated worlds ----

function cueWorld(seed, level, chunks) {
  const world = L.createWorld(seed, null, null, level);
  const has = n => world.placed.some(p => p.chunk.name.startsWith(n));
  // keep going until the world has the pieces the test is about
  while (world.count < chunks || (!(has('orbGap') && has('boostRun') && has('tunnel') && has('floatGap') && has('slow')) && world.count < 300)) {
    L.extendWorld(world, world.endX + 1 - L.TILE * 70, 5000 * L.METER_PX);
  }
  return world;
}

for (const level of [0, 6]) {
  test(`cue-following player clears a generated world at level ${level} speed (tunnels and orb gaps by cue, the rest by planning)`, () => {
    const world = cueWorld(70 + level, level, 40);
    const kinds = new Set(world.placed.map(p => p.chunk.name.split('@')[0]));
    assert.ok([...kinds].some(k => k.startsWith('orbGap')), 'the world has orb gaps');
    assert.ok([...kinds].some(k => k.startsWith('tunnel')), 'the world has tunnels');
    assert.ok(kinds.has('boostRun'), 'the world has boost runs');
    const r = hybridRun(world, L.levelSpeed(level), L.mulberry32(level * 11), 2);
    assert.equal(r.ok, true, `level ${level}: ${r.why} at x=${Math.round(r.x)} of ${Math.round(world.endX)}`);
  });
}
