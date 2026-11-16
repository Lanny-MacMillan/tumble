const test = require('node:test');
const assert = require('node:assert/strict');
const { L, buildWorld, pairClearable, botRun, plan, slicer } = require('./support.js');

// The fast suite checks the slowest speed (where landing room is tightest); `npm run test:full` repeats
// pairs and bots at every level speed, which includes the mid and max speeds.
const SPEEDS = [
  ['min', L.SPEED_MIN],
];

for (const [label, speed] of SPEEDS) {
  test(`every neighbouring chunk pair is clearable at ${label} speed`, () => {
    const failed = [];
    const take = slicer();
    for (const a of L.CHUNKS) {
      for (const b of L.CHUNKS) {
        if (a.exitH !== b.entryH || a.steadyLevel !== null || b.steadyLevel !== null) continue;
        if (take() && !pairClearable(a, b, speed)) failed.push(`${a.name} -> ${b.name}`);
      }
    }
    assert.deepEqual(failed, [], `pairs not clearable at speed ${Math.round(speed)}: ${failed.join('; ')}`);
  });
}

const CHUNKS_PER_WORLD = process.env.TUMBLE_LONG ? 1000 : 30;

function hardWorld(seed, chunks) {
  const w = L.createWorld(seed, null, c => c.steadyLevel !== null);
  while (w.count < chunks) L.extendWorld(w, w.endX + 1, 5000 * L.METER_PX);
  return w;
}

for (const [label, speed] of SPEEDS) {
  test(`a bot with human-ish timing survives seeded worlds at ${label} speed`, () => {
    const take = slicer();
    for (const seed of [21, 22, 23]) {
      if (!take()) continue;
      const world = hardWorld(seed, CHUNKS_PER_WORLD);
      const rng = L.mulberry32(seed * 7);
      const r = botRun(world, speed, 2, rng);
      assert.equal(r.ok, true, `seed ${seed} speed ${Math.round(speed)}: ${r.why} at x=${Math.round(r.x)} of ${Math.round(world.endX)}`);
    }
  });
}

// a chain the pair proofs missed: at level-6 speed a hops piece one tile too tight made this four-piece run unclearable
test('gapUp1, crumbleBridge, hops and stairsUp in a row are clearable at every level speed', () => {
  const names = ['gapUp1@0', 'crumbleBridge@1', 'hops@1', 'stairsUp@1'];
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const cs = names.map(n => L.CHUNKS.find(c => c.name === n));
    const w = buildWorld(cs);
    const cube = L.newCube(2 * L.TILE, 0);
    assert.notEqual(plan(cube, w, L.levelSpeed(k), w.endX - 8 * L.TILE, new Map()), null, `level ${k}`);
  }
});
