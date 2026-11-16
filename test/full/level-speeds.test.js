// Slow checks over every level speed. Run with: npm run test:full
const test = require('node:test');
const assert = require('node:assert/strict');
const { L, pairClearable, botRun, hybridRun } = require('../support.js');

const speeds = [];
for (let k = 0; k <= L.LAST_LEVEL; k++) speeds.push([`level ${k}`, L.levelSpeed(k)]);

for (const [label, speed] of speeds) {
  test(`every neighbouring chunk pair is clearable at ${label} speed (${Math.round(speed)} px/s)`, () => {
    const failed = [];
    for (const a of L.CHUNKS) for (const b of L.CHUNKS) {
      if (a.exitH !== b.entryH || a.steadyLevel !== null || b.steadyLevel !== null) continue;
      if (!pairClearable(a, b, speed)) failed.push(`${a.name} -> ${b.name}`);
    }
    assert.deepEqual(failed, [], `pairs not clearable: ${failed.join('; ')}`);
  });

  test(`a bot with human-ish timing survives seeded worlds at ${label} speed`, () => {
    for (const seed of [41, 42]) {
      const world = L.createWorld(seed, null, c => c.steadyLevel !== null);
      while (world.count < 60) L.extendWorld(world, world.endX + 1, 5000 * L.METER_PX);
      const r = botRun(world, speed, 2, L.mulberry32(seed * 3));
      assert.equal(r.ok, true, `seed ${seed} at ${label}: ${r.why} at x=${Math.round(r.x)}`);
    }
  });
}

// Following every cue (tunnels and orb gaps by cue, the rest by planning) must clear whole generated worlds.
for (let k = 0; k <= L.LAST_LEVEL; k++) {
  test(`a cue-following player clears generated worlds at level ${k} speed, orb gaps and boost runs included`, () => {
    for (const seed of [91, 92]) {
      const world = L.createWorld(seed * k, null, null, k);
      while (world.count < 50 || (!world.placed.some(p => p.chunk.needsOrb) && world.count < 800)) L.extendWorld(world, world.endX + 1 - L.TILE * 70, 5000 * L.METER_PX);
      assert.ok(world.placed.some(p => p.chunk.needsOrb), `seed ${seed} level ${k}: no orb gap`);
      // re-plan just before each jump, with the long 56-tile view: a plan made a whole screen ahead can end right in front of a hazard it never saw
      const r = hybridRun(world, L.levelSpeed(k), L.mulberry32(seed + k), 2, 56);
      assert.equal(r.ok, true, `seed ${seed} level ${k}: ${r.why} at x=${Math.round(r.x)}`);
    }
  });
}
