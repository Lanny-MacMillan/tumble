const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, cueBotClears, chunkClearable } = require('./support.js');
const { closure } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const popChunks = () => L.CHUNKS.filter(c => c.needsPop);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

// press once at the gems' take-off point and hold for `hold` steps; returns how it ended
function hop(c, speed, hold, world, cube) {
  const w = world || buildWorld([c]);
  const q = cube || L.newCube(2 * L.TILE, c.entryH);
  const x0 = 8 * L.TILE + c.cue[0].at * L.TILE;   // buildWorld puts 8 lead tiles before the chunk
  let fired = -1, landedAt = null;
  for (let i = 0; i < 1500; i++) {
    const pressed = fired < 0 && q.x + L.CUBE / 2 >= x0;
    if (pressed) fired = i;
    const ev = step(q, w, fired >= 0 && i < fired + hold, pressed, speed);
    if (ev.landed && landedAt === null && fired >= 0) landedAt = q.x + L.CUBE / 2;
    if (ev.dead) return { dead: ev.dead, landedAt, cube: q, world: w };
    if (q.x >= w.endX - 8 * L.TILE) return { dead: null, landedAt, cube: q, world: w };
  }
  return { dead: 'timeout', landedAt, cube: q, world: w };
}

test('pop-up spikes exist for every level and height, tier 3, built for their own level speed, the gap growing with the level', () => {
  for (let h = 0; h <= L.MAX_H; h++) for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const c = chunk(`popSpikes${k}@${h}`);
    assert.ok(c, `popSpikes${k}@${h}`);
    assert.equal(c.diff, 3);
    assert.equal(c.steadyLevel, k);
    assert.equal(c.minLevel, 0);
    assert.equal(c.trap, true);
    assert.equal(c.pops.length, 1);
    assert.equal(c.cue.length, 1);
    assert.equal(c.maxGap, k + 3);
  }
});

test('the chunk holds a floor, a gap, the studs on the first tiles past it and the cue, and nothing else; a run-up before the trigger', () => {
  for (const c of popChunks()) {
    assert.equal(c.platforms.length + c.moving.length + c.crumble.length + c.ceilings.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length + c.flips.length + c.boxes.length + c.bounces.length + c.pickups.length + c.gates.length + c.vanish.length, 0, c.name);
    assert.equal(c.ground.length, 2);
    const z = c.pops[0];
    assert.equal(c.spikes.length, L.POP_SPIKES);
    assert.deepEqual(c.spikes.map(s => s.x), [z.x, z.x + 1]);
    assert.equal(z.x, c.ground[1].x0, `${c.name}: the studs start on the first tile past the gap`);
    assert.ok(z.x - L.POP_TRIGGER_TILES >= 2 + L.PAD, `${c.name}: trigger ${z.x - L.POP_TRIGGER_TILES} tiles in`);
    assert.ok(c.w - (z.x + z.w) >= 8, `${c.name}: a landing`);
  }
});

test('the studs stand up at least half a second ahead at the top speed with a boost, and are in view with the gems', () => {
  assert.ok((L.POP_TRIGGER_TILES * L.TILE) / (L.SPEED_MAX * L.BOOST_MUL) >= 0.5);
  for (const c of popChunks()) {
    const world = buildWorld([c]);
    const q = world.pops[0];
    assert.equal(q.x0 - q.trigger, L.POP_TRIGGER_TILES * L.TILE);
    assert.ok(q.trigger >= world.placed[0].x0 + 2 * L.TILE);
    assert.ok(world.guides.length >= 3);
    assert.ok(q.x0 - world.guides[0].x < L.VIEW_AHEAD_PX);
  }
});

