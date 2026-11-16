const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, trial, plan, chunkClearable } = require('./support.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const blockChunks = () => L.CHUNKS.filter(c => c.blocks.length);
const SPEEDS = [['min', L.SPEED_MIN], ['mid', (L.SPEED_MIN + L.SPEED_MAX) / 2], ['max', L.SPEED_MAX]];
const HOLDS = [1, 4, 8, 12, 16, 20, 24, 32, 44, 57, 80, 114];

test('there are block pieces at the heights they fit, in the tiers the plan gives them', () => {
  const names = blockChunks().map(c => c.name);
  for (let h = 0; h <= L.MAX_H; h++) {
    if (h + 1 <= L.MAX_H) for (const n of ['blockHop', 'blockSpike']) assert.ok(names.includes(`${n}@${h}`), `${n}@${h}`);
    if (h + 2 <= L.MAX_H) assert.ok(names.includes(`blockTower@${h}`), `blockTower@${h}`);
  }
  assert.ok(names.includes('blockStairsUp@0') && names.includes('blockStairsDown@3'));
  assert.equal(chunk('blockHop@0').diff, 0);
  assert.equal(chunk('blockTower@0').diff, 1);
  assert.equal(chunk('blockStairsUp@0').diff, 1);
  assert.equal(chunk('blockSpike@0').diff, 2);
});

test('no step is higher than a player can climb, and every first wall has a two-tile run-up', () => {
  for (const c of blockChunks()) {
    assert.ok(c.maxStep <= L.MAX_STEP_TILES, `${c.name}: step ${c.maxStep}`);
    const raised = c.blocks.filter(b => b.h > c.entryH);
    if (c.name.startsWith('blockStairsDown')) continue;       // stairs down start with a drop, which needs no run-up
    const first = Math.min(...raised.map(b => b.x0));
    assert.ok(first - L.PAD >= 2, `${c.name}: the first block starts only ${first - L.PAD} tiles past the entry pad`);
  }
});

test('blocks are drawn from their top down to the lowest ground of their chunk, and sit on real ground tops', () => {
  for (const c of blockChunks()) {
    const w = buildWorld([c]);
    assert.equal(w.blocks.length, c.blocks.length, c.name);
    for (const b of w.blocks) {
      assert.ok(b.bottom >= b.top, `${c.name}: block upside down`);
      assert.ok(w.solids.some(s => s.top === b.top && s.x0 <= b.x0 && s.x1 >= b.x1), `${c.name}: a block with no ground under its top`);
      assert.equal(b.bottom, L.FLOOR_Y - c.baseH * L.TILE);
    }
  }
});

test('a block is solid: its side kills, its top is a safe landing', () => {
  const c = chunk('blockHop@0');
  const world = buildWorld([c]);
  const block = world.blocks[0];
  // running straight into the side
  const cube = L.newCube(2 * L.TILE, 0);
  let dead = null;
  for (let i = 0; i < 600 && !dead; i++) dead = L.stepCube(cube, world, { pressed: false, held: false }, DT, L.SPEED_MIN).dead;
  assert.equal(dead, 'wall');
  // dropping onto the top from above lands and stays on it
  const top = L.newCube(0, 0);
  top.x = (block.x0 + block.x1) / 2 - L.CUBE / 2;
  top.y = block.top - L.CUBE - 40;
  top.onGround = false;
  let landed = false;
  for (let i = 0; i < 200; i++) landed = landed || L.stepCube(top, world, { pressed: false, held: false }, DT, 0).landed;
  assert.equal(landed, true);
  assert.equal(top.y + L.CUBE, block.top);
});

// the width, in ms, of the run of launch times for which the first jump (with this hold) still leads to a plan
function firstWindow(c, speed, hold) {
  const world = buildWorld([c]);
  const target = world.endX - 8 * L.TILE;
  const cube = L.newCube(2 * L.TILE, c.entryH);
  const last = idle(cube, world, speed, target).steps - 1;
  let best = 0, run = 0;
  for (let w = last; w >= Math.max(0, last - 160); w--) {
    const t = trial(cube, world, speed, w, hold, target);
    const ok = t.r === 'reach' || (t.r === 'land' && plan(t.cube, world, speed, target, new Map()) !== null);
    if (ok) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best * DT * 1000;
}

test('every block piece is clearable with a full hold at min, mid and max speed, and by a range of press lengths', () => {
  for (const name of ['blockHop@0', 'blockTower@0', 'blockSpike@0', 'blockStairsUp@0', 'blockStairsDown@3']) {
    const c = chunk(name);
    for (const [label, speed] of SPEEDS) {
      const good = HOLDS.filter(h => firstWindow(c, speed, h) >= 67);
      assert.ok(good.includes(114), `${name} at ${label}: a full hold has no 67 ms window`);
      assert.ok(good[good.length - 1] - good[0] >= 12, `${name} at ${label}: only holds ${good.join(',')} clear it, under 0.1 s of range`);
    }
  }
  // a single block can be hopped with a pure tap, too
  for (const [label, speed] of SPEEDS) assert.ok(firstWindow(chunk('blockHop@0'), speed, 1) >= 67, `blockHop tap at ${label}`);
});

test('block pieces are clearable at every level speed (the closure and the pair tests cover them in the large)', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    for (const c of blockChunks()) assert.ok(chunkClearable(c, L.levelSpeed(k)), `${c.name} at level ${k}`);
  }
});

test('the stairs are deep enough to land and jump again at every speed', () => {
  // at two or three tiles deep a step leaves no fair window at some speed
  for (const w of [2, 3]) {
    const bad = L.makeChunk('narrow', 1, 0, 3, { w: 2 + 3 * w, ground: [{ x0: 2, x1: 2 + w, h: 1 }, { x0: 2 + w, x1: 2 + 2 * w, h: 2 }, { x0: 2 + 2 * w, x1: 2 + 3 * w, h: 3 }] });
    const ok = [L.SPEED_MIN, L.levelSpeed(3), L.SPEED_MAX].every(s => chunkClearable(bad, s));
    assert.equal(ok, false, `stairs ${w} tiles deep would be clearable at every speed`);
  }
  const real = chunk('blockStairsUp@0');
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(real, L.levelSpeed(k)), `level ${k}`);
});
