const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, plan } = require('./support.js');

const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);
const SPEED = L.SPEED_MIN;

function flat() {
  const w = L.createEmptyWorld();
  L.addGround(w, -50, 4000, 0);
  return w;
}
// a jump with this hold taken `dx` pixels before the pickup: does it take it?
function jumpTakes(world, q, hold, dx, speed = SPEED) {
  const cube = L.newCube(2 * L.TILE, 0);
  cube.x = q.x - L.CUBE / 2 - dx;
  let took = false;
  for (let i = 0; i < 200; i++) {
    const ev = step(cube, world, i < hold, i === 0, speed);
    if (ev.pickup) took = true;
    if (ev.dead) break;
  }
  return { took, cube };
}
function firstDx(world, q, hold, speed = SPEED) {
  for (let dx = 8 * L.TILE; dx >= 0; dx -= 2) if (jumpTakes(world, q, hold, dx, speed).took) return dx;
  return null;
}

// run a cube along until it dies, or `steps` pass; returns what happened
function run(cube, world, steps, speed = SPEED, held = false) {
  const log = { dead: null, shields: 0, pickups: 0 };
  for (let i = 0; i < steps && !log.dead; i++) {
    const ev = step(cube, world, held, false, speed);
    if (ev.dead) log.dead = ev.dead;
    if (ev.shield) log.shields++;
    if (ev.pickup) log.pickups++;
  }
  return log;
}
const spikeAt = (world, tile, low) => world.spikes.push({ x0: tile * L.TILE, x1: (tile + 1) * L.TILE, base: L.FLOOR_Y, low: !!low });

test('without a shield a spike kills as before', () => {
  for (const low of [false, true]) {
    const w = flat();
    spikeAt(w, 20, low);
    assert.equal(run(L.newCube(2 * L.TILE, 0), w, 600).dead, 'spike', `low ${low}`);
  }
});

test('with a shield, a spike (tall or low stud) is absorbed once: the shield is spent, the cube goes on, and one event says so', () => {
  for (const low of [false, true]) {
    const w = flat();
    spikeAt(w, 20, low);
    const cube = L.newCube(2 * L.TILE, 0);
    cube.shield = true;
    const log = run(cube, w, 600);
    assert.equal(log.dead, null, `low ${low}`);
    assert.equal(log.shields, 1);
    assert.equal(cube.shield, false);
    assert.ok(cube.x > 22 * L.TILE, 'the cube ran on through');
  }
});

test('terrain is never absorbed: a wall, a roof, a block side or underside and the void kill even with a shield', () => {
  const cases = {
    wall: w => L.addSolid(w, 10 * L.TILE, 12 * L.TILE, L.FLOOR_Y - 3 * L.TILE),
    ceiling: w => w.ceilings.push({ x0: 8 * L.TILE, x1: 14 * L.TILE, bottom: L.FLOOR_Y - L.CUBE / 2 }),
    boxSide: w => w.boxes.push({ x0: 10 * L.TILE, x1: 12 * L.TILE, top: L.FLOOR_Y - 1.5 * L.TILE, bottom: L.FLOOR_Y - 0.2 * L.TILE }),
  };
  for (const [name, build] of Object.entries(cases)) {
    const w = flat();
    build(w);
    const cube = L.newCube(2 * L.TILE, 0);
    cube.shield = true;
    assert.ok(run(cube, w, 600).dead, `${name}: the shield saved a terrain hit`);
  }
  const hole = L.createEmptyWorld();
  L.addGround(hole, -50, 15, 0);
  const cube = L.newCube(2 * L.TILE, 0);
  cube.shield = true;
  assert.equal(run(cube, hole, 900).dead, 'void');
  // and being invulnerable does not help against terrain either
  const w = flat();
  L.addSolid(w, 10 * L.TILE, 12 * L.TILE, L.FLOOR_Y - 3 * L.TILE);
  const inv = L.newCube(2 * L.TILE, 0);
  inv.inv = 5;
  assert.equal(run(inv, w, 600).dead, 'wall');
});

test('invulnerability: hazards do nothing for SHIELD_INV_S after a hit, and kill again after it', () => {
  const w = flat();
  spikeAt(w, 12);
  spikeAt(w, 14);      // 2 tiles later: inside the safe time
  const cube = L.newCube(2 * L.TILE, 0);
  cube.shield = true;
  const log = run(cube, w, 500);
  assert.equal(log.dead, null);
  assert.equal(log.shields, 1);
  assert.ok(cube.inv === 0 || cube.inv < L.SHIELD_INV_S);
  // the same spikes far apart: the second one kills, because the safe time has run out
  const w2 = flat();
  spikeAt(w2, 12);
  spikeAt(w2, 12 + Math.ceil((L.SHIELD_INV_S * SPEED) / L.TILE) + 3);
  const c2 = L.newCube(2 * L.TILE, 0);
  c2.shield = true;
  assert.equal(run(c2, w2, 900).dead, 'spike');
  assert.ok(Math.abs(L.SHIELD_INV_S - 0.6) < 1e-9);
});

