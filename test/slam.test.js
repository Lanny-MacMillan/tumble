const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, chunkClearable } = require('./support.js');
const { closure } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const slamChunks = () => L.CHUNKS.filter(c => c.slams.length);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);
const allSpeeds = () => {
  const out = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) { out.push(L.levelSpeed(k)); if (k) out.push((L.levelSpeed(k) + L.levelSpeed(k - 1)) / 2); }
  return out.concat([L.SPEED_MAX * L.BOOST_MUL]);
};

test('slam roofs exist at every height, a short one in tier 2 and a long one in tier 3, usable from level 0', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    assert.equal(chunk(`slamRoof@${h}`).diff, 2);
    assert.equal(chunk(`slamLong@${h}`).diff, 3);
  }
  for (const c of slamChunks()) { assert.equal(c.minLevel, 0); assert.equal(c.steadyLevel, null); assert.equal(c.trap, true); }
});

test('the chunk is a flat floor with the roof over it and nothing else, with a run-up before the trigger and a landing after', () => {
  for (const c of slamChunks()) {
    assert.equal(c.spikes.length + c.platforms.length + c.moving.length + c.crumble.length + c.ceilings.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length + c.flips.length + c.boxes.length + c.bounces.length + c.pickups.length + c.gates.length + c.vanish.length + c.pops.length + c.cue.length, 0, c.name);
    assert.equal(c.ground.length, 1);
    assert.equal(c.maxGap, 0);
    const q = c.slams[0];
    assert.ok(q.x - L.SLAM_TRIGGER_TILES >= 2, `${c.name}: trigger ${q.x - L.SLAM_TRIGGER_TILES} tiles in`);
    assert.ok(c.w - (q.x + q.w) >= 8, `${c.name}: landing`);
  }
});

test('the roof starts to drop at least half a second ahead at the top speed with a boost, and the gems run flat under it', () => {
  assert.ok((L.SLAM_TRIGGER_TILES * L.TILE) / (L.SPEED_MAX * L.BOOST_MUL) >= 0.5);
  for (const c of slamChunks()) {
    const world = buildWorld([c]);
    const q = world.slams[0];
    assert.equal(q.x0 - q.trigger, L.SLAM_TRIGGER_TILES * L.TILE);
    assert.equal(world.ceilings.length, 1);
    assert.equal(world.ceilings[0].bottom, q.bottom);
    assert.ok(world.guides.filter(g => g.x > q.x0 && g.x < q.x1).length >= 3);
    assert.ok(world.guides.every(g => g.y === L.FLOOR_Y - c.entryH * L.TILE - L.CUBE / 2), 'flat: no jump path');
  }
});

test('the cue is to press nothing: a walker passes at every speed and height, a few steps of anything either way make no difference', () => {
  for (const c of slamChunks()) for (const speed of allSpeeds()) {
    const world = buildWorld([c]);
    const r = idle(L.newCube(2 * L.TILE, c.entryH), world, speed, world.endX - 8 * L.TILE);
    assert.equal(r.dead, false, `${c.name} at ${Math.round(speed)}`);
  }
});

// a jump launched d tiles before the roof, at the given hold: did it die, and was it clearly above the crush line while
// over the roof (in a copy of the world with no roof, so the cube flies the same path)?
function jumpAt(c, speed, hold, d) {
  const world = buildWorld([c]);
  const q = world.slams[0];
  const bare = buildWorld([c]);
  bare.ceilings = [];
  const a = L.newCube(2 * L.TILE, c.entryH), b = L.newCube(2 * L.TILE, c.entryH);
  a.x = b.x = q.x0 - d * L.TILE - L.CUBE;
  let dead = null, above = false, touched = false;
  for (let i = 0; i < 700 && !dead && a.x < q.x1 + 4 * L.TILE; i++) {
    dead = step(a, world, i < hold, i === 0, speed).dead;
    step(b, bare, i < hold, i === 0, speed);
    if (b.x + L.CUBE > q.x0 + 4 && b.x < q.x1 - 4) {
      if (b.y + L.CUBE_INSET < q.bottom - 2) above = true;
    }
    if (b.x + L.CUBE - L.CUBE_INSET > q.x0 && b.x + L.CUBE_INSET < q.x1 && b.y + L.CUBE_INSET < q.bottom) touched = true;
    {
    }
  }
  return { dead, above, touched };
}

