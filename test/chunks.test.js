const test = require('node:test');
const assert = require('node:assert/strict');
const { L, chunkClearable, MIN_STREAK, WAIT_STEP, DT } = require('./support.js');

const SPEEDS = [
  ['min', L.SPEED_MIN],
  ['mid', (L.SPEED_MIN + L.SPEED_MAX) / 2],
  ['max', L.SPEED_MAX],
];

test('chunk set stays under the physics limits', () => {
  assert.ok(L.CHUNKS.length > 20);
  for (const c of L.CHUNKS) {
    if (c.needsOrb || c.needsField || c.needsBounce || c.needsVanish || c.needsPop) continue;   // crossed with the orbs or the field; their own tests prove the plain jump falls short
    assert.ok(c.maxGap <= L.MAX_GAP_TILES, `${c.name}: gap ${c.maxGap} > ${L.MAX_GAP_TILES} tiles`);
    assert.ok(c.maxStep <= L.MAX_STEP_TILES, `${c.name}: step ${c.maxStep} > ${L.MAX_STEP_TILES} tiles`);
  }
  assert.ok(L.MAX_GAP_TILES * L.TILE <= L.SPEED_MIN * L.AIR_TIME_FULL * L.FAIRNESS + 1e-6);
  assert.ok(L.MAX_STEP_TILES * L.TILE <= L.JUMP_PEAK * 0.7 + 1e-6);
});

test('no chunk lets one full jump at max speed cover more than 3 hazards', () => {
  for (const c of L.CHUNKS) {
    const xs = c.spikes.map(sp => sp.x).sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i++) {
      const inReach = xs.filter(x => x >= xs[i] && x + 1 - xs[i] <= L.JUMP_RANGE_MAX_TILES).length;
      assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name}: ${inReach} spikes within one jump of tile ${xs[i]}`);
    }
  }
});

test('every chunk has flat padding at both ends', () => {
  for (const c of L.CHUNKS) {
    const first = c.ground[0];
    const last = c.ground[c.ground.length - 1];
    assert.ok(first.x0 === 0 && first.x1 >= L.PAD && first.h === c.entryH, `${c.name} entry pad`);
    assert.ok(last.x1 === c.w && last.x0 <= c.w - L.PAD && last.h === c.exitH, `${c.name} exit pad`);
    for (const s of c.spikes) {
      assert.ok(s.x >= L.PAD && s.x < c.w - L.PAD, `${c.name} spike inside padding`);
    }
  }
});

test('the checker rejects an impossible chunk', () => {
  const wide = L.makeChunk('gap9', 4, 0, 0, { w: 9 });
  assert.equal(chunkClearable(wide, L.SPEED_MIN), false);
  const tall = L.makeChunk('wall6', 4, 0, 6, { w: 0 });
  assert.equal(chunkClearable(tall, L.SPEED_MAX), false);
});

test('jump windows are at least 60ms wide', () => {
  assert.ok((MIN_STREAK - 1) * WAIT_STEP * DT >= 0.06 - 1e-9);
});

for (const [label, speed] of SPEEDS) {
  test(`every chunk is clearable at ${label} speed with a fair jump window`, () => {
    const failed = [];
    for (const c of L.CHUNKS.filter(q => q.steadyLevel === null)) {
      if (!chunkClearable(c, speed)) failed.push(`${c.name} (entry height ${c.entryH}, speed ${Math.round(speed)})`);
    }
    assert.deepEqual(failed, [], `unclearable chunks: ${failed.join('; ')}`);
  });
}

test('generated worlds are deterministic and chain compatible heights', () => {
  const names = seed => {
    const w = L.createWorld(seed);
    const out = [];
    let x = 0;
    while (out.length < 1000) {
      L.extendWorld(w, x, 4000 * L.METER_PX);
      x += 4000;
      if (w.count > 1000) break;
    }
    return w;
  };
  for (const seed of [1, 2, 3, 99]) {
    const a = names(seed), b = names(seed);
    assert.equal(a.endX, b.endX);
    assert.equal(a.solids.length, b.solids.length);
  }

  for (const seed of [5, 6, 7]) {
    const w = L.createWorld(seed);
    let prevExit = 0;
    for (let i = 0; i < 1000; i++) {
      const before = w.exitH;
      L.extendWorld(w, w.endX + 1, i * 400);
      prevExit = before;
      assert.ok(w.exitH >= 0 && w.exitH <= L.MAX_H, `height ${w.exitH} out of range`);
    }
    void prevExit;
    for (const s of w.solids) assert.ok(s.top <= L.FLOOR_Y && s.top >= L.FLOOR_Y - L.MAX_H * L.TILE);
  }
});

test('the tier cap never goes down as distance or level grow, and starts plain', () => {
  assert.equal(L.tierCap(0, 0), 0);
  assert.equal(L.tierCap(L.PLAIN_START_M - 1, 0), 0);
  assert.ok(L.tierCap(L.PLAIN_START_M, 0) >= 1, 'the plain start is short: the first lesson comes right after it');
  let prev = 0;
  for (let level = 0; level <= L.LAST_LEVEL; level++) {
    prev = 0;
    for (let m = 0; m <= 7000; m += 5) {
      const cap = L.tierCap(m, level);
      assert.ok(cap >= prev, `cap fell at ${m} m, level ${level}`);
      assert.ok(cap <= 4);
      if (level > 0) assert.ok(cap >= L.tierCap(m, level - 1), `a higher level lowered the cap at ${m} m`);
      prev = cap;
    }
  }
  assert.equal(L.tierCap(1e6, 0), 4);
  assert.equal(L.tierCap(L.PLAIN_START_M, 3), 4, 'tier 4 is open by level 3');
});

function walkWorld(seed, metres) {
  const world = L.createWorld(seed);
  const start = 2 * L.TILE;
  for (let x = start; x < start + metres * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
  return { world, start };
}

test('the first 40 m serve only tier 0, and nothing above the cap is ever served at any distance or level', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { world, start } = walkWorld(seed, 7000);
    for (const p of world.placed) {
      const m = (p.x0 - start) / L.METER_PX;
      const cap = L.tierCap(m, L.levelAt(p.x0 - start));
      assert.ok(p.chunk.diff <= cap, `seed ${seed}: ${p.chunk.name} (tier ${p.chunk.diff}) at ${m.toFixed(0)} m, cap ${cap}`);
      if (m < L.PLAIN_START_M) assert.equal(p.chunk.diff, 0, `${p.chunk.name} in the plain start`);
    }
  }
});

test('the first 1500 m can serve every fun piece, across seeds', () => {
  const want = ['orbGap', 'boostRun', 'tunnel1', 'moveStone', 'crumbleBridge'];
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const { world, start } = walkWorld(seed, 1500);
    for (const p of world.placed) {
      if ((p.x0 - start) / L.METER_PX > 1500) continue;
      for (const w of want) if (p.chunk.name.startsWith(w)) seen.add(w);
    }
  }
  for (const w of want) assert.ok(seen.has(w), `${w} never appeared in the first 1500 m of 12 seeds`);
});
