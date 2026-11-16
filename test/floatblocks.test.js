const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, trial, plan, chunkClearable } = require('./support.js');
const { runsOf } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const boxChunks = () => L.CHUNKS.filter(c => c.boxes.length);
const SPEEDS = [['min', L.SPEED_MIN], ['mid', (L.SPEED_MIN + L.SPEED_MAX) / 2], ['max', L.SPEED_MAX]];
const HOLDS = [1, 4, 8, 12, 16, 20, 24, 32, 44, 57, 80, 114];
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

test('floating blocks exist where they fit, in the tiers the plan gives them', () => {
  for (let h = 0; h <= L.MAX_H; h++) assert.ok(chunk(`floatBlock@${h}`), `floatBlock@${h}`);
  for (let h = 0; h + 2 <= L.MAX_H; h++) assert.ok(chunk(`blockBridge@${h}`), `blockBridge@${h}`);
  assert.equal(chunk('floatBlock@0').diff, 1);
  assert.equal(chunk('blockBridge@0').diff, 2);
});

test('one clearance for blocks and tunnels: a hung block sits exactly MIN_TUNNEL_CLEAR above the ground, and no roof is lower', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`floatBlock@${h}`);
    assert.equal(c.boxes[0].bottom - h, L.MIN_TUNNEL_CLEAR, c.name);
  }
  for (const c of L.CHUNKS.filter(q => q.ceilings.length)) for (const r of c.ceilings) assert.ok(r.clear >= L.MIN_TUNNEL_CLEAR, `${c.name}: roof clearance ${r.clear}`);
});

test('a floating block lands you from above and is solid on every other side', () => {
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 400, 0);
  const top = L.FLOOR_Y - 3 * L.TILE, bottom = L.FLOOR_Y - 2 * L.TILE;
  world.boxes.push({ x0: 500, x1: 600, top, bottom });
  // dropping onto the top lands and stands
  const above = L.newCube(0, 0);
  above.x = 520; above.y = top - L.CUBE - 30; above.onGround = false;
  let landed = false;
  for (let i = 0; i < 200; i++) landed = landed || step(above, world, false, false, 0).landed;
  assert.ok(landed);
  assert.equal(above.y + L.CUBE, top);
  // running into the side while up there kills as a wall
  const side = L.newCube(0, 0);
  side.x = 440; side.y = top - L.CUBE + 20; side.onGround = false; side.vy = 0;
  let dead = null;
  for (let i = 0; i < 100 && !dead; i++) dead = step(side, world, false, false, 300).dead;
  assert.equal(dead, 'wall');
  // jumping into the underside kills as a ceiling
  const below = L.newCube(0, 0);
  below.x = 520; below.y = L.FLOOR_Y - L.CUBE; below.vy = -L.JUMP_V * 1.6; below.onGround = false;
  dead = null;
  for (let i = 0; i < 100 && !dead; i++) dead = step(below, world, true, false, 0).dead;
  assert.equal(dead, 'ceiling');
  // running underneath is fine
  const under = L.newCube(0, 0);
  under.x = 300;
  dead = null;
  for (let i = 0; i < 500 && !dead; i++) dead = step(under, world, false, false, 300).dead;
  assert.equal(dead, null);
});

test('floatBlock is optional: running straight under it without jumping is safe at every speed, and a full jump under it is not', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`floatBlock@${h}`);
    for (const [label, speed] of SPEEDS) {
      const world = buildWorld([c]);
      const target = world.endX - 8 * L.TILE;
      assert.equal(idle(L.newCube(2 * L.TILE, h), world, speed, target).dead, false, `${c.name} at ${label}: idling dies`);
      // a full-hold jump taken in front of or under the block hits its underside, for some launch points
      const x0 = 8 * L.TILE + c.boxes[0].x * L.TILE;
      let hit = 0;
      for (let dx = -6 * L.TILE; dx <= L.TILE; dx += L.TILE / 4) {
        const cube = L.newCube(2 * L.TILE, h);
        cube.x = x0 + dx;
        let dead = null;
        for (let i = 0; i < 100 && !dead; i++) dead = step(cube, world, true, i === 0, speed).dead;
        if (dead === 'ceiling') hit++;
      }
      assert.ok(hit >= 2, `${c.name} at ${label}: a full jump hit the underside from only ${hit} launch points`);
    }
  }
});

test('nothing sits under or near a floating block where a player would have to jump: no hazard, gap, pad, orb, roof or field', () => {
  for (const c of boxChunks()) {
    const hung = c.boxes.filter(b => b.bottom - Math.max(c.entryH, c.exitH) >= L.MIN_TUNNEL_CLEAR);
    if (!hung.length) continue;
    assert.equal(c.maxGap, 0, `${c.name}: a gap near a hung block`);
    assert.equal(c.spikes.length + c.pads.length + c.orbs.length + c.crumble.length + c.moving.length + c.fields.length + c.ceilings.length + c.platforms.length + c.warps.length, 0, `${c.name}: something to jump near a hung block`);
    // the chunk after it can start its own hazards 3 tiles in, which is at least 6 tiles after the block ends
    const end = Math.max(...hung.map(b => b.x + b.w));
    assert.ok(c.w - end >= 6, `${c.name}: only ${c.w - end} tiles after the block`);
  }
});

test('hung blocks count in the 3-hazard cap lists (boxes with their start as a hazard)', () => {
  for (const c of boxChunks()) {
    const items = c.spikes.map(s => s.x).concat(c.ceilings.map(r => r.x0), c.boxes.map(b => b.x)).sort((a, b) => a - b);
    for (let i = 0; i < items.length; i++) {
      const inReach = items.filter(x => x >= items[i] && x + 1 - items[i] <= L.JUMP_RANGE_MAX_TILES).length;
      assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name}: ${inReach} in one jump`);
    }
  }
});

test('blockBridge: stepping stones are landable, and the blocks are what makes the gap crossable at slow speed', () => {
  const c = chunk('blockBridge@0');
  const world = buildWorld([c]);
  assert.equal(world.boxes.length, 2);
  // at the slowest speed a single full jump cannot clear the whole gap, so the blocks are needed
  const gapTiles = c.w - 2 * L.PAD;
  assert.ok((L.SPEED_MIN * L.AIR_TIME_FULL) / L.TILE < gapTiles, 'a plain jump should fall short at min speed');
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(c, L.levelSpeed(k)), `blockBridge@0 at level ${k}`);
  // every block gives the closure a run to stand on
  assert.ok(runsOf(c, L.SPEED_MIN).length >= 4, 'runs: entry, two blocks, exit');
});

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

test('blockBridge has a 67 ms window for a range of press lengths at min, mid and max speed', () => {
  const c = chunk('blockBridge@0');
  for (const [label, speed] of SPEEDS) {
    const good = HOLDS.filter(h => firstWindow(c, speed, h) >= 67);
    assert.ok(good.length >= 2 && good[good.length - 1] - good[0] >= 12, `${label}: holds ${good.join(',')}`);
  }
});
