const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, chunkClearable, cueBotClears } = require('./support.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

function flatWorld(fields) {
  const w = L.createEmptyWorld();
  L.addGround(w, -50, 4000, 0);
  for (const f of fields || []) w.fields.push(f);
  return w;
}
const BIG = 20000;

// one full jump from a standing start; returns the path as {x, y} (cube centre, y up from the floor)
function jumpPath(world, hold, startX, speed) {
  const cube = L.newCube(startX, 0);
  const floor = cube.y;
  const path = [];
  for (let i = 0; i < 3000; i++) {
    step(cube, world, i < hold, i === 0, speed);
    path.push({ x: cube.x - startX, y: floor - cube.y, t: cube.t });
    if (i > 5 && cube.onGround) break;
  }
  return { path, cube };
}
function yAt(path, x) {
  for (let i = 1; i < path.length; i++) {
    if (path[i].x >= x) {
      const a = path[i - 1], b = path[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return path[path.length - 1].y;
}

// ---- the property everything relies on ----

test('slow time: a jump follows exactly the same path in x and y as at normal time', () => {
  const normal = jumpPath(flatWorld(), 40, 200, 300);
  // a press held for 40 steps of game time is 80 real steps in slow time
  const slow = jumpPath(flatWorld([{ kind: 'slow', x0: 0, x1: BIG }]), 40 / L.SLOW_SCALE, 3000, 300);
  const end = Math.min(normal.path[normal.path.length - 1].x, slow.path[slow.path.length - 1].x) - 4;
  assert.ok(end > 100, 'the jump covers some distance');
  let worst = 0;
  for (let x = 4; x < end; x += 3) worst = Math.max(worst, Math.abs(yAt(normal.path, x) - yAt(slow.path, x)));
  // the two integrate the same arc with a step of 1/120 s and 1/240 s of game time, so they agree to the
  // size of that discretisation (about 2 px on an 80 px arc), not to the last bit
  assert.ok(worst < 3, `paths differ by up to ${worst.toFixed(2)} px`);
  // and it takes about twice as long on the clock of the real steps
  assert.ok(Math.abs(slow.path.length / normal.path.length - 1 / L.SLOW_SCALE) < 0.08, `${slow.path.length} vs ${normal.path.length} steps`);
});

test('slow time halves progress per real step and the game clock together', () => {
  const slow = flatWorld([{ kind: 'slow', x0: 0, x1: BIG }]);
  const a = L.newCube(3000, 0), b = L.newCube(3000, 0);
  for (let i = 0; i < 120; i++) { step(a, slow, false, false, 300); step(b, flatWorld(), false, false, 300); }
  assert.ok(Math.abs((a.x - 3000) / (b.x - 3000) - L.SLOW_SCALE) < 1e-6);
  assert.ok(Math.abs(a.t / b.t - L.SLOW_SCALE) < 1e-6);
});

test('anti-gravity: a held jump peaks about 2.5 times higher and stays up longer', () => {
  const normal = jumpPath(flatWorld(), 200, 200, 300);
  const float = jumpPath(flatWorld([{ kind: 'anti', x0: 0, x1: BIG }]), 200, 3000, 300);
  const peak = p => Math.max(...p.path.map(q => q.y));
  const ratio = peak(float) / peak(normal);
  assert.ok(Math.abs(ratio - 1 / L.FLOAT_GRAVITY) < 0.1, `peak ratio ${ratio.toFixed(2)}`);
  assert.ok(float.path.length > normal.path.length * 1.8);
});

test('everything that is a function of x ignores the time scale: distance, meters, level events, speed and boost', () => {
  const g = L.newGame(5, true, 0);
  const x0 = L.LEVEL_STARTS_M[1] * L.METER_PX - 600;
  g.cube.x = g.startX + x0;
  g.world = L.createEmptyWorld();
  L.addGround(g.world, -50, 4000, 0);
  g.world.endX = 1e9;
  g.world.fields.push({ kind: 'slow', x0: g.cube.x - 100, x1: g.cube.x + 4000 });
  const seen = [];
  const mAt = [];
  for (let i = 0; i < 4000 && seen.length < 1; i++) {
    const ev = L.stepGame(g, { pressed: false, held: false }, DT);
    if (ev.includes('level')) seen.push(L.distancePx(g));
    if (g.state === 'dead') break;
  }
  void mAt;
  assert.equal(g.state, 'running');
  assert.equal(seen.length, 1, 'the level event fired');
  assert.ok(Math.abs(seen[0] - L.LEVEL_STARTS_M[1] * L.METER_PX) < 5, `fired at ${seen[0]} not at the boundary`);
  assert.equal(L.levelAt(g.cube.x - g.startX), g.level);
  const c = L.newCube(0, 0);
  c.boostX0 = 0; c.x = 300;
  assert.equal(L.boostMul(c), L.boostMul(c), 'boost is a function of x only');
});

test('real-time things stay real time: the restart lock counts real steps even inside a slow field', () => {
  const g = L.newGame(6, true, 0);
  g.world = L.createEmptyWorld();
  L.addGround(g.world, -50, 3000, 0);
  g.world.spikes.push({ x0: g.cube.x + 60, x1: g.cube.x + 86, base: L.FLOOR_Y, low: false });
  g.world.fields.push({ kind: 'slow', x0: -100, x1: 1e9 });
  g.world.endX = 1e9;
  for (let i = 0; i < 3000 && g.state === 'running'; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.equal(g.state, 'dead');
  for (let i = 0; i < 24; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.ok(Math.abs(g.deadT - 24 * DT) < 1e-9);
});

// ---- ramps and edges ----

test('field ramps are smooth: zero at the edges, one inside, monotone, and gravity and time scale change gently', () => {
  const f = { kind: 'slow', x0: 1000, x1: 3000 };
  const ramp = L.FIELD_RAMP_TILES * L.TILE;
  assert.equal(L.fieldWeight(f, 1000), 0);
  assert.equal(L.fieldWeight(f, 3000), 0);
  assert.equal(L.fieldWeight(f, 2000), 1);
  assert.ok(Math.abs(L.fieldWeight(f, 1000 + ramp) - 1) < 1e-9);
  let prev = 0;
  for (let x = 1000; x <= 1000 + ramp; x += 1) { const w = L.fieldWeight(f, x); assert.ok(w >= prev - 1e-12); prev = w; }
  const w = flatWorld([f, { kind: 'anti', x0: 5000, x1: 7000 }]);
  const c = L.newCube(1000 - L.CUBE / 2, 0);
  assert.equal(L.timeScale(w, c), 1);
  c.x = 2000 - L.CUBE / 2;
  assert.ok(Math.abs(L.timeScale(w, c) - L.SLOW_SCALE) < 1e-9);
  c.x = 6000 - L.CUBE / 2;
  assert.ok(Math.abs(L.gravMul(w, c) - L.FLOAT_GRAVITY) < 1e-9);
});

test('leaving an anti-gravity field mid-air, at any phase of a jump, is smooth and ends in a safe landing', () => {
  for (const speed of [L.levelSpeed(0), L.levelSpeed(3), L.levelSpeed(6)]) {
    for (let exitTile = 2; exitTile < 40; exitTile += 0.5) {
      const world = flatWorld([{ kind: 'anti', x0: 0, x1: 2000 + exitTile * L.TILE }]);
      const cube = L.newCube(2000 - L.CUBE / 2 - 3 * L.TILE, 0);
      let prevVy = 0, maxJump = 0, died = null, landed = false;
      for (let i = 0; i < 3000 && !landed; i++) {
        const ev = step(cube, world, i < 57, i === 0, speed);
        if (i > 0) maxJump = Math.max(maxJump, Math.abs(cube.vy - prevVy));
        prevVy = cube.vy;
        if (ev.dead) died = ev.dead;
        if (i > 5 && cube.onGround) landed = true;
      }
      assert.equal(died, null, `exit ${exitTile} tiles in, speed ${Math.round(speed)}`);
      assert.ok(landed, `landed (exit ${exitTile})`);
      assert.ok(maxJump < 60 * 1.7 * 2434 * DT, `velocity jolt ${maxJump.toFixed(0)} at exit ${exitTile}`);
    }
  }
});

// ---- the chunks ----

test('field chunks: easy forms from the start, never mixed with tunnels or orbs, and visible well ahead', () => {
  const withFields = L.CHUNKS.filter(c => c.fields.length);
  assert.ok(withFields.length >= 4 * 4);
  for (const c of withFields) {
    assert.equal(c.ceilings.length, 0, `${c.name} has a roof inside a field`);
    assert.equal(c.orbs.length + c.pads.length + c.crumble.length + c.moving.length, 0, `${c.name} mixes in other mechanics`);
    for (const f of c.fields) assert.ok(f.x0 <= L.PAD, `${c.name}: the field starts at the chunk's entry so it is seen early`);
  }
  assert.equal(chunk('slowRun@0').diff, 0);
  assert.equal(chunk('floatGap0@0').diff, 1);
  assert.ok(L.VIEW_AHEAD_PX / L.TILE >= 25);
  // the start ring of a float gap sits where the field already has full strength
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const c = chunk(`floatGap${k}@0`);
    const f = c.fields[0];
    const ringX = c.cue[0].at * L.TILE;
    assert.equal(L.fieldWeight({ x0: f.x0 * L.TILE, x1: f.x1 * L.TILE }, ringX), 1, `level ${k}: the ring is inside the ramp`);
  }
  for (const seed of [1, 2, 3]) {
    const w = L.createWorld(seed);
    while (w.count < 300) L.extendWorld(w, w.endX + 1 - L.TILE * 70, 5000 * L.METER_PX);
    for (const f of w.fields) for (const r of w.ceilings) assert.ok(f.x1 <= r.x0 || f.x0 >= r.x1, 'a field overlaps a roof');
  }
});

test('every field chunk is clearable at every level speed and at points between levels', () => {
  const failed = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const speeds = [L.levelSpeed(k)];
    if (k > 0) for (const f of [0.2, 0.5, 0.8]) speeds.push(L.levelSpeed(k - 1) + (L.levelSpeed(k) - L.levelSpeed(k - 1)) * f);
    for (const sp of speeds) {
      for (const c of L.CHUNKS.filter(q => q.fields.length && q.steadyLevel === null)) if (!chunkClearable(c, sp)) failed.push(`${c.name} at ${Math.round(sp)}`);
      const own = L.CHUNKS.filter(q => q.needsField && q.steadyLevel === k);
      if (Math.abs(sp - L.levelSpeed(k)) < 1e-9) for (const c of own) if (!chunkClearable(c, sp)) failed.push(`${c.name} at its own speed`);
    }
  }
  assert.deepEqual(failed, []);
});

test('field chunks with a level boundary inside them stay clearable', () => {
  const failed = [];
  for (let k = 1; k <= L.LAST_LEVEL; k++) {
    for (const c of L.CHUNKS.filter(q => q.fields.length && q.steadyLevel === null && (q.entryH === 0 || q.entryH === 3))) {
      for (const at of [1, Math.floor(c.w / 2), c.w - 1]) {
        const bx = 8 * L.TILE + at * L.TILE;
        const sp = x => L.speedAt(L.LEVEL_STARTS_M[k] * L.METER_PX + (x - bx));
        if (!chunkClearable(c, sp)) failed.push(`${c.name}: level ${k} starts ${at} tiles in`);
      }
    }
  }
  assert.deepEqual(failed, []);
});

test('a float gap needs the anti-gravity field: not with the field removed, not with slow time instead, yes with it', () => {
  for (const h of [0, 3]) {
    for (let k = 0; k <= L.LAST_LEVEL; k++) {
      const c = chunk(`floatGap${k}@${h}`);
      const speed = L.levelSpeed(k);
      assert.equal(chunkClearable(c, speed), true, `${c.name} with its field`);
      const noField = Object.assign({}, c, { fields: [] });
      assert.equal(chunkClearable(noField, speed), false, `${c.name} without the field`);
      const slowInstead = Object.assign({}, c, { fields: c.fields.map(f => Object.assign({}, f, { kind: 'slow' })) });
      assert.equal(chunkClearable(slowInstead, speed), false, `${c.name} with slow time in place of the field`);
    }
  }
});

test('following the start ring with a full hold clears each float gap, with timing wobble; a plain jump there does not', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const c = chunk(`floatGap${k}@0`);
    const speed = L.levelSpeed(k);
    for (const wobble of [-2, -1, 0, 1, 2]) assert.equal(cueBotClears(c, speed, wobble), true, `${c.name}, wobble ${wobble}`);
    const noField = Object.assign({}, c, { fields: [] });
    assert.equal(cueBotClears(noField, speed, 0), false, `${c.name} without the field`);
    // the window for the start press is at least 67 ms of real time
    let best = 0, run = 0;
    for (let w = -20; w <= 20; w++) { if (cueBotClears(c, speed, w)) { run++; best = Math.max(best, run); } else run = 0; }
    assert.ok(best * DT >= 0.067, `${c.name}: window ${(best * DT * 1000).toFixed(0)} ms`);
  }
});

test('the 3-hazard cap holds with the longer anti-gravity jump range, at every level speed', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const range = (L.levelSpeed(k) * L.floatAirTime()) / L.TILE;
    for (const c of L.CHUNKS.filter(q => q.fields.some(f => f.kind === 'anti'))) {
      const xs = c.spikes.map(s => s.x).concat(c.ceilings.map(r => r.x0)).sort((a, b) => a - b);
      for (let i = 0; i < xs.length; i++) {
        const inReach = xs.filter(x => x >= xs[i] && x + 1 - xs[i] <= range).length;
        assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name} at level ${k}: ${inReach} hazards in one jump`);
      }
    }
  }
});

test('field chunks around their neighbours: every chunk can sit before or after a field chunk', () => {
  const { driveTo, plan, pairClearable } = require('./support.js');
  const failed = [];
  // pairs with a float gap (steady, cue driven) go planner -> cue bot or cue bot -> planner; the rest use one plan
  const mixed = (a, b, speed) => {
    const world = buildWorld([a, b]);
    const cube = L.newCube(2 * L.TILE, a.entryH);
    const join = 8 * L.TILE + a.w * L.TILE;
    if (a.needsField) {
      if (!cueBotClears(a, speed, 0, { world, cube, startX: 8 * L.TILE, target: join - 4 * L.TILE })) return false;
    } else if (!driveTo(cube, world, speed, join)) return false;
    if (b.needsField) return cueBotClears(b, speed, 0, { world, cube, startX: join, target: world.endX - 8 * L.TILE });
    return plan(cube, world, speed, world.endX - 8 * L.TILE, new Map()) !== null;
  };
  for (const f of L.CHUNKS.filter(c => c.fields.length && (c.entryH === 0 || c.entryH === 3))) {
    const speed = f.steadyLevel === null ? L.levelSpeed(2) : L.levelSpeed(f.steadyLevel);
    for (const o of L.CHUNKS) {
      if (o.steadyLevel !== null || (o.entryH !== 0 && o.entryH !== 3)) continue;
      const ok = (a, b) => (f.needsField ? mixed(a, b, speed) : pairClearable(a, b, speed));
      if (o.exitH === f.entryH && !ok(o, f)) failed.push(`${o.name} -> ${f.name}`);
      if (f.exitH === o.entryH && !ok(f, o)) failed.push(`${f.name} -> ${o.name}`);
    }
  }
  assert.deepEqual(failed, [], `not clearable: ${failed.slice(0, 12).join('; ')}`);
});