test('a jump dies on the underside when it is over the roof above the crush line, and every jump launched inside a tap\'s range of it dies', () => {
  const c = chunk('slamRoof@0');
  for (const speed of allSpeeds().filter(s => s <= L.SPEED_MAX)) {
    const tapRange = (speed * L.hopCrossing(1, 0)) / L.TILE;
    for (const hold of [1, 8, 20, 44, 114]) for (let d = 0; d <= 20; d += 0.5) {
      const r = jumpAt(c, speed, hold, d);
      if (r.above) assert.equal(r.dead, 'ceiling', `${Math.round(speed)} px/s hold ${hold} from ${d} tiles lived while above the line`);
      if (r.dead === 'ceiling') assert.ok(r.touched, `${Math.round(speed)} px/s hold ${hold} from ${d} tiles died without rising into the roof`);
      if (d <= tapRange - 1.5) assert.equal(r.dead, 'ceiling', `${Math.round(speed)} px/s hold ${hold} from ${d} tiles lived`);
    }
    // a hop made well ahead lands first and is harmless; any hop made under the roof is not
    assert.equal(jumpAt(c, speed, 1, 12).dead, null);
    const under = buildWorld([c]);
    const q = under.slams[0];
    const cube = L.newCube(2 * L.TILE, 0);
    cube.x = q.x0 + 2 * L.TILE;
    assert.equal(step(cube, under, true, true, speed).dead || step(cube, under, true, false, speed).dead, 'ceiling');
  }
});

test('the roof is terrain: a held shield does not absorb it', () => {
  const c = chunk('slamRoof@0');
  const world = buildWorld([c]);
  const q = world.slams[0];
  const cube = L.newCube(2 * L.TILE, 0);
  cube.shield = true;
  let dead = null;
  let fired = -1;
  for (let i = 0; i < 900 && !dead; i++) {
    const press = fired < 0 && cube.x + L.CUBE >= q.x0 - L.TILE;
    if (press) fired = i;
    dead = step(cube, world, fired >= 0 && i < fired + 30, press, L.levelSpeed(2)).dead;
  }
  assert.equal(dead, 'ceiling');
  assert.ok(cube.shield, 'the shield was not spent on it');
  assert.ok(q.x0 > 0);
});

test('where the state comes from: stepCube never reads the slam list or a clock, so a run is identical with and without it', () => {
  const src = L.stepCube.toString();
  assert.ok(!/slams/.test(src));
  assert.ok(!/Date|performance|now\(/.test(src));
  const c = chunk('slamLong@0');
  const speed = L.levelSpeed(4);
  const a = buildWorld([c]), b = buildWorld([c]);
  b.slams = [];
  assert.equal(a.slams.length, 1);
  const rng = L.mulberry32(11);
  for (let run = 0; run < 20; run++) {
    const x = L.newCube(2 * L.TILE, 0), y = L.newCube(2 * L.TILE, 0);
    let held = false;
    for (let i = 0; i < 1500; i++) {
      const pressed = rng() < 0.02;
      if (pressed) held = true;
      if (held && rng() < 0.05) held = false;
      const ea = step(x, a, held, pressed, speed), eb = step(y, b, held, pressed, speed);
      assert.deepEqual(x, y);
      assert.deepEqual(ea, eb);
      if (ea.dead) break;
    }
  }
});

test('the planner clears it, the closure proves it with neighbours, and it is pruned and generated like the other traps', () => {
  for (const c of slamChunks().filter(q => q.entryH === 0 || q.entryH === 3)) for (const sp of [L.SPEED_MIN, L.levelSpeed(3), L.SPEED_MAX]) assert.ok(chunkClearable(c, sp), `${c.name} at ${Math.round(sp)}`);
  const fam = new Set(['flat', 'spike1', 'spike3', 'gap3', 'hops', 'slamRoof', 'slamLong', 'popSpikes3', 'vanish3', 'tunnel1', 'tunnel2', 'shieldDrop']);
  for (const k of [0, 3, 6]) {
    const r = closure(L.levelSpeed(k), { filter: c => fam.has(c.name.split('@')[0]) });
    assert.equal(r.startOk, true, `level ${k}: ${(r.witness || []).join(' > ')}`);
  }
  let seen = 0;
  for (const seed of [111, 112, 113, 114, 115, 116]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    seen += world.placed.filter(p => p.chunk.slams.length).length;
    const n = world.slams.length;
    L.pruneWorld(world, world.endX - 10 * L.TILE);
    assert.ok(world.slams.length <= n);
  }
  assert.ok(seen >= 4, `only ${seen} slam roofs in the test worlds`);
});
