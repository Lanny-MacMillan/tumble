const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld } = require('./support.js');

const flat = () => buildWorld([L.CHUNKS.find(c => c.name === 'flat@0')], 8, 40);

function jumpPeak(holdSteps) {
  const world = flat();
  const c = L.newCube(2 * L.TILE, 0);
  const floor = c.y;
  let peak = 0;
  for (let i = 0; i < 400; i++) {
    const input = { pressed: i === 0, held: i < holdSteps };
    L.stepCube(c, world, input, DT, L.SPEED_MIN);
    peak = Math.max(peak, floor - c.y);
    if (i > 5 && c.onGround) break;
  }
  return { peak, cube: c, floor };
}

test('a held jump reaches the derived peak height', () => {
  const { peak } = jumpPeak(200);
  assert.ok(Math.abs(peak - L.JUMP_PEAK) < 4, `peak ${peak} vs ${L.JUMP_PEAK}`);
});

test('a tap jumps much lower than a hold', () => {
  const tap = jumpPeak(1).peak;
  const hold = jumpPeak(200).peak;
  assert.ok(tap < hold * 0.4, `tap ${tap} hold ${hold}`);
  assert.ok(tap > L.CUBE * 0.8, `tap should still clear one tile, got ${tap}`);
});

test('cube lands grounded and settles flat on a quarter turn', () => {
  const world = flat();
  const c = L.newCube(2 * L.TILE, 0);
  for (let i = 0; i < 400; i++) L.stepCube(c, world, { pressed: i === 0, held: i < 30 }, DT, L.SPEED_MIN);
  assert.equal(c.onGround, true);
  const quarter = Math.PI / 2;
  const off = Math.abs(c.angle / quarter - Math.round(c.angle / quarter));
  assert.ok(off < 0.01, `angle ${c.angle} not on a quarter turn`);
});

function pressAfterLedge(delaySteps) {
  const world = buildWorld([L.CHUNKS.find(c => c.name === 'gap3@0')]);
  const c = L.newCube(2 * L.TILE, 0);
  let left = null;
  for (let i = 0; i < 600; i++) {
    const press = left !== null && i === left + delaySteps;
    const ev = L.stepCube(c, world, { pressed: press, held: true }, DT, L.SPEED_MIN);
    if (left === null && !c.onGround) left = i;
    if (ev.jumped) return true;
    if (ev.dead) return false;
  }
  return false;
}

test('coyote time allows a jump just after leaving a ledge, but not long after', () => {
  const inside = Math.floor((L.COYOTE / DT) * 0.5);
  const outside = Math.ceil((L.COYOTE / DT) * 1.5);
  assert.equal(pressAfterLedge(inside), true);
  assert.equal(pressAfterLedge(outside), false);
});

test('jump pressed just before landing still fires (buffer)', () => {
  const world = flat();
  const c = L.newCube(2 * L.TILE, 0);
  c.y -= 60;
  c.onGround = false;
  let jumps = 0;
  for (let i = 0; i < 200; i++) {
    const ev = L.stepCube(c, world, { pressed: i === 3, held: false }, DT, L.SPEED_MIN);
    if (ev.jumped) jumps++;
  }
  assert.equal(jumps, 1);
});

test('speed: starts at min, never goes down, stays in range, and every level is faster than the one before', () => {
  assert.equal(L.speedAt(0), L.SPEED_MIN);
  let prev = 0;
  for (let d = 0; d <= 6000 * L.METER_PX; d += 20) {
    const s = L.speedAt(d);
    assert.ok(s >= prev - 1e-9, `speed went down at ${d}`);
    assert.ok(s >= L.SPEED_MIN - 1e-9 && s <= L.SPEED_MAX + 1e-9, `speed ${s} out of range`);
    prev = s;
  }
  for (let k = 1; k <= L.LAST_LEVEL; k++) assert.ok(L.levelSpeed(k) > L.levelSpeed(k - 1), `level ${k} is not faster`);
  assert.equal(L.levelSpeed(0), L.SPEED_MIN);
  assert.ok(Math.abs(L.levelSpeed(L.LAST_LEVEL) - L.SPEED_MAX) < 1e-9);
  assert.equal(L.speedAt(1e9), L.SPEED_MAX);
});

test('levels start at the planned distances, in order, and level never goes down', () => {
  assert.deepEqual(L.LEVEL_STARTS_M, [0, 300, 600, 1200, 2000, 3000, 5000]);
  L.LEVEL_STARTS_M.forEach((m, k) => {
    assert.equal(L.levelAt(m * L.METER_PX), k);
    if (m > 0) assert.equal(L.levelAt(m * L.METER_PX - 1), k - 1);
  });
  assert.equal(L.levelAt(-5), 0);
  assert.equal(L.levelAt(1e9), L.LAST_LEVEL);
  let prev = 0;
  for (let d = 0; d < 6000 * L.METER_PX; d += 400) { const k = L.levelAt(d); assert.ok(k >= prev); prev = k; }
});

test('the speed step at a level boundary is smooth: it reaches the new speed a full ease length later, with a bounded slope', () => {
  for (let k = 1; k <= L.LAST_LEVEL; k++) {
    const start = L.LEVEL_STARTS_M[k] * L.METER_PX;
    assert.ok(Math.abs(L.speedAt(start) - L.levelSpeed(k - 1)) < 1e-6, `level ${k} starts at the old speed`);
    assert.ok(Math.abs(L.speedAt(start + L.LEVEL_EASE_PX) - L.levelSpeed(k)) < 1e-6, `level ${k} ends at the new speed`);
    const jump = L.levelSpeed(k) - L.levelSpeed(k - 1);
    let worst = 0;
    for (let d = start; d < start + L.LEVEL_EASE_PX; d++) worst = Math.max(worst, Math.abs(L.speedAt(d + 1) - L.speedAt(d)));
    assert.ok(worst <= (1.5 * jump) / L.LEVEL_EASE_PX + 1e-6, `level ${k}: slope ${worst}`);
  }
});

test('a game reports each level exactly once, in order, and none at the start or after a restart', () => {
  const g = L.newGame(12, true, 0);
  assert.equal(g.level, 0);
  g.world.solids = [{ x0: -1e9, x1: 1e9, top: L.FLOOR_Y }];
  g.world.spikes = []; g.world.platforms = []; g.world.movers = []; g.world.crumbles = []; g.world.ceilings = [];
  g.world.endX = 1e9;
  const seen = [];
  for (let i = 0; i < 1000 * 120 && seen.length < 3; i++) {
    const ev = L.stepGame(g, { pressed: false, held: false }, DT);
    for (const e of ev) if (e === 'level') seen.push(g.level);
  }
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(L.newGame(12, true, 0).level, 0);
});

test('heat grows with level and is capped', () => {
  for (let k = 1; k <= 8; k++) assert.ok(L.heatAt(k) >= L.heatAt(k - 1));
  assert.ok(L.heatAt(0) > 0 && L.heatAt(99) <= 2.5);
});
