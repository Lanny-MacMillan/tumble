const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, chunkClearable } = require('./support.js');

const flipChunks = () => L.CHUNKS.filter(c => c.flips.length);

test('there is a flip piece at every height, a tier-1 piece open from level 0', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = L.CHUNKS.find(q => q.name === `flipPad@${h}`);
    assert.ok(c, `flipPad@${h}`);
    assert.equal(c.diff, 1);
    assert.equal(c.minLevel, 0);
  }
});

test('a flip piece is flat and empty: 3 flat tiles before the portal, 8 after, no hazard within 8 either way', () => {
  for (const c of flipChunks()) {
    assert.equal(c.entryH, c.exitH);
    assert.equal(c.ground.length, 1, `${c.name}: one flat run`);
    const q = c.flips[0];
    assert.ok(q.x >= 3, `${c.name}: 3 flat tiles before`);
    assert.ok(c.w - q.x >= 8, `${c.name}: 8 flat tiles after`);
    assert.equal(c.spikes.length + c.platforms.length + c.moving.length + c.crumble.length + c.ceilings.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length, 0);
  }
  // and in the pieces around it: every chunk keeps its hazards 3 tiles from both ends, so the next hazard is 8+ tiles away
  for (const c of L.CHUNKS) for (const s of c.spikes) assert.ok(s.x >= L.PAD && s.x < c.w - L.PAD);
});

test('flipped or not is a function of x and the portals passed, and the portals count once each', () => {
  const w = L.createEmptyWorld();
  w.flips = [{ x: 1000 }, { x: 3000 }, { x: 5000 }];
  const seen = [0, 999, 1000, 2999, 3000, 4999, 5000, 9000].map(x => L.flipAt(w, x));
  assert.deepEqual(seen, [false, false, true, true, false, false, true, true]);
  // asking again, in any order, gives the same answer
  assert.equal(L.flipAt(w, 4000), false);
  assert.equal(L.flipAt(w, 2000), true);
});

test('a portal that has been pruned away still counts', () => {
  const world = L.createWorld(5);
  while (world.count < 400) L.extendWorld(world, world.endX + 1, 5000 * L.METER_PX);
  const all = world.flips.map(q => q.x);
  assert.ok(all.length >= 3, `only ${all.length} flip portals in 400 chunks`);
  const parityAt = x => all.filter(q => q <= x).length % 2 === 1;
  const mid = all[1] + 30 * L.TILE;
  L.pruneWorld(world, mid - 20 * L.TILE);
  assert.ok(world.flips.length < all.length, 'something was pruned');
  for (const x of [mid, all[2] + 5, all[all.length - 1] + 50]) assert.equal(L.flipAt(world, x), parityAt(x), `at ${x}`);
});

test('the game says "flip" once per portal passed, and a restart starts upright', () => {
  const c = L.CHUNKS.find(q => q.name === 'flipPad@0');
  const g = L.newGame(3, true, 0, [c]);
  let flips = 0;
  const start = g.cube.x;
  let passed = 0;
  for (let i = 0; i < 6000 && g.state === 'running' && passed < 3; i++) {
    flips += L.stepGame(g, { pressed: false, held: false }, DT).filter(e => e === 'flip').length;
    passed = g.world.flips.filter(q => q.x <= g.cube.x + L.CUBE / 2).length + (g.world.flipParity ? 0 : 0);
  }
  assert.ok(flips >= 3, `${flips} flips`);
  assert.ok(start > 0);
  const again = L.newGame(4, true, 0, [c]);
  assert.equal(L.flipAt(again.world, again.cube.x + L.CUBE / 2), false);
});

test('no flip input exists: a scripted run is bit-for-bit the same with and without flip portals', () => {
  // the same ground and hazards; the flip pieces differ only by carrying a portal
  const names = ['flipPad@0', 'spike1@0', 'hops@0', 'flipPad@0', 'spikesApart@0'];
  const withFlips = buildWorld(names.map(n => L.CHUNKS.find(c => c.name === n)));
  const without = buildWorld(names.map(n => L.CHUNKS.find(c => c.name === n)));
  without.flips = [];
  assert.equal(withFlips.flips.length, 2);
  assert.equal(without.flips.length, 0);
  const rng = L.mulberry32(77);
  for (const speed of [L.SPEED_MIN, L.levelSpeed(3), L.SPEED_MAX]) {
    const a = L.newCube(2 * L.TILE, 0), b = L.newCube(2 * L.TILE, 0);
    let held = false;
    for (let i = 0; i < 2500; i++) {
      const pressed = rng() < 0.02;
      if (pressed) held = true;
      if (held && rng() < 0.05) held = false;
      const ea = L.stepCube(a, withFlips, { pressed, held }, DT, speed);
      const eb = L.stepCube(b, without, { pressed, held }, DT, speed);
      assert.deepEqual(a, b, `cube states differ at step ${i}`);
      assert.deepEqual(ea, eb);
    }
    assert.ok(a.x > withFlips.flips[1].x, 'the run went past both portals');
  }
});

test('flip pieces are clearable at every height and speed (they are flat, so this must hold)', () => {
  for (const c of flipChunks()) for (const speed of [L.SPEED_MIN, L.levelSpeed(3), L.SPEED_MAX]) assert.ok(chunkClearable(c, speed), `${c.name} at ${Math.round(speed)}`);
});

test('flip portals are kept apart in generated worlds, across seeds', () => {
  let total = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = L.createWorld(seed);
    const xs = [];
    const orig = w.flips;
    while (w.count < 500) {
      L.extendWorld(w, w.endX + 1, 5000 * L.METER_PX);
      for (const q of w.flips) if (!xs.includes(q.x)) xs.push(q.x);
    }
    void orig;
    xs.sort((a, b) => a - b);
    total += xs.length;
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= L.FLIP_MIN_GAP_TILES * L.TILE, `seed ${seed}: portals ${(xs[i] - xs[i - 1]) / L.TILE} tiles apart`);
  }
  assert.ok(total > 10, `only ${total} flip portals`);
});
