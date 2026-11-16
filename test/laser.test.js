const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, cueBotClears, chunkClearable } = require('./support.js');
const { closure } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);
const SPEEDS = [['min', L.SPEED_MIN], ['mid', (L.SPEED_MIN + L.SPEED_MAX) / 2], ['max', L.SPEED_MAX]];
const HOLDS = [1, 4, 8, 12, 16, 20, 24, 32, 44, 57, 80, 114];
const allSpeeds = () => {
  const out = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) { out.push(L.levelSpeed(k)); if (k) out.push((L.levelSpeed(k) + L.levelSpeed(k - 1)) / 2); }
  return out;
};

test('shieldLaser exists at every height in tier 2, the pickup GATE_PICKUP_DIST_TILES before its gate, 2.2 tiles up', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`shieldLaser@${h}`);
    assert.ok(c, `shieldLaser@${h}`);
    assert.equal(c.diff, 2);
    assert.equal(c.pickups.length, 1);
    assert.equal(c.gates.length, 1);
    assert.equal(c.gates[0].x - c.pickups[0].x, L.GATE_PICKUP_DIST_TILES);
    assert.equal(c.pickups[0].h - h, L.GATE_PICKUP_H);
    assert.equal(L.GATE_PICKUP_DIST_TILES, 14);
  }
  assert.deepEqual(L.CHUNKS.filter(c => c.gates.length).map(c => c.name.split('@')[0]).filter((n, i, a) => a.indexOf(n) === i).sort(), ['shieldDrop', 'shieldLaser']);
});

test('a gate: no shield kills, a shield is spent and breaks the beam for that cube, and no jump gets over it', () => {
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 4000, 0);
  world.gates.push({ id: 'g1', x0: 600, x1: 626, y: L.FLOOR_Y, kind: 'laser' });
  const run = cube => { let dead = null, shields = 0; for (let i = 0; i < 400 && !dead; i++) { const ev = step(cube, world, false, false, 351); dead = ev.dead; if (ev.shield) shields++; } return { dead, shields }; };
  assert.equal(run(L.newCube(2 * L.TILE, 0)).dead, 'laser');
  const shielded = L.newCube(2 * L.TILE, 0);
  shielded.shield = true;
  const r = run(shielded);
  assert.equal(r.dead, null);
  assert.equal(r.shields, 1);
  assert.equal(shielded.shield, false);
  assert.ok(shielded.broken.g1);
  assert.ok(shielded.x > 640);
  // the safe spell without a shield also gets through, and breaks it
  const safe = L.newCube(2 * L.TILE, 0);
  safe.inv = 2;
  assert.equal(run(safe).dead, null);
  assert.ok(safe.broken.g1);
  // a shield taken while the safe spell is running is still spent at the gate (nothing leaves a chunk holding one)
  const both = L.newCube(2 * L.TILE, 0);
  both.shield = true; both.inv = 2;
  run(both);
  assert.equal(both.shield, false);
  // no jump, of any length or timing, clears the beam: it is full height
  for (const hold of [1, 20, 114]) for (let wait = 0; wait < 120; wait += 3) {
    const cube = L.newCube(2 * L.TILE, 0);
    let dead = null;
    for (let i = 0; i < 400 && !dead; i++) dead = step(cube, world, i >= wait && i < wait + hold, i === wait, 351).dead;
    assert.equal(dead, 'laser', `hold ${hold} wait ${wait}`);
  }
});

test('nothing sits between the pickup and the gate, or near them: the only way to lose the shield is a terrain death', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`shieldLaser@${h}`);
    assert.equal(c.spikes.length + c.ceilings.length + c.moving.length + c.crumble.length + c.boxes.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length + c.bounces.length + c.platforms.length + c.flips.length, 0, `${c.name}`);
    assert.equal(c.ground.length, 1, `${c.name}: one flat run, no gap`);
    assert.equal(c.maxGap, 0);
    assert.ok(c.w - (c.gates[0].x + c.gates[0].w) >= 10, `${c.name}: a long landing`);
  }
});

