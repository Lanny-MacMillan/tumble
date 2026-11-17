const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT } = require('./support.js');

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    data,
  };
}
const rec = best => JSON.stringify({ v: L.SAVE_VERSION, best, total: best });
// the best-score part of what recordRun returns
const bn = r => ({ best: r.best, isNewBest: r.isNewBest });

test('a fresh store has no best', () => {
  const store = L.createStore(() => fakeStorage());
  assert.equal(store.getBest(), 0);
});

test('a first run of 0 m is not a new best', () => {
  const store = L.createStore(() => fakeStorage());
  assert.deepEqual(bn(store.recordRun(0)), { best: 0, isNewBest: false });
});

test('a run that beats the best is saved and survives a reload', () => {
  const ls = fakeStorage();
  const a = L.createStore(() => ls);
  assert.deepEqual(bn(a.recordRun(120)), { best: 120, isNewBest: true });
  const b = L.createStore(() => ls);
  assert.equal(b.getBest(), 120);
});

test('the best never goes down, including when the saved value is larger', () => {
  const ls = fakeStorage({ [L.SAVE_KEY]: rec(500) });
  const store = L.createStore(() => ls);
  assert.deepEqual(bn(store.recordRun(80)), { best: 500, isNewBest: false });
  assert.equal(JSON.parse(ls.data.get(L.SAVE_KEY)).best, 500);
  // another tab raises the saved best behind this store's back
  ls.setItem(L.SAVE_KEY, rec(900));
  assert.deepEqual(bn(store.recordRun(600)), { best: 900, isNewBest: false });
});

test('fractional and bad run values are handled', () => {
  const store = L.createStore(() => fakeStorage());
  assert.equal(store.recordRun(42.9).best, 42);
  assert.equal(store.recordRun(NaN).best, 42);
  assert.equal(store.recordRun(-5).best, 42);
  assert.equal(store.recordRun(Infinity).best, 42);
});

test('getStorage throwing never reaches the caller and the best stays in memory', () => {
  const store = L.createStore(() => { throw new Error('SecurityError'); });
  assert.equal(store.getBest(), 0);
  assert.deepEqual(bn(store.recordRun(75)), { best: 75, isNewBest: true });
  assert.equal(store.getBest(), 75);
  assert.deepEqual(bn(store.recordRun(50)), { best: 75, isNewBest: false });
});

test('getStorage returning null falls back to memory', () => {
  const store = L.createStore(() => null);
  assert.deepEqual(bn(store.recordRun(30)), { best: 30, isNewBest: true });
  assert.equal(store.getBest(), 30);
});

test('getItem throwing is survived', () => {
  const ls = { getItem() { throw new Error('boom'); }, setItem() {} };
  const store = L.createStore(() => ls);
  assert.equal(store.getBest(), 0);
  assert.equal(store.recordRun(10).best, 10);
});

test('setItem throwing (quota or private mode) is survived and memory keeps the best', () => {
  const ls = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  const store = L.createStore(() => ls);
  assert.deepEqual(bn(store.recordRun(64)), { best: 64, isNewBest: true });
  assert.equal(store.getBest(), 64);
});

test('corrupt, wrong-version and bad-value records are ignored', () => {
  const bad = ['not json', '{', 'null', '[]', JSON.stringify({ v: 99, best: 300 }), JSON.stringify({ v: 1, best: 'x' }), JSON.stringify({ v: 1, best: -4 }), JSON.stringify({ v: 1 })];
  for (const raw of bad) {
    const store = L.createStore(() => fakeStorage({ [L.SAVE_KEY]: raw }));
    assert.equal(store.getBest(), 0, `record ${raw} should read as no best`);
    assert.equal(store.recordRun(20).best, 20);
  }
});

test('the saved record is a small versioned object so fields can be added later', () => {
  const ls = fakeStorage();
  L.createStore(() => ls).recordRun(33);
  assert.deepEqual(JSON.parse(ls.data.get(L.SAVE_KEY)), { v: 2, best: 33, total: 33, look: null });
});

// ---- lifetime distance, cube levels and looks ----

