// A sampled check of the opposite direction from the chain closure: a player who only sees what fits on the narrowest
// supported screen (VIEW_AHEAD_PX, 39 tiles) and plans no further, following every cue, on seeded worlds.
// A pass is evidence, not a proof; a failure is a finding to redesign.
const test = require('node:test');
const assert = require('node:assert/strict');
const { L, hybridRun } = require('../support.js');

const HORIZON_TILES = Math.floor(L.VIEW_AHEAD_PX / L.TILE);
const SEEDS = [301, 302, 303, 304];

for (let k = 0; k <= L.LAST_LEVEL; k++) {
  test(`a player who sees ${HORIZON_TILES} tiles ahead and follows every cue clears seeded worlds at level ${k} speed`, () => {
    for (const seed of SEEDS) {
      const world = L.createWorld(seed * 7 + k, null, null, k);
      while (world.count < 60) L.extendWorld(world, world.endX + 1 - L.TILE * 70, 5000 * L.METER_PX);
      const r = hybridRun(world, L.levelSpeed(k), L.mulberry32(seed + k), 2, HORIZON_TILES);
      assert.equal(r.ok, true, `seed ${seed} level ${k}: ${r.why} at x=${Math.round(r.x)} (tile ${Math.round(r.x / L.TILE)})`);
    }
  });
}