// launches taken at each step from a standing run; how many in a row take the pickup
function pickupWindow(c, speed, hold) {
  const world = buildWorld([c]);
  const q = world.pickups[0];
  let best = 0, run = 0;
  for (let wait = 0; wait < 400; wait++) {
    const cube = L.newCube(2 * L.TILE, c.entryH);
    let took = false, dead = null;
    for (let i = 0; i < 260 && !dead; i++) {
      const ev = step(cube, world, i >= wait && i < wait + hold, i === wait, speed);
      if (ev.pickup) took = true;
      dead = ev.dead;
      if (cube.x > q.x + 6 * L.TILE) break;
    }
    if (took) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best * DT * 1000;
}

test('the pickup needs a hop, and a tap or any hold takes it with a 67 ms window at every speed', () => {
  const c = chunk('shieldLaser@0');
  for (const [label, speed] of SPEEDS) {
    // a walker passes under it
    const world = buildWorld([c]);
    const walker = L.newCube(2 * L.TILE, 0);
    let walked = 0;
    for (let i = 0; i < 600 && !walked; i++) { const ev = step(walker, world, false, false, speed); if (ev.pickup) walked++; if (ev.dead) break; }
    assert.equal(walked, 0, `${label}: a walker took the pickup`);
    for (const hold of HOLDS) {
      const ms = pickupWindow(c, speed, hold);
      assert.ok(ms >= 67, `${label} hold ${hold}: only ${ms.toFixed(0)} ms of launch times take it`);
    }
  }
});

test('the pickup and the gate are in view 1.5 s ahead at max speed, the same bar as a tunnel', () => {
  assert.ok(L.CUE_WARN_AT_MAX_S >= 1.5, `${L.CUE_WARN_AT_MAX_S.toFixed(2)} s`);
  const c = chunk('shieldLaser@0');
  // the whole run from the pickup to the gate is flat and clear of anything that hides it
  assert.ok((c.gates[0].x - c.pickups[0].x) * L.TILE <= L.VIEW_AHEAD_PX);
});

test('following the gems clears it at every level speed and in between, with wobble; ignoring them dies at the gate', () => {
  const c = chunk('shieldLaser@0');
  for (const speed of allSpeeds()) {
    for (const wobble of [-4, -2, 0, 2, 4]) assert.equal(cueBotClears(c, speed, wobble), true, `${Math.round(speed)} px/s, wobble ${wobble}`);
    // the cue window: how many wobbles in a row clear it
    let best = 0, run = 0;
    for (let w = -20; w <= 20; w++) { if (cueBotClears(c, speed, w)) { run++; best = Math.max(best, run); } else run = 0; }
    assert.ok(best * DT >= 0.067, `${Math.round(speed)} px/s: cue window only ${(best * DT * 1000).toFixed(0)} ms`);
    // a player who ignores the gems and just runs is a real casualty: the check is real
    const world = buildWorld([c]);
    const idleRun = idle(L.newCube(2 * L.TILE, 0), world, speed, world.endX - 8 * L.TILE);
    assert.equal(idleRun.dead, true);
    assert.equal(idleRun.reason, 'laser');
  }
});

test('nothing leaves the chunk with it: on every shift that clears it the cube exits with no shield and the beam broken', () => {
  const c = chunk('shieldLaser@0');
  for (const speed of allSpeeds()) {
    let cleared = 0;
    for (let w = -20; w <= 20; w++) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, 0);
      if (!cueBotClears(c, speed, w, { world, cube })) continue;
      cleared++;
      assert.equal(cube.shield, false, `${Math.round(speed)} px/s wobble ${w}: still holding a shield at the exit`);
      assert.ok(Object.keys(cube.broken).length === 1, 'the beam is the only thing broken');
      assert.equal(Object.keys(cube.picked).length, 1);
    }
    assert.ok(cleared >= 9, `${Math.round(speed)} px/s: only ${cleared} shifts clear it`);
  }
});

test('the closure proves the chunk with its neighbours at three speeds (a late arrival has no shield and is dead)', () => {
  const fam = new Set(['flat', 'spike1', 'spike3', 'shieldLaser', 'gap3', 'tunnel1', 'bounceUp']);
  for (const k of [0, 3, 6]) {
    const r = closure(L.levelSpeed(k), { filter: c => fam.has(c.name.split('@')[0]) });
    assert.equal(r.startOk, true, `level ${k}: ${(r.witness || []).join(' > ')}`);
  }
});

test('shieldLaser is clearable by the planner and by the pair tests at every level speed (it takes the pickup on the way)', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(chunk('shieldLaser@0'), L.levelSpeed(k)), `level ${k}`);
});
