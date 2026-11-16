const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, hybridRun } = require('./support.js');

const names = () => Object.keys(L.SHOWCASES);

// a showcase world laid out far enough to hold every level once, plus some of the repeating last level
function fullWorld(name, seed) {
  const sc = L.showcaseSequence(name);
  const world = L.createWorld(seed, sc.sequence, null, undefined, sc);
  L.extendWorld(world, sc.sequence.reduce((a, c) => a + c.w, 0) * L.TILE, 0);
  return { sc, world };
}

test('every showcase is built from real pieces whose heights join, including where the last level loops', () => {
  assert.ok(names().length >= 15);
  for (const n of names()) {
    const { sequence, levels, loopFrom } = L.showcaseSequence(n);
    assert.equal(sequence.length, levels.length);
    assert.equal(levels[0], 0, n);
    assert.equal(levels[loopFrom], L.LAST_LEVEL, n);
    for (let i = 0; i < sequence.length; i++) {
      const next = sequence[i + 1 < sequence.length ? i + 1 : loopFrom];
      assert.equal(sequence[i].exitH, next.entryH, `${n}: ${sequence[i].name} > ${next.name}`);
      if (i > 0) assert.ok(levels[i] >= levels[i - 1], n);
    }
  }
  assert.equal(L.showcaseSequence('nope'), null);
  assert.equal(L.showcaseSequence('constructor'), null);
});

test('each showcase steps through levels 0 to 6 in order, and every piece but the runway plays at its level speed', () => {
  for (const n of names()) {
    const { sc, world } = fullWorld(n, 3);
    assert.deepEqual(world.levelMarks.slice(0, L.LAST_LEVEL + 1).map(m => m.level), [0, 1, 2, 3, 4, 5, 6], n);
    assert.equal(world.levelMarks.length, L.LAST_LEVEL + 1, n + ': the last level repeats without a new mark');
    for (const p of world.placed) {
      if (p.chunk.name.startsWith('flat')) continue;
      const i = world.levelMarks.filter(m => m.x <= p.x0).length - 1;
      const k = world.levelMarks[i].level;
      for (const x of [p.x0, (p.x0 + p.x1) / 2, p.x1 - 1]) {
        assert.equal(L.showcaseSpeedAt(world, x), L.levelSpeed(k), `${n}: ${p.chunk.name} at level ${k}`);
      }
      if (p.chunk.steadyLevel !== null) assert.equal(p.chunk.steadyLevel, k, `${n}: ${p.chunk.name} built for its level`);
    }
    // the ease fits inside the runway: a runway is longer than the ease
    assert.ok(sc.sequence[0].w * L.TILE > L.LEVEL_EASE_PX);
  }
});

test('a showcase game raises its level once per stage, in order, whatever the distance run', () => {
  const g = L.newShowcase(5, 'orbGap', true, 0);
  L.extendWorld(g.world, 2000 * L.TILE, 0);
  const seen = [];
  for (const m of g.world.levelMarks.slice(1)) {
    Object.assign(g.cube, { x: m.x + 1, y: L.FLOOR_Y - L.CUBE, vy: 0, onGround: true });
    const ev = L.stepGame(g, { pressed: false, held: false }, DT);
    if (ev.includes('level')) seen.push(g.level);
    assert.equal(L.gameSpeed(g) < L.levelSpeed(m.level), true, 'speed eases in at the mark');
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6]);
  assert.equal(g.showcase, 'orbGap');
  assert.equal(L.newShowcase(5, 'nope', true, 0), null);
});

test('normal games keep speed and level from distance', () => {
  const g = L.newGame(9, true, 0);
  assert.equal(g.world.levelMarks, null);
  for (const m of [0, 150, 301, 302, 610, 1300, 2600, 4000, 5100, 9000]) {
    g.cube.x = g.startX + m * L.METER_PX;
    assert.equal(L.gameSpeed(g), L.speedAt(L.distancePx(g)), m + ' m');
    assert.equal(L.gameLevel(g), L.levelAt(L.distancePx(g)), m + ' m');
  }
});

test('a player who follows every cue clears every showcase from level 0 through level 6', () => {
  for (const n of names()) {
    for (const seed of [7, 11]) {
      const { world } = fullWorld(n, seed);
      const r = hybridRun(world, x => L.showcaseSpeedAt(world, x), L.mulberry32(seed), 2);
      assert.ok(r.ok, `${n} seed ${seed}: ${r.why} at tile ${Math.round(r.x / L.TILE)}`);
      assert.ok(r.x > world.levelMarks[L.LAST_LEVEL].x, `${n}: reached level 6`);
    }
  }
});
