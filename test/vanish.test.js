const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, idle, cueBotClears, chunkClearable } = require('./support.js');
const { closure } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);
const vanishChunks = () => L.CHUNKS.filter(c => c.needsVanish);

test('a vanishing floor exists for every level and height, in tier 2, built for its own level speed', () => {
  for (let h = 0; h <= L.MAX_H; h++) for (let k = 0; k <= L.LAST_LEVEL; k++) {
    const c = chunk(`vanish${k}@${h}`);
    assert.ok(c, `vanish${k}@${h}`);
    assert.equal(c.diff, 2);
    assert.equal(c.steadyLevel, k);
    assert.equal(c.minLevel, 0);
    assert.equal(c.vanish.length, 1);
    assert.equal(c.cue.length, 1);
    assert.equal(c.cue[0].kind, 'jump');
  }
});

test('the chunk holds the floor, the gap and the gems and nothing else, with a run-up before the first trigger', () => {
  for (const c of vanishChunks()) {
    assert.equal(c.spikes.length + c.platforms.length + c.moving.length + c.crumble.length + c.ceilings.length + c.pads.length + c.orbs.length + c.fields.length + c.warps.length + c.walls.length + c.flips.length + c.boxes.length + c.bounces.length + c.pickups.length + c.gates.length, 0, c.name);
    assert.equal(c.ground.length, 2, `${c.name}: floor, gap, landing`);
    const q = c.vanish[0];
    assert.equal(q.x, c.ground[0].x1, `${c.name}: the vanishing stretch starts where the floor stops`);
    assert.equal(q.x + q.w, c.ground[1].x0);
    assert.ok(q.x - L.VANISH_TRIGGER_TILES >= 2, `${c.name}: only ${q.x - L.VANISH_TRIGGER_TILES} tiles of run-up before the trigger`);
    assert.ok(c.w - (q.x + q.w) >= 8, `${c.name}: landing`);
  }
});

test('the floor starts to go at least half a second ahead of the edge at the top speed with a boost, and the gems are in view long before', () => {
  assert.ok((L.VANISH_TRIGGER_TILES * L.TILE) / (L.SPEED_MAX * L.BOOST_MUL) >= 0.5);
  for (const c of vanishChunks()) {
    const world = buildWorld([c]);
    const q = world.vanish[0];
    assert.equal(q.x0 - q.trigger, L.VANISH_TRIGGER_TILES * L.TILE);
    assert.ok(q.trigger >= world.placed[0].x0 + 2 * L.TILE, `${c.name}: trigger inside the run-up`);
    const first = world.guides[0];
    assert.ok(q.x0 - first.x < L.VIEW_AHEAD_PX, 'the first gem is in view of the trigger');
    assert.ok(world.guides.length >= 3, `${c.name}: ${world.guides.length} gems`);
  }
});

test('the gap is plain geometry: no ground under it, a walker falls', () => {
  for (const c of vanishChunks().filter(q => q.entryH === 0)) {
    const speed = L.levelSpeed(c.steadyLevel);
    const world = buildWorld([c]);
    const q = world.vanish[0];
    assert.ok(!world.solids.some(s => s.x0 < q.x1 && s.x1 > q.x0), `${c.name}: ground under the vanishing floor`);
    const r = idle(L.newCube(2 * L.TILE, 0), world, speed, world.endX - 8 * L.TILE);
    assert.equal(r.dead, true);
    assert.ok(['void', 'wall'].includes(r.reason), r.reason);   // it drops into the gap and meets the far side or the bottom
  }
});

