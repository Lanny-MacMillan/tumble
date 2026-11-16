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

test('shieldDrop exists at every height in tier 3, the pickup DROP_PICKUP_DIST_TILES before the block', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`shieldDrop@${h}`);
    assert.ok(c, `shieldDrop@${h}`);
    assert.equal(c.diff, 3);
    assert.equal(c.pickups.length, 1);
    assert.equal(c.gates.length, 1);
    assert.equal(c.gates[0].kind, 'drop');
    assert.equal(c.gates[0].x - c.pickups[0].x, L.DROP_PICKUP_DIST_TILES);
    assert.equal(c.pickups[0].h - h, L.GATE_PICKUP_H);
    assert.equal(c.gates[0].w, L.DROP_W_TILES);
  }
  assert.equal(L.DROP_PICKUP_DIST_TILES, 20);
});

test('the block has landed before the cube can reach it, at every speed and even boosted at the top speed', () => {
  const c = chunk('shieldDrop@0');
  const fallTime = Math.sqrt((2 * L.DROP_HANG_TILES * L.TILE) / L.DROP_G);
  assert.ok((L.DROP_TRIGGER_TILES * L.TILE) / (L.SPEED_MAX * L.BOOST_MUL) > fallTime + 0.02, 'trigger distance by formula');
  for (const speed of allSpeeds().concat([L.SPEED_MAX * L.BOOST_MUL])) {
    const world = buildWorld([c]);
    const q = world.gates[0];
    const cube = L.newCube(2 * L.TILE, 0);
    let arrivedLanded = null;
    for (let i = 0; i < 3000 && arrivedLanded === null; i++) {
      const ev = step(cube, world, false, false, speed);
      if (cube.x + L.CUBE - L.CUBE_INSET > q.x0) arrivedLanded = L.dropTop(q, cube) + q.h >= q.y - 0.01;
      if (ev.dead) break;
    }
    assert.equal(arrivedLanded, true, `${Math.round(speed)} px/s: the block was still falling when the cube got there`);
  }
});

test('the whole block is broken by one shield: a shielded cube walks through all nine tiles at every speed, with no help from the safe spell', () => {
  const c = chunk('shieldDrop@0');
  // at the slowest speed the cube is inside the block for longer than the safe spell lasts, so the broken flag is doing the work
  assert.ok((L.DROP_W_TILES * L.TILE) / L.SPEED_MIN > L.SHIELD_INV_S, 'the block is wider than the safe spell');
  for (const speed of allSpeeds()) {
    const world = buildWorld([c]);
    const q = world.gates[0];
    const cube = L.newCube(2 * L.TILE, 0);
    cube.shield = true;
    let dead = null, shields = 0;
    for (let i = 0; i < 3000 && cube.x < q.x1 + 3 * L.TILE && !dead; i++) {
      const ev = step(cube, world, false, false, speed);
      dead = ev.dead;
      if (ev.shield) shields++;
    }
    assert.equal(dead, null, `${Math.round(speed)} px/s: ${dead}`);
    assert.equal(shields, 1);
    assert.ok(cube.x > q.x1, 'got all the way through');
    assert.equal(cube.shield, false);
    assert.ok(cube.broken[q.id]);
  }
});

test('without a shield the block kills, and no jump of any length or timing clears it', () => {
  const c = chunk('shieldDrop@0');
  for (const speed of allSpeeds()) {
    const world = buildWorld([c]);
    const run = L.newCube(2 * L.TILE, 0);
    let dead = null;
    for (let i = 0; i < 3000 && !dead; i++) dead = step(run, world, false, false, speed).dead;
    assert.equal(dead, 'drop', `${Math.round(speed)} px/s`);
  }
  // jumps: launched at every point on the way up to the block, with a range of holds, at the top speed
  const world = buildWorld([c]);
  const q = world.gates[0];
  for (const hold of [1, 20, 57, 114]) for (let dx = 12; dx >= -1; dx -= 0.5) {
    const cube = L.newCube(2 * L.TILE, 0);
    cube.x = q.x0 - dx * L.TILE;
    let dead = null;
    for (let i = 0; i < 300 && !dead && cube.x < q.x1 + 3 * L.TILE; i++) dead = step(cube, world, i < hold, i === 0, L.SPEED_MAX).dead;
    assert.equal(dead, 'drop', `hold ${hold} from ${dx} tiles before the block`);
  }
});

