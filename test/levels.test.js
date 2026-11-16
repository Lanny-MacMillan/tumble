const test = require('node:test');
const assert = require('node:assert/strict');
const { L, chunkClearable, cueBotClears, slicer } = require('./support.js');

// every speed a player can be at: each level's speed, and several points on the way between levels
function levelSpeeds() {
  const out = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    out.push({ label: `level ${k}`, speed: L.levelSpeed(k) });
    if (k > 0) for (const f of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      const e = f * f * (3 - 2 * f);
      out.push({ label: `between ${k - 1} and ${k} at ${f}`, speed: L.levelSpeed(k - 1) + (L.levelSpeed(k) - L.levelSpeed(k - 1)) * e });
    }
  }
  return out;
}

test('every chunk is clearable at every level speed and at points between levels', () => {
  const failed = [];
  const take = slicer();
  for (const { label, speed } of levelSpeeds()) {
    for (const c of L.CHUNKS.filter(q => q.steadyLevel === null)) if (take() && !chunkClearable(c, speed)) failed.push(`${c.name} at ${label} (${Math.round(speed)} px/s)`);
  }
  assert.deepEqual(failed, [], `unclearable: ${failed.join('; ')}`);
});

test('the 3-hazard cap holds at every level speed, counting spikes and roofs', () => {
  for (const { label, speed } of levelSpeeds()) {
    const range = (speed * L.AIR_TIME_FULL) / L.TILE;
    for (const c of L.CHUNKS) {
      const items = c.spikes.map(s => s.x).concat(c.ceilings.map(r => r.x0), c.boxes.map(b => b.x), c.bounces.map(b => b.x), c.gates.map(g => g.x)).sort((a, b) => a - b);
      for (let i = 0; i < items.length; i++) {
        const inReach = items.filter(x => x >= items[i] && x + 1 - items[i] <= range).length;
        assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name} at ${label}: ${inReach} hazards in one jump`);
      }
    }
  }
});

test('tunnels stay fair at every level speed: a tap clears, the cued press clears with wobble, a long hold hits the roof', () => {
  for (const { label, speed } of levelSpeeds()) {
    for (const c of L.CHUNKS.filter(t => t.tunnel && (t.entryH === 0 || t.entryH === 3))) {
      for (const wobble of [-2, 0, 2]) assert.equal(cueBotClears(c, speed, wobble), true, `${c.name} at ${label}, wobble ${wobble}`);
      const tap = Object.assign({}, c, { cue: c.cue.map(q => ({ spike: q.spike, hold: 1 })) });
      assert.equal(cueBotClears(tap, speed, 0), true, `${c.name} at ${label}: a tap at the ring`);
      const long = Object.assign({}, c, { cue: c.cue.map(q => ({ spike: q.spike, hold: 57 })) });
      assert.equal(cueBotClears(long, speed, 0), false, `${c.name} at ${label}: a full hold should die`);
    }
  }
});

test('the cue ring moves with speed: the press point is always about 0.15 s before the stud', () => {
  const c = L.CHUNKS.find(q => q.name === 'tunnel1@0');
  for (const { speed } of levelSpeeds()) {
    const startTile = L.cueStartTile(c.cue[0], speed);
    const seconds = ((c.cue[0].spike - startTile) * L.TILE) / speed;
    assert.ok(Math.abs(seconds - L.CUE_LEAD_S) < 1e-9);
  }
  const slow = L.createWorld(1), fast = L.createWorld(1);
  void slow; void fast;
});

// A level boundary can fall anywhere, including inside a tunnel or on a moving platform. The speed then
// eases from the old level's speed to the new one while the cube is in the chunk.
function speedAcrossBoundary(k, chunkStartX, tilesIn) {
  const boundaryX = chunkStartX + tilesIn * L.TILE;
  return x => L.speedAt(L.LEVEL_STARTS_M[k] * L.METER_PX + (x - boundaryX));
}
const LEAD_X = 8 * L.TILE;

test('every chunk is clearable when a level boundary falls inside it, at several points along the chunk', () => {
  const failed = [];
  const take = slicer();
  for (let k = 1; k <= L.LAST_LEVEL; k++) {
    for (const c of L.CHUNKS.filter(q => !q.needsOrb && q.steadyLevel === null)) {
      for (const at of [1, Math.floor(c.w / 2), c.w - 1]) {
        if (take() && !chunkClearable(c, speedAcrossBoundary(k, LEAD_X, at))) failed.push(`${c.name}: level ${k} starts ${at} tiles in`);
      }
    }
  }
  assert.deepEqual(failed, [], `unclearable: ${failed.slice(0, 12).join('; ')}`);
});

test('tunnels stay fair with a level boundary inside them: the ring placed for the chunk start still works', () => {
  for (let k = 1; k <= L.LAST_LEVEL; k++) {
    for (const c of L.CHUNKS.filter(t => t.tunnel && t.entryH === 0)) {
      for (const at of [1, 3, 5, 7, 9, 11, c.w - 1]) {
        if (at >= c.w) continue;
        const sp = speedAcrossBoundary(k, LEAD_X, at);
        for (const wobble of [-2, 0, 2]) assert.equal(cueBotClears(c, sp, wobble), true, `${c.name}: level ${k} at ${at} tiles in, wobble ${wobble}`);
      }
    }
  }
});
