const test = require('node:test');
const assert = require('node:assert/strict');
const { L, buildWorld, plan } = require('./support.js');
const { closure, included, EXCLUDED } = require('./closure/closure.js');

// The full proof is `npm run test:chains` (minutes). This is the partial version for the fast suite: one speed, a
// small family of pieces. It proves nothing about the rest of the chunk set.

const FAMILY = new Set(['flat', 'spike1', 'spike3', 'spikesApart', 'hops', 'bump', 'up1', 'down1', 'plateauSpike', 'stairsUp', 'gapUp1', 'crumbleBridge']);

test('closure (partial): the small family has no dead sequence at the top speed', () => {
  const r = closure(L.levelSpeed(L.LAST_LEVEL), { filter: c => FAMILY.has(c.name.split('@')[0]) });
  assert.equal(r.startOk, true, `dead sequence: ${(r.witness || []).join(' > ')}`);
  assert.ok(r.vectors > 10);
});

test('closure: a chain the pair proofs missed is found dead (pieces as they were), and the planner agrees', () => {
  // before the run-ups: a step-up wall, a bump and a plateau spike right at the end of the 3-tile pad, in a row
  const old = [
    L.makeChunk('flat@0', 0, 0, 0, { w: 2, ground: [{ x0: 0, x1: 2, h: 0 }] }),
    L.makeChunk('spike1@0', 0, 0, 0, { w: 3, ground: [{ x0: 0, x1: 3, h: 0 }], spikes: [{ x: 1, h: 0 }] }),
    L.makeChunk('plateauSpikeOld@0', 2, 0, 1, { w: 4, ground: [{ x0: 0, x1: 4, h: 1 }], spikes: [{ x: 2, h: 1 }] }),
    L.makeChunk('bumpOld@1', 0, 1, 1, { w: 2, ground: [{ x0: 0, x1: 2, h: 2 }] }),
    L.makeChunk('plateauSpikeOld@1', 2, 1, 2, { w: 4, ground: [{ x0: 0, x1: 4, h: 2 }], spikes: [{ x: 2, h: 2 }] }),
    L.makeChunk('flat@2', 0, 2, 2, { w: 2, ground: [{ x0: 0, x1: 2, h: 2 }] }),
  ];
  const next = { 'flat@0': ['spike1@0'], 'spike1@0': ['plateauSpikeOld@0'], 'plateauSpikeOld@0': ['bumpOld@1'], 'bumpOld@1': ['plateauSpikeOld@1'], 'plateauSpikeOld@1': ['flat@2'], 'flat@2': ['flat@2'] };
  const speed = L.levelSpeed(L.LAST_LEVEL);
  const r = closure(speed, { list: old, succ: n => next[n] });
  assert.equal(r.startOk, false, 'the closure should find the dead chain');
  const world = buildWorld(old.slice(1, 6));
  assert.equal(plan(L.newCube(2 * L.TILE, 0), world, speed, world.endX - 8 * L.TILE, new Map()), null, 'the planner agrees there is no plan');
});

test('closure: every chunk keeps its own state inside itself (nothing is carried across a boundary)', () => {
  const spans = (c, x0, x1, what) => assert.ok(x0 >= L.PAD && x1 <= c.w - L.PAD, `${c.name}: ${what} reaches into the padding`);
  for (const c of L.CHUNKS) {
    for (const q of c.crumble) spans(c, q.x, q.x + q.w, 'crumble');
    for (const f of c.fields) spans(c, f.x0, f.x1, 'field');
    for (const q of c.warps) spans(c, q.a, q.b, 'warp');
    for (const q of c.walls) spans(c, q.x, q.x + q.w, 'wall');
    for (const q of c.spikes) spans(c, q.x, q.x + 1, 'spike');
    for (const q of c.orbs) spans(c, q.x - 1, q.x + 1, 'orb');
    for (const q of c.moving) spans(c, q.x, q.x + q.w, 'moving platform');
    for (const q of c.boxes) spans(c, q.x, q.x + q.w, 'floating block');
    for (const q of c.bounces) spans(c, q.x, q.x + q.w, 'bounce pad');
    for (const q of c.pickups) spans(c, q.x, q.x + 1, 'pickup');
    for (const q of c.gates) spans(c, q.x, q.x + q.w, 'gate');
    for (const q of c.ceilings) assert.ok(q.x0 >= L.PAD && q.x1 <= c.w, `${c.name}: roof outside the chunk`);
  }
});

test('closure: a boost always ends inside its own chunk, and a mover, orb or field never straddles a boundary', () => {
  for (const c of L.CHUNKS.filter(q => q.pads.length)) {
    const world = buildWorld([c]);
    const cube = L.newCube(2 * L.TILE, c.entryH);
    for (let i = 0; i < 4000 && cube.x < world.endX - 8 * L.TILE + 1; i++) {
      L.stepCube(cube, world, { pressed: false, held: false }, 1 / 120, L.SPEED_MIN * L.boostMul(cube));
      if (cube.x >= 8 * L.TILE + c.w * L.TILE) break;
    }
    // idling over a pad then reaching the chunk's end leaves no boost running
    if (cube.x >= 8 * L.TILE + c.w * L.TILE) assert.ok(cube.boostX0 === null, `${c.name}: boost still running at the exit`);
  }
});

test('closure: steady chunks are in the set only at their own level speed', () => {
  const { steadyOk } = require('./closure/closure.js');
  const orb = L.CHUNKS.find(c => c.name === 'orbGap2@0');
  assert.equal(steadyOk(orb, L.levelSpeed(2)), true);
  assert.equal(steadyOk(orb, L.levelSpeed(3)), false);
  assert.equal(steadyOk(orb, (L.levelSpeed(1) + L.levelSpeed(2)) / 2), false);
  assert.equal(steadyOk(L.CHUNKS.find(c => c.name === 'flat@0'), L.levelSpeed(5)), true);
});