test('every counted run adds to the lifetime total, which survives a reload', () => {
  const ls = fakeStorage();
  const a = L.createStore(() => ls);
  a.recordRun(100); a.recordRun(40); a.recordRun(0); a.recordRun(NaN);
  assert.equal(a.getTotal(), 140);
  assert.equal(a.getBest(), 100);
  assert.equal(L.createStore(() => ls).getTotal(), 140);
});

test('an old version 1 save keeps its best and starts the lifetime total at it', () => {
  const ls = fakeStorage({ [L.SAVE_KEY]: JSON.stringify({ v: 1, best: 420 }) });
  const store = L.createStore(() => ls);
  assert.equal(store.getBest(), 420);
  assert.equal(store.getTotal(), 420);
  assert.equal(store.getLevel(), 2);
  store.recordRun(10);
  assert.deepEqual(JSON.parse(ls.data.get(L.SAVE_KEY)), { v: 2, best: 420, total: 430, look: null });
});

test('a bad total is repaired from the best, and the total is never below the best', () => {
  for (const total of ['x', -3, null, undefined, 5]) {
    const store = L.createStore(() => fakeStorage({ [L.SAVE_KEY]: JSON.stringify({ v: 2, best: 300, total }) }));
    assert.equal(store.getTotal(), 300, `total ${total}`);
  }
});

test('another tab adding distance is never lost or counted twice', () => {
  const ls = fakeStorage();
  const a = L.createStore(() => ls), b = L.createStore(() => ls);
  a.recordRun(100);
  b.recordRun(50);
  a.recordRun(30);
  assert.equal(L.createStore(() => ls).getTotal(), 180);
  assert.equal(a.getTotal(), 180);
  assert.equal(b.getTotal(), 180);
});

test('with storage blocked the total still adds up for the session', () => {
  const store = L.createStore(() => { throw new Error('blocked'); });
  store.recordRun(200); store.recordRun(60);
  assert.equal(store.getTotal(), 260);
  assert.equal(store.getLevel(), 2);
});

test('cube levels: 250, 1000, 3000 and 7500 m, and recordRun reports a level crossed', () => {
  const cases = [[0, 1], [249, 1], [250, 2], [999, 2], [1000, 3], [2999, 3], [3000, 4], [7499, 4], [7500, 5], [1e9, 5], [NaN, 1], [-5, 1]];
  for (const [t, lv] of cases) assert.equal(L.cubeLevelFor(t), lv, `${t} m`);
  const store = L.createStore(() => fakeStorage());
  const r1 = store.recordRun(200);
  assert.equal(r1.level, 1); assert.equal(r1.levelUp, false);
  const r2 = store.recordRun(60);
  assert.equal(r2.level, 2); assert.equal(r2.levelUp, true);
  assert.equal(store.recordRun(5).levelUp, false);
  assert.equal(store.recordRun(5000).level, 4, 'a long run can jump more than one level');
});

test('unlocks build up level by level and every wearable has one slot', () => {
  assert.deepEqual(L.unlockedAt(1), { colors: ['magenta'], wear: [] });
  assert.deepEqual(L.unlockedAt(5).colors, ['magenta', 'cyan', 'solar', 'toxic', 'ember', 'ghost', 'gold', 'prism']);
  assert.deepEqual(L.unlockedAt(5).wear, ['shades', 'antenna', 'headphones', 'cap', 'crown']);
  for (let lv = 1; lv < 5; lv++) {
    const a = L.unlockedAt(lv), b = L.unlockedAt(lv + 1);
    for (const c of a.colors) assert.ok(b.colors.includes(c));
    for (const w of a.wear) assert.ok(b.wear.includes(w));
  }
  for (const w of L.unlockedAt(5).wear) assert.ok(['head', 'face', 'ears'].includes(L.WEAR_SLOTS[w]), w);
});