test('a pickup is taken by touching it, once, and gives a shield; a fresh cube can take it again', () => {
  const chunk = L.makeChunk('pk@0', 1, 0, 0, { w: 8, ground: [{ x0: 0, x1: 8, h: 0 }], pickups: [{ x: 3, h: 2 }] });
  const w = buildWorld([chunk]);
  assert.equal(w.pickups.length, 1);
  const q = w.pickups[0];
  assert.equal(q.y, L.FLOOR_Y - 2 * L.TILE);
  assert.equal(q.x, 8 * L.TILE + (3 + L.PAD) * L.TILE + L.TILE / 2);
  // run through it on the ground: too low (a pickup 2 tiles up is out of reach of a cube that does not jump)
  const walker = L.newCube(2 * L.TILE, 0);
  assert.equal(run(walker, w, 700).pickups, 0, 'a walker should not reach it');
  // a tap jump takes it, from some launch points
  assert.notEqual(firstDx(w, q, 1), null, 'no tap jump takes the pickup');
  const dx = firstDx(w, q, 1);
  const { cube } = jumpTakes(w, q, 1, dx);
  let taken = cube.picked[q.id] ? 1 : 0;
  assert.equal(taken, 1);
  assert.equal(cube.shield, true);
  assert.ok(cube.picked[q.id]);
  // touching the same place again gives nothing (it is gone)
  cube.shield = false;
  cube.x = q.x - L.CUBE; cube.y = q.y - L.CUBE / 2;
  assert.equal(step(cube, w, false, false, 0).pickup, undefined);
  assert.equal(cube.shield, false);
  // a new run starts fresh
  const fresh = L.newCube(2 * L.TILE, 0);
  assert.deepEqual(fresh.picked, {});
  assert.equal(fresh.shield, false);
  assert.equal(fresh.inv, 0);
});

test('shield state is part of the cube: clones keep it independent, and the planner can tell the states apart', () => {
  const a = L.newCube(100, 0);
  a.shield = true; a.picked.x = true; a.broken.y = true;
  const b = L.cloneCube(a);
  b.picked.z = true; b.broken.w = true; b.shield = false;
  assert.deepEqual(Object.keys(a.picked), ['x']);
  assert.deepEqual(Object.keys(a.broken), ['y']);
  assert.equal(a.shield, true);
  // two cubes that differ only in the shield must not share a memo entry: the planner treats them differently
  const world = flat();
  spikeAt(world, 14);
  const withShield = L.newCube(2 * L.TILE, 0);
  withShield.shield = true;
  const without = L.newCube(2 * L.TILE, 0);
  const target = 30 * L.TILE;
  const memo = new Map();
  assert.ok(plan(without, world, SPEED, target, memo) !== null);
  const pWith = plan(withShield, world, SPEED, target, memo);
  assert.ok(pWith !== null);
  assert.ok(memo.size >= 2);
  // with the shield the spike is not a problem: the whole stretch can be walked, which the planner reports as free
  assert.equal(pWith.free, true);
});

test('a game run reports one pickup event and one shield event', () => {
  const chunk = L.makeChunk('pk@0', 1, 0, 0, { w: 24, ground: [{ x0: 0, x1: 24, h: 0 }], pickups: [{ x: 3, h: 2 }], spikes: [{ x: 15, h: 0 }] });
  const probe = buildWorld([chunk]);
  const dx0 = firstDx(probe, probe.pickups[0], 1);
  assert.notEqual(dx0, null);
  const g = L.newGame(4, true, 0, [chunk]);
  let pickups = 0, shields = 0;
  for (let i = 0; i < 3000 && g.state === 'running' && g.cube.x < 14 * L.TILE + 25 * L.TILE; i++) {
    const q = g.world.pickups[0];
    const go = q && g.cube.onGround && g.cube.x >= q.x - L.CUBE / 2 - dx0 && g.cube.x < q.x - L.CUBE / 2 - dx0 + 4;
    const evs = L.stepGame(g, { pressed: !!go, held: !!go }, DT);
    pickups += evs.filter(e => e === 'pickup').length;
    shields += evs.filter(e => e === 'shield').length;
  }
  assert.equal(g.state, 'running');
  assert.equal(pickups, 1);
  assert.equal(shields, 1);
});