test('nothing sits between the pickup and the block, or near them: the shield can only be lost to a terrain death', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`shieldDrop@${h}`);
    assert.equal(c.spikes.length + c.ceilings.length + c.moving.length + c.crumble.length + c.boxes.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length + c.bounces.length + c.platforms.length + c.flips.length, 0, c.name);
    assert.equal(c.ground.length, 1);
    assert.equal(c.maxGap, 0);
    assert.ok(c.w - (c.gates[0].x + c.gates[0].w) >= 10, `${c.name}: a long landing`);
  }
});

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
  const c = chunk('shieldDrop@0');
  for (const [label, speed] of SPEEDS) {
    const world = buildWorld([c]);
    const walker = L.newCube(2 * L.TILE, 0);
    let walked = 0;
    for (let i = 0; i < 600 && !walked; i++) { const ev = step(walker, world, false, false, speed); if (ev.pickup) walked++; if (ev.dead) break; }
    assert.equal(walked, 0, `${label}: a walker took the pickup`);
    for (const hold of HOLDS) assert.ok(pickupWindow(c, speed, hold) >= 67, `${label} hold ${hold}`);
  }
});

test('the block and the pickup are in view together and at least 1.5 s ahead at max speed', () => {
  assert.ok(L.CUE_WARN_AT_MAX_S >= 1.5);
  const c = chunk('shieldDrop@0');
  const world = buildWorld([c]);
  const q = world.gates[0];
  // hanging, it is in the sky and nowhere near the cube's path, so it cannot be mistaken for terrain
  assert.ok(q.hangTop + q.h < q.y - L.JUMP_PEAK - L.CUBE, 'hangs clear above the top of the highest plain jump, so jumping under it before it falls is safe');
  assert.ok((c.gates[0].x - c.pickups[0].x) * L.TILE <= L.VIEW_AHEAD_PX);
});

test('following the gems clears it at every speed, with a 67 ms window of timing; ignoring them dies; nothing leaves with the cube', () => {
  const c = chunk('shieldDrop@0');
  for (const speed of allSpeeds()) {
    let best = 0, run = 0, cleared = 0;
    for (let w = -20; w <= 20; w++) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, 0);
      if (cueBotClears(c, speed, w, { world, cube })) {
        run++; best = Math.max(best, run); cleared++;
        assert.equal(cube.shield, false, `${Math.round(speed)} px/s wobble ${w}: a shield left the chunk`);
        assert.equal(Object.keys(cube.broken).length, 1);
        assert.equal(Object.keys(cube.picked).length, 1);
      } else run = 0;
    }
    assert.ok(best * DT >= 0.067, `${Math.round(speed)} px/s: cue window only ${(best * DT * 1000).toFixed(0)} ms`);
    assert.ok(cleared >= 9);
    const world = buildWorld([c]);
    const r = idle(L.newCube(2 * L.TILE, 0), world, speed, world.endX - 8 * L.TILE);
    assert.equal(r.dead, true);
    assert.equal(r.reason, 'drop');
  }
});

test('drop state is part of the cube: clones keep it apart, and the planner key can tell a falling block from a hanging one', () => {
  const a = L.newCube(100, 0);
  a.dropAt.x = 1;
  const b = L.cloneCube(a);
  b.dropAt.y = 2;
  assert.deepEqual(Object.keys(a.dropAt), ['x']);
  // before the trigger the block is hanging in the cube's own state
  const world = buildWorld([chunk('shieldDrop@0')]);
  const q = world.gates[0];
  const cube = L.newCube(2 * L.TILE, 0);
  assert.equal(L.dropTop(q, cube), q.hangTop);
  cube.dropAt[q.id] = cube.t;
  cube.t += 0.1;
  assert.ok(L.dropTop(q, cube) > q.hangTop);
  cube.t += 5;
  assert.equal(L.dropTop(q, cube), q.hangTop + q.fall);
});

test('the closure proves it with neighbours at three speeds, and the planner and pair tests clear it at every level speed', () => {
  const fam = new Set(['flat', 'spike1', 'spike3', 'shieldLaser', 'shieldDrop', 'gap3', 'tunnel1', 'bounceUp']);
  for (const k of [0, 3, 6]) {
    const r = closure(L.levelSpeed(k), { filter: c => fam.has(c.name.split('@')[0]) });
    assert.equal(r.startOk, true, `level ${k}: ${(r.witness || []).join(' > ')}`);
  }
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(chunk('shieldDrop@0'), L.levelSpeed(k)), `level ${k}`);
});