test('the trap is real: a short hop at the gems\' take-off point dies, at every level, on the studs or in the gap', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const c = chunk(`popSpikes${k}@0`);
    const speed = L.levelSpeed(k);
    // the hop of about a fifth of a second that a player makes without the arc: it lands inside the trapped zone
    const plain = hop(c, speed, 20);
    const z = buildWorld([c]).pops[0];
    assert.equal(plain.dead, 'spike', `level ${k}: plain hop ended ${plain.dead}`);
    assert.ok(plain.landedAt === null || (plain.landedAt + L.CUBE / 2 > z.x0 && plain.landedAt - L.CUBE / 2 < z.x1), `level ${k}: landed at ${plain.landedAt}`);
    // every hold from a tap to about 0.22 s dies
    for (let hold = 1; hold <= 24; hold++) assert.ok(hop(c, speed, hold).dead, `level ${k} hold ${hold}`);
    // a walker falls in the gap
    const r = idle(L.newCube(2 * L.TILE, 0), buildWorld([c]), speed, buildWorld([c]).endX - 8 * L.TILE);
    assert.equal(r.dead, true);
  }
});

test('the cue clears it with a 67 ms window and lands outside the trapped zone; a held shield absorbs one stud', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) for (const h of [0, 3]) {
    const c = chunk(`popSpikes${k}@${h}`);
    const speed = L.levelSpeed(k);
    let best = 0, run = 0;
    for (let w = -60; w <= 60; w++) {
      if (cueBotClears(c, speed, w)) { run++; best = Math.max(best, run); } else run = 0;
    }
    assert.ok(best * DT >= 0.067, `${c.name}: cue window ${(best * DT * 1000).toFixed(0)} ms`);
    assert.ok(best < 121);
    const z = buildWorld([c]).pops[0];
    const flown = hop(c, speed, 114);
    assert.equal(flown.dead, null, c.name);
    assert.ok(flown.landedAt - L.CUBE / 2 >= z.x1, `${c.name}: the cue lands at ${flown.landedAt}, studs end at ${z.x1}`);
  }
  const c = chunk('popSpikes3@0');
  const world = buildWorld([c]);
  const cube = L.newCube(2 * L.TILE, 0);
  cube.shield = true;
  const r = hop(c, L.levelSpeed(3), 20, world, cube);
  assert.equal(r.dead, null);
  assert.equal(cube.shield, false);
});

test('where the state comes from: stepCube never reads the pop-up zone or a clock, so a run is identical with and without it', () => {
  const src = L.stepCube.toString();
  assert.ok(!/pops/.test(src));
  assert.ok(!/Date|performance|now\(/.test(src));
  const c = chunk('popSpikes2@0');
  const speed = L.levelSpeed(2);
  const a = buildWorld([c]), b = buildWorld([c]);
  b.pops = [];
  assert.equal(a.pops.length, 1);
  const rng = L.mulberry32(9);
  for (let run = 0; run < 20; run++) {
    const x = L.newCube(2 * L.TILE, 0), y = L.newCube(2 * L.TILE, 0);
    let held = false;
    for (let i = 0; i < 1500; i++) {
      const pressed = rng() < 0.03;
      if (pressed) held = true;
      if (held && rng() < 0.05) held = false;
      const ea = step(x, a, held, pressed, speed), eb = step(y, b, held, pressed, speed);
      assert.deepEqual(x, y);
      assert.deepEqual(ea, eb);
      if (ea.dead) break;
    }
  }
});

test('the planner clears it at its own speed, the closure proves it with neighbours, and it is pruned and generated like the others', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(chunk(`popSpikes${k}@0`), L.levelSpeed(k)), `level ${k}`);
  const fam = new Set(['flat', 'spike1', 'spike3', 'gap3', 'popSpikes0', 'popSpikes3', 'popSpikes6', 'vanish3', 'tunnel1', 'shieldDrop']);
  for (const k of [0, 3, 6]) {
    const r = closure(L.levelSpeed(k), { filter: c => fam.has(c.name.split('@')[0]) });
    assert.equal(r.startOk, true, `level ${k}: ${(r.witness || []).join(' > ')}`);
  }
  const seen = new Set();
  for (const seed of [91, 92, 93, 94, 95, 96, 97, 98, 99, 100]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    for (const p of world.placed) if (p.chunk.needsPop) seen.add(p.chunk.steadyLevel);
    const n = world.pops.length;
    L.pruneWorld(world, world.endX - 10 * L.TILE);
    assert.ok(world.pops.length <= n);
  }
  assert.ok(seen.size >= 5, `pop-up spikes seen at levels ${[...seen]}`);
});