test('a look is cleaned: locked, unknown or wrong-slot choices fall back to the default', () => {
  assert.deepEqual(L.sanitizeLook(null, 5), L.DEFAULT_LOOK);
  assert.deepEqual(L.sanitizeLook('gold', 5), L.DEFAULT_LOOK);
  assert.deepEqual(L.sanitizeLook({ color: 'gold', head: 'crown', face: 'shades', ears: 'headphones' }, 5), { color: 'gold', head: 'crown', face: 'shades', ears: 'headphones' });
  assert.deepEqual(L.sanitizeLook({ color: 'gold', head: 'crown', face: 'shades' }, 2), { color: 'magenta', head: null, face: 'shades', ears: null });
  assert.deepEqual(L.sanitizeLook({ color: 'plaid', head: 'shades', face: 'crown', ears: 7 }, 5), L.DEFAULT_LOOK);
  assert.deepEqual(L.sanitizeLook({ color: 'toString', head: '__proto__' }, 5), L.DEFAULT_LOOK);
});

test('the chosen look is saved, survives a reload, and is cleaned on the way in and out', () => {
  const ls = fakeStorage({ [L.SAVE_KEY]: JSON.stringify({ v: 2, best: 1200, total: 1200 }) });
  const store = L.createStore(() => ls);
  assert.deepEqual(store.getLook(), L.DEFAULT_LOOK);
  assert.deepEqual(store.setLook({ color: 'toxic', head: 'antenna', face: 'shades', ears: 'headphones' }), { color: 'toxic', head: 'antenna', face: 'shades', ears: 'headphones' });
  assert.deepEqual(L.createStore(() => ls).getLook(), { color: 'toxic', head: 'antenna', face: 'shades', ears: 'headphones' });
  assert.deepEqual(store.setLook({ color: 'gold', head: 'crown' }), L.DEFAULT_LOOK, 'level 3 cannot wear level 5 things');
  // a hand-edited save cannot unlock anything either
  const forged = fakeStorage({ [L.SAVE_KEY]: JSON.stringify({ v: 2, best: 0, total: 0, look: { color: 'prism', head: 'crown' } }) });
  assert.deepEqual(L.createStore(() => forged).getLook(), L.DEFAULT_LOOK);
  // a run keeps the look in the record
  store.setLook({ color: 'ember' });
  store.recordRun(10);
  assert.equal(JSON.parse(ls.data.get(L.SAVE_KEY)).look.color, 'ember');
});

test('with storage blocked, the best survives a restart within the session', () => {
  const store = L.createStore(() => { throw new Error('blocked'); });
  let g = L.newGame(1, false, store.getBest());
  assert.equal(L.bestMarkerX(g), null);
  g = L.newGame(2, true, store.recordRun(150).best);
  assert.equal(g.bestAtStart, 150);
  assert.equal(L.bestMarkerX(g), g.startX + 150 * L.METER_PX);
  g = L.newGame(3, true, store.recordRun(220).best);
  assert.equal(L.bestMarkerX(g), g.startX + 220 * L.METER_PX);
});

test('bestMarkerX is null with no best and moves to the new best on the next run', () => {
  const ls = fakeStorage();
  const store = L.createStore(() => ls);
  const first = L.newGame(1, true, store.getBest());
  assert.equal(L.bestMarkerX(first), null);
  store.recordRun(90);
  const second = L.newGame(2, true, store.getBest());
  assert.equal(L.bestMarkerX(second), second.startX + 90 * L.METER_PX);
  store.recordRun(140);
  const third = L.newGame(3, true, store.getBest());
  assert.equal(L.bestMarkerX(third), third.startX + 140 * L.METER_PX);
});

test('the best event fires once, when the run passes the previous best', () => {
  const g = L.newGame(7, true, 10);
  const world = L.createWorld(7);
  void world;
  g.cube.vy = 0;
  let fired = 0;
  // run on an endless flat floor so the cube cannot die before it passes 10 m
  g.world.solids = [{ x0: -1e9, x1: 1e9, top: L.FLOOR_Y }];
  g.world.spikes = [];
  g.world.platforms = [];
  g.world.endX = 1e9;
  for (let i = 0; i < 20 * 120; i++) {
    const ev = L.stepGame(g, { pressed: false, held: false }, DT);
    fired += ev.filter(e => e === 'best').length;
    if (g.state === 'dead') break;
  }
  assert.equal(g.state, 'running');
  assert.ok(L.meters(g) > 10);
  assert.equal(fired, 1);
});