test('following the gems clears it with a 67 ms window and never touches the floor after it goes; a press far off the gems dies', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) for (const h of [0, 3]) {
    const c = chunk(`vanish${k}@${h}`);
    const speed = L.levelSpeed(k);
    let best = 0, run = 0;
    for (let w = -60; w <= 60; w++) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, h);
      const q = world.vanish[0];
      let touched = false;
      const orig = L.stepCube;
      const ok = (() => {
        // same walk as the cue bot, watching the cube's feet between the trigger and the far edge
        const cues = [{ x: 8 * L.TILE + c.cue[0].at * L.TILE, fired: -1 }];
        for (let i = 0; i < 1500; i++) {
          let pressed = false, held = false;
          const at = cube.x + L.CUBE / 2 - w * speed * DT;
          if (cues[0].fired < 0 && at >= cues[0].x) { cues[0].fired = i; pressed = true; }
          if (cues[0].fired >= 0 && i < cues[0].fired + c.cue[0].hold) held = true;
          const ev = orig(cube, world, { pressed, held }, DT, speed);
          if (ev.dead) return false;
          const centre = cube.x + L.CUBE / 2;
          if (cube.onGround && centre > q.x0 + L.CUBE / 2 && centre < q.x1 - L.CUBE / 2) touched = true;
          if (cube.x >= world.endX - 8 * L.TILE) return true;
        }
        return false;
      })();
      if (ok) { run++; best = Math.max(best, run); assert.equal(touched, false, `${c.name} wobble ${w}: stood on the vanished floor`); } else run = 0;
    }
    assert.ok(best < 121, 'a press far off the gems must die');
    assert.ok(best * DT >= 0.067, `${c.name}: cue window only ${(best * DT * 1000).toFixed(0)} ms`);
    assert.ok(cueBotClears(c, speed, 0));
  }
});

test('where the state comes from: stepCube never reads the vanishing floor or a clock, so the run is identical with and without it', () => {
  const src = L.stepCube.toString();
  assert.ok(!/vanish/.test(src));
  assert.ok(!/Date|performance|now\(/.test(src));
  const c = chunk('vanish3@0');
  const speed = L.levelSpeed(3);
  const a = buildWorld([c]), b = buildWorld([c]);
  b.vanish = [];
  assert.equal(a.vanish.length, 1);
  const rng = L.mulberry32(5);
  for (let run = 0; run < 20; run++) {
    const x = L.newCube(2 * L.TILE, 0), y = L.newCube(2 * L.TILE, 0);
    let held = false;
    for (let i = 0; i < 1500; i++) {
      const pressed = rng() < 0.03;
      if (pressed) held = true;
      if (held && rng() < 0.05) held = false;
      const ea = step(x, a, held, pressed, speed), eb = step(y, b, held, pressed, speed);
      assert.deepEqual(x, y, `step ${i}`);
      assert.deepEqual(ea, eb);
      if (ea.dead) break;
    }
  }
});

test('the planner clears it at its own speed, and the closure proves it with neighbours at three speeds', () => {
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(chunk(`vanish${k}@0`), L.levelSpeed(k)), `level ${k}`);
  const fam = new Set(['flat', 'spike1', 'spike3', 'gap3', 'vanish0', 'vanish3', 'vanish6', 'tunnel1', 'shieldDrop', 'floatGap3']);
  for (const k of [0, 3, 6]) {
    const r = closure(L.levelSpeed(k), { filter: c => fam.has(c.name.split('@')[0]) });
    assert.equal(r.startOk, true, `level ${k}: ${(r.witness || []).join(' > ')}`);
  }
});

test('vanishing floors are pruned with the world and appear in generated worlds at every level', () => {
  const seen = new Set();
  for (const seed of [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    for (const p of world.placed) if (p.chunk.needsVanish) seen.add(p.chunk.steadyLevel);
    const n = world.vanish.length;
    L.pruneWorld(world, world.endX - 10 * L.TILE);
    assert.ok(world.vanish.length <= n);
  }
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(seen.has(k), `no vanishing floor for level ${k}; seen ${[...seen]}`);
});

test('rage-bait traps keep at least 40 tiles of other track between them in generated worlds', () => {
  let traps = 0;
  for (const seed of [81, 82, 83, 84, 85, 86]) {
    const world = L.createWorld(seed);
    const start = 2 * L.TILE;
    for (let x = start; x < start + 7000 * L.METER_PX; x += 400) L.extendWorld(world, x, x - start);
    let lastEnd = -1e9;
    for (const p of world.placed) {
      if (!p.chunk.trap) continue;
      traps++;
      assert.ok(p.x0 - lastEnd >= L.TRAP_MIN_GAP_TILES * L.TILE - 1e-6, `seed ${seed}: traps ${(p.x0 - lastEnd) / L.TILE} tiles apart`);
      lastEnd = p.x1;
    }
  }
  assert.ok(traps >= 6, `only ${traps} traps in the test worlds`);
});
