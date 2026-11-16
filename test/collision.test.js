const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld } = require('./support.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);

function run(world, steps, speed = L.SPEED_MIN, h = 0) {
  const c = L.newCube(2 * L.TILE, h);
  for (let i = 0; i < steps; i++) {
    const ev = L.stepCube(c, world, { pressed: false, held: false }, DT, speed);
    if (ev.dead) return { dead: ev.dead, cube: c };
  }
  return { dead: null, cube: c };
}

test('running into a spike kills', () => {
  assert.equal(run(buildWorld([chunk('spike1@0')]), 600).dead, 'spike');
});

test('running into a two-tile wall kills', () => {
  assert.equal(run(buildWorld([chunk('up2@0')]), 600).dead, 'wall');
});

test('running into a gap is fatal (void, or the far wall of the gap)', () => {
  const dead = run(buildWorld([chunk('gap3@0')]), 900).dead;
  assert.ok(dead === 'void' || dead === 'wall', `got ${dead}`);
});

test('a flat chunk can be run through untouched', () => {
  const world = buildWorld([chunk('flat@0')], 8, 80);
  const r = run(world, 400);
  assert.equal(r.dead, null);
  assert.equal(r.cube.onGround, true);
});

test('a small ledge within forgiveness is stepped up, not a wall', () => {
  const world = L.createEmptyWorld();
  L.addSolid(world, -400, 300, L.FLOOR_Y);
  L.addSolid(world, 300, 2000, L.FLOOR_Y - (L.LEDGE_FORGIVE - 2));
  const r = run(world, 400);
  assert.equal(r.dead, null);
  assert.equal(r.cube.y + L.CUBE, L.FLOOR_Y - (L.LEDGE_FORGIVE - 2));
});

test('a floating platform is landable from above and never blocks from below', () => {
  const world = L.createEmptyWorld();
  L.addSolid(world, -400, 5000, L.FLOOR_Y + 200);
  world.platforms.push({ x0: 0, x1: 400, top: L.FLOOR_Y - 100 });

  const above = L.newCube(100, 0);
  above.y = L.FLOOR_Y - 200;
  above.onGround = false;
  let landed = false;
  for (let i = 0; i < 200; i++) {
    const ev = L.stepCube(above, world, { pressed: false, held: false }, DT, 0);
    if (ev.landed) landed = true;
  }
  assert.equal(landed, true);
  assert.equal(above.y + L.CUBE, L.FLOOR_Y - 100);

  const below = L.newCube(100, 0);
  below.y = L.FLOOR_Y - 60;
  below.vy = -L.JUMP_V;
  below.onGround = false;
  let dead = null;
  for (let i = 0; i < 40; i++) dead = dead || L.stepCube(below, world, { pressed: false, held: true }, DT, 0).dead;
  assert.equal(dead, null);
  assert.ok(below.y + L.CUBE < L.FLOOR_Y - 100, 'cube should have passed up through the platform');
});

test('spike hitbox is smaller than the drawn spike', () => {
  assert.ok(L.SPIKE_HIT_W < 1);
  assert.ok(L.SPIKE_HIT_H < 1);
  const world = L.createEmptyWorld();
  L.addSolid(world, -400, 5000, L.FLOOR_Y);
  world.spikes.push({ x0: 300, x1: 300 + L.TILE, base: L.FLOOR_Y });
  // a cube resting just touching the outer edge of the drawn spike survives
  const c = L.newCube(300 - L.CUBE + 4, 0);
  const ev = L.stepCube(c, world, { pressed: false, held: false }, DT, 0);
  assert.equal(ev.dead, null);
});

test('game state: waits for first press, dies, then restarts after the lock', () => {
  const g = L.newGame(1);
  assert.equal(g.state, 'ready');
  for (let i = 0; i < 100; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.equal(g.state, 'ready');
  assert.equal(g.cube.x, 2 * L.TILE);

  assert.ok(L.stepGame(g, { pressed: true, held: true }, DT).includes('start'));
  assert.equal(g.state, 'running');

  let died = false;
  for (let i = 0; i < 5000 && !died; i++) died = L.stepGame(g, { pressed: false, held: false }, DT).includes('die');
  assert.equal(died, true);
  assert.equal(g.state, 'dead');
  assert.equal(L.canRestart(g), false);
  for (let i = 0; i < Math.ceil(L.RESTART_LOCK / DT) + 1; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.equal(L.canRestart(g), true);
});