test('no best event on a first run, and none before the best is reached', () => {
  const first = L.newGame(8, true, 0);
  first.world.solids = [{ x0: -1e9, x1: 1e9, top: L.FLOOR_Y }];
  first.world.spikes = []; first.world.platforms = []; first.world.endX = 1e9;
  let fired = 0;
  for (let i = 0; i < 10 * 120; i++) fired += L.stepGame(first, { pressed: false, held: false }, DT).filter(e => e === 'best').length;
  assert.equal(fired, 0);

  const far = L.newGame(9, true, 100000);
  far.world.solids = [{ x0: -1e9, x1: 1e9, top: L.FLOOR_Y }];
  far.world.spikes = []; far.world.platforms = []; far.world.endX = 1e9;
  fired = 0;
  for (let i = 0; i < 10 * 120; i++) fired += L.stepGame(far, { pressed: false, held: false }, DT).filter(e => e === 'best').length;
  assert.equal(fired, 0);
});

test('a death is recorded through the store and reported as a new best only when it is one', () => {
  const store = L.createStore(() => fakeStorage());
  const g = L.newGame(3, true, store.getBest());
  let died = false;
  for (let i = 0; i < 6000 && !died; i++) died = L.stepGame(g, { pressed: false, held: false }, DT).includes('die');
  assert.equal(died, true);
  const res = store.recordRun(L.meters(g));
  assert.equal(res.isNewBest, L.meters(g) > 0);
  const again = store.recordRun(L.meters(g));
  assert.equal(again.isNewBest, false);
});

test('a practice list serves exactly those chunks, in order, over and over', () => {
  const list = [L.CHUNKS.find(c => c.name === 'tunnel1@0'), L.CHUNKS.find(c => c.name === 'moveStone@0'), L.CHUNKS.find(c => c.name === 'crumbleRun@0')];
  const g = L.newGame(5, true, 0, list);
  const names = [];
  for (let i = 0; i < 12; i++) {
    const before = g.world.count;
    L.extendWorld(g.world, g.world.endX - L.TILE * 70 + 1, 0);
    if (g.world.count > before) names.push(g.world.lastName);
  }
  assert.ok(names.length >= 9);
  const start = list.findIndex(c => c.name === names[0]);
  assert.ok(start >= 0);
  names.forEach((n, i) => assert.equal(n, list[(start + i) % list.length].name));
  const normal = L.newGame(5, true, 0);
  assert.equal(normal.world.sequence, null);
});

test('mute defaults to off', () => {
  assert.equal(L.createStore(() => fakeStorage()).getMuted(), false);
});

test('mute survives a reload and keeps the rest of the record', () => {
  const ls = fakeStorage();
  const a = L.createStore(() => ls);
  a.recordRun(80);
  assert.equal(a.setMuted(true), true);
  const b = L.createStore(() => ls);
  assert.equal(b.getMuted(), true);
  assert.equal(b.getBest(), 80);
  assert.equal(b.getTotal(), 80);
  b.setMuted(false);
  assert.equal(L.createStore(() => ls).getMuted(), false);
});

test('an old record without mute reads as unmuted and keeps its best', () => {
  const v1 = L.createStore(() => fakeStorage({ [L.SAVE_KEY]: JSON.stringify({ v: 1, best: 50 }) }));
  assert.equal(v1.getMuted(), false);
  assert.equal(v1.getBest(), 50);
  const v2 = L.createStore(() => fakeStorage({ [L.SAVE_KEY]: rec(70) }));
  assert.equal(v2.getMuted(), false);
  assert.equal(v2.getBest(), 70);
});

test('mute works with storage blocked', () => {
  const store = L.createStore(() => { throw new Error('blocked'); });
  assert.equal(store.setMuted(true), true);
  assert.equal(store.getMuted(), true);
});

test('recordRun and setLook keep the mute flag', () => {
  const ls = fakeStorage();
  const a = L.createStore(() => ls);
  a.setMuted(true);
  a.recordRun(30);
  a.setLook(L.DEFAULT_LOOK);
  assert.equal(L.createStore(() => ls).getMuted(), true);
});
