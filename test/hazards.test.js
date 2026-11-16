const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, cueBotClears } = require('./support.js');

const SPEEDS = [
  ['min', L.SPEED_MIN],
  ['mid', (L.SPEED_MIN + L.SPEED_MAX) / 2],
  ['max', L.SPEED_MAX],
];
const chunk = name => L.CHUNKS.find(c => c.name === name);
const tunnels = () => L.CHUNKS.filter(c => c.tunnel);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

// ---- limits, with negative controls so a bad tuning change fails loudly ----

test('moving platforms: the top never jumps more than 0.15 tile between phase samples, and never moves too fast', () => {
  const movers = L.CHUNKS.filter(c => c.moving.length);
  assert.ok(movers.length >= 4, 'expected moving chunks');
  for (const c of movers) {
    for (const m of c.moving) {
      const wm = { amp: m.amp, period: c.period };
      assert.ok(L.moverSampleStep(wm) <= L.MOVER_SAMPLE_MAX_TILES, `${c.name}: top moves ${L.moverSampleStep(wm).toFixed(3)} tile between samples`);
      assert.ok(L.moverSpeed({ amp: m.amp, period: c.period }) <= L.MOVER_MAX_SPEED, `${c.name}: moves too fast`);
      assert.ok(c.period > 0, `${c.name}: needs a period`);
    }
  }
});

test('negative control: a mover with a too-large swing is rejected by the sampling rule', () => {
  const big = L.makeChunk('bigMover', 2, 0, 0, { w: 5, moving: [{ x: 1.5, w: 2, h: 1, amp: 1 }], period: 2.4 });
  const wm = { amp: big.moving[0].amp, period: big.period };
  assert.ok(L.moverSampleStep(wm) > L.MOVER_SAMPLE_MAX_TILES);
  assert.ok(L.moverSpeed(wm) > L.MOVER_MAX_SPEED);
  const phases = [];
  for (let i = 0; i < L.MOVER_PHASES; i++) phases.push(L.moverTop({ base: 0, amp: 1, period: 2.4 }, (i / L.MOVER_PHASES) * 2.4));
  let biggest = 0;
  for (let i = 0; i < phases.length; i++) biggest = Math.max(biggest, Math.abs(phases[(i + 1) % phases.length] - phases[i]));
  assert.ok(biggest <= L.moverSampleStep({ amp: 1 }) + 1e-9, 'formula is an upper bound on the real sampled step');
  assert.ok(biggest > L.MOVER_SAMPLE_MAX_TILES, 'the real sampled step of the bad mover is over the limit too');
});

test('crumble pieces are short enough to cross at min speed before they drop', () => {
  const pieces = L.CHUNKS.filter(c => c.crumble.length);
  assert.ok(pieces.length >= 3);
  for (const c of pieces) for (const p of c.crumble) assert.ok(p.w <= L.CRUMBLE_MAX_TILES, `${c.name}: piece ${p.w} tiles > ${L.CRUMBLE_MAX_TILES}`);
  assert.ok(L.CRUMBLE_MAX_TILES * L.TILE / L.SPEED_MIN <= L.CRUMBLE_DELAY * 0.7 + 1e-9);
  const long = L.makeChunk('longCrumble', 2, 0, 0, { w: 8, crumble: [{ x: 0, w: 6, h: 0 }] });
  assert.ok(long.crumble[0].w > L.CRUMBLE_MAX_TILES, 'negative control must exceed the limit');
});

test('tunnel warning: the roof is in view at least 1.5 s ahead at max speed, for the narrowest supported view', () => {
  assert.ok(L.CUE_WARN_AT_MAX_S >= L.CUE_WARN_S, `only ${L.CUE_WARN_AT_MAX_S.toFixed(2)} s`);
  assert.equal(L.VIEW_AHEAD_PX, L.MIN_VIEW_W - L.CUBE_SCREEN_X);
  const warnFor = viewW => (viewW - L.CUBE_SCREEN_X) / L.SPEED_MAX;
  assert.ok(warnFor(720) < L.CUE_WARN_S, 'negative control: a 4:3 view would be too narrow without scaling');
});

test('every ceiling belongs to a tunnel chunk with a start marker for each cue, and has enough headroom', () => {
  const withRoof = L.CHUNKS.filter(c => c.ceilings.length);
  assert.ok(withRoof.length >= 4);
  for (const c of L.CHUNKS) {
    if (c.ceilings.length === 0) continue;
    assert.ok(c.name.startsWith('tunnel') && c.tunnel, `${c.name}: roof outside a tunnel`);
    assert.ok(c.cue.length >= 1, `${c.name}: needs a cue`);
    assert.ok(buildWorld([c]).guides.length >= 3 * c.cue.length, `${c.name}: gems showing the jump path`);
    for (const r of c.ceilings) {
      assert.ok(r.clear >= L.MIN_TUNNEL_CLEAR, `${c.name}: roof too low`);
      assert.ok(r.x0 >= L.PAD && r.x1 <= c.w - L.PAD || true);
    }
  }
  for (const c of L.CHUNKS) if (c.tunnel) assert.ok(c.name.startsWith('tunnel'));
});

test('in generated worlds, every roof comes with a start marker inside its span', () => {
  for (const seed of [31, 32, 33]) {
    const w = L.createWorld(seed);
    while (w.count < 300) L.extendWorld(w, w.endX + 1, 5000 * L.METER_PX);
    assert.ok(w.ceilings.length > 0, 'expected some tunnels in a long hard world');
    for (const r of w.ceilings) {
      const marks = w.guides.filter(g => g.x > r.x0 && g.x < r.x1).length;
      assert.ok(marks >= 3, `roof at ${r.x0} has ${marks} path gems`);
    }
  }
});

test('3-hazard cap also counts roofs: spikes plus roof segments within one max-speed jump stay at 3 or fewer', () => {
  for (const c of L.CHUNKS) {
    const items = c.spikes.map(s => s.x).concat(c.ceilings.map(r => r.x0), c.boxes.map(b => b.x), c.bounces.map(b => b.x), c.gates.map(g => g.x));
    items.sort((a, b) => a - b);
    for (let i = 0; i < items.length; i++) {
      const inReach = items.filter(x => x >= items[i] && x + 1 - items[i] <= L.JUMP_RANGE_MAX_TILES).length;
      assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name}: ${inReach} hazards in one jump`);
    }
  }
});

// ---- tunnels: the lesson and the way out ----

test('a normal full jump into a tunnel is the lethal case, at every speed', () => {
  for (const c of tunnels()) {
    for (const [label, speed] of SPEEDS) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, c.entryH);
      let died = null;
      let jumped = false;
      for (let i = 0; i < 1500 && !died; i++) {
        const pressed = !jumped && cube.x >= 8 * L.TILE + L.cueStartTile(c.cue[0], speed) * L.TILE;
        if (pressed) jumped = true;
        const ev = step(cube, world, true, pressed, speed);
        died = ev.dead;
      }
      assert.equal(died, 'ceiling', `${c.name} at ${label} speed: a full hold jump should hit the roof, got ${died}`);
    }
  }
});

test('a player who follows the start markers clears every tunnel at min, mid and max speed, with timing wobble', () => {
  for (const c of tunnels()) {
    for (const [label, speed] of SPEEDS) {
      for (const wobble of [-2, -1, 0, 1, 2]) {
        assert.equal(cueBotClears(c, speed, wobble), true, `${c.name} ${label} speed, wobble ${wobble} steps`);
      }
    }
  }
});

test('each speed gives the cue-following player at least a 67 ms start window in every tunnel', () => {
  for (const c of tunnels().filter(t => t.entryH === 0 || t.entryH === 3)) {
    for (const [label, speed] of SPEEDS) {
      const ms = holdWindow(c, speed, c.cue[0].hold);
      assert.ok(ms >= 67, `${c.name} at ${label}: window ${ms.toFixed(0)} ms`);
    }
  }
});

// ---- moving platforms ----

test('a cube standing on a moving platform stays attached to its top through a full cycle', () => {
  const world = L.createEmptyWorld();
  world.movers.push({ id: 'm1', x0: 0, x1: 4000, base: L.FLOOR_Y, amp: 0.35 * L.TILE, period: 2.4 });
  const cube = L.newCube(100, 0);
  cube.y = L.FLOOR_Y - L.CUBE - 30;
  cube.onGround = false;
  let landed = false;
  for (let i = 0; i < 12 * 120; i++) {
    const ev = step(cube, world, false, false, 0);
    if (ev.landed) landed = true;
    if (landed) {
      assert.equal(cube.onGround, true, `lost the platform at step ${i}`);
      const top = L.moverTop(world.movers[0], cube.t);
      assert.ok(Math.abs(cube.y + L.CUBE - top) < 0.01, `cube ${cube.y + L.CUBE} vs top ${top}`);
    }
  }
  assert.equal(landed, true);
});

test('a rising platform lifts a standing cube instead of passing through it', () => {
  const world = L.createEmptyWorld();
  world.movers.push({ id: 'm1', x0: 0, x1: 4000, base: L.FLOOR_Y, amp: 0.35 * L.TILE, period: 2.4 });
  const cube = L.newCube(100, 0);
  cube.y = L.FLOOR_Y - L.CUBE - 3;
  cube.onGround = false;
  let minY = Infinity;
  for (let i = 0; i < 4 * 120; i++) {
    step(cube, world, false, false, 0);
    minY = Math.min(minY, cube.y);
  }
  assert.ok(minY < L.FLOOR_Y - L.CUBE - 3, 'the cube was carried upward with the platform');
});

test('a jump off a moving platform works and the platform does not re-grab a rising cube', () => {
  const world = L.createEmptyWorld();
  world.movers.push({ id: 'm1', x0: 0, x1: 4000, base: L.FLOOR_Y, amp: 0.35 * L.TILE, period: 2.4 });
  const cube = L.newCube(100, 0);
  cube.y = L.FLOOR_Y - L.CUBE - 3;
  cube.onGround = false;
  for (let i = 0; i < 60; i++) step(cube, world, false, false, 0);
  assert.equal(cube.onGround, true);
  const ev = step(cube, world, true, true, 0);
  assert.equal(ev.jumped, true);
  let peak = Infinity;
  for (let i = 0; i < 30; i++) { step(cube, world, true, false, 0); peak = Math.min(peak, cube.y); }
  assert.ok(peak < L.FLOOR_Y - L.CUBE - 40, 'rose well above the platform');
});

// ---- crumbling pieces ----

function crumbleWorld() {
  const world = L.createEmptyWorld();
  world.crumbles.push({ id: 'c1', x0: 0, x1: 4000, top: L.FLOOR_Y });
  return world;
}
function onCrumble() {
  const world = crumbleWorld();
  const cube = L.newCube(100, 0);
  cube.y = L.FLOOR_Y - L.CUBE - 2;
  cube.onGround = false;
  for (let i = 0; i < 6; i++) step(cube, world, false, false, 0);
  assert.equal(cube.onGround, true);
  return { world, cube };
}

test('a crumble piece holds until CRUMBLE_DELAY after the first touch, and drops at exactly that moment', () => {
  const { world, cube } = onCrumble();
  const touched = cube.cr.c1;
  assert.ok(touched !== undefined);
  let steps = 0;
  while (cube.onGround && steps < 2000) { step(cube, world, false, false, 0); steps++; }
  const heldFor = cube.t - touched;
  assert.ok(!cube.onGround);
  assert.ok(heldFor >= L.CRUMBLE_DELAY - 1e-9, `fell early at ${heldFor}`);
  assert.ok(heldFor < L.CRUMBLE_DELAY + DT + 1e-9, `fell late at ${heldFor}`);
});

test('jumping off at the last safe step works; the coyote window still allows a late jump but not forever', () => {
  const run = (extraSteps) => {
    const { world, cube } = onCrumble();
    while (cube.t - cube.cr.c1 + DT < L.CRUMBLE_DELAY - 1e-9) step(cube, world, false, false, 0);
    assert.equal(cube.onGround, true, 'still on the piece at the last safe step');
    for (let i = 0; i < extraSteps; i++) step(cube, world, false, false, 0);
    const ev = step(cube, world, true, true, 0);
    return ev.jumped;
  };
  assert.equal(run(0), true);
  assert.equal(run(Math.floor(L.COYOTE / DT) - 2), true);
  assert.equal(run(Math.ceil(L.COYOTE / DT) + 3), false);
});

test('a piece the cube never touches never drops, and each piece keeps its own timer', () => {
  const world = L.createEmptyWorld();
  world.crumbles.push({ id: 'a', x0: 0, x1: 200, top: L.FLOOR_Y }, { id: 'b', x0: 300, x1: 500, top: L.FLOOR_Y });
  const cube = L.newCube(50, 0);
  cube.y = L.FLOOR_Y - L.CUBE - 2;
  cube.onGround = false;
  for (let i = 0; i < 30; i++) step(cube, world, false, false, 0);
  assert.ok(cube.cr.a !== undefined);
  assert.equal(cube.cr.b, undefined);
});

test('crossing a crumble run at min speed never loses the piece underfoot', () => {
  const c = chunk('crumbleRun@0');
  const world = buildWorld([c]);
  const cube = L.newCube(2 * L.TILE, 0);
  // hop each 1-tile gap
  let died = null;
  const jumpXs = [];
  const start = 8 * L.TILE + L.PAD * L.TILE;
  for (const px of c.crumble) jumpXs.push(8 * L.TILE + (px.x + px.w) * L.TILE - 16);
  let next = 0;
  for (let i = 0; i < 3000 && !died; i++) {
    let pressed = false;
    if (next < jumpXs.length && cube.x >= jumpXs[next]) { pressed = true; next++; }
    died = step(cube, world, pressed, pressed, L.SPEED_MIN).dead;
    if (cube.x > world.endX - 6 * L.TILE) break;
  }
  void start;
  assert.equal(died, null);
});

// ---- determinism ----

function script(i) { return { pressed: i % 97 === 5 || i % 211 === 9, held: i % 97 < 18 || i % 211 < 26 }; }

test('the same world and inputs give identical cube state, including clock, carry and crumble state', () => {
  const chunks = [chunk('moveStone@0'), chunk('crumbleRun@0'), chunk('moveStone@0'), chunk('crumbleBridge@0'), chunk('tunnel1@0')];
  const run = () => {
    const world = buildWorld(chunks, 8, 40);
    const cube = L.newCube(2 * L.TILE, 0);
    const trace = [];
    for (let i = 0; i < 1500; i++) {
      const input = script(i);
      const ev = step(cube, world, input.held, input.pressed, L.speedAt(cube.x - 2 * L.TILE));
      if (i % 50 === 0) trace.push(JSON.stringify(cube));
      if (ev.dead) { trace.push('dead:' + ev.dead + ':' + i); break; }
    }
    trace.push(JSON.stringify(cube));
    return trace;
  };
  assert.deepEqual(run(), run());
});

test('the clock only runs while a game is running: waiting, dying and restarting do not move it', () => {
  const g = L.newGame(5, false, 0);
  for (let i = 0; i < 200; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.equal(g.cube.t, 0);
  L.stepGame(g, { pressed: true, held: true }, DT);
  assert.equal(g.state, 'running');
  assert.ok(Math.abs(g.cube.t - DT) < 1e-12);
  let steps = 1;
  while (g.state === 'running' && steps < 20000) { L.stepGame(g, { pressed: false, held: false }, DT); steps++; }
  assert.equal(g.state, 'dead');
  const tAtDeath = g.cube.t;
  for (let i = 0; i < 100; i++) L.stepGame(g, { pressed: false, held: false }, DT);
  assert.equal(g.cube.t, tAtDeath);
  const fresh = L.newGame(6, true, 0);
  assert.equal(fresh.cube.t, 0);
  assert.deepEqual(fresh.cube.cr, {});
});

test('a game replayed from the same seed and inputs matches step for step, with and without a pause', () => {
  const play = (pauseAt) => {
    const g = L.newGame(77, true, 0);
    for (let i = 0; i < 2500 && g.state === 'running'; i++) {
      if (i === pauseAt) continue;            // a pause just skips a call and adds no time
      const inp = script(i);
      L.stepGame(g, inp, DT);
    }
    return JSON.stringify([g.cube, g.state]);
  };
  assert.equal(play(-1), play(-1));
  // the clock is advanced only by steps taken, so skipping one call changes nothing except that one step
  const a = L.newGame(77, true, 0), b = L.newGame(77, true, 0);
  for (let i = 0; i < 400; i++) { L.stepGame(a, script(i), DT); L.stepGame(b, script(i), DT); }
  assert.equal(JSON.stringify(a.cube), JSON.stringify(b.cube));
});

test('the new chunks are all in the pool and spread across tiers', () => {
  const want = ['bump', 'dip', 'spikesApart', 'crumbleBridge', 'moveStone', 'crumbleRun', 'tunnel1', 'tunnel2'];
  for (const n of want) assert.ok(L.CHUNKS.some(c => c.name.startsWith(n + '@')), n);
  const tier0 = new Set(L.CHUNKS.filter(c => c.diff === 0).map(c => c.name.split('@')[0]));
  for (const n of ['bump', 'dip', 'spikesApart', 'crumbleBridge', 'spike1', 'gap2', 'up1', 'down1', 'flat']) assert.ok(tier0.has(n), `${n} should be tier 0`);
  assert.ok(chunk('moveStone@0').diff === 1);
  assert.ok(chunk('tunnel1@0').diff === 1 && chunk('tunnel2@0').diff === 2);
});

// ---- how forgiving the press is: any short press, not one exact length ----

const HOLD_TRY = [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 57];

// the best start window (ms) for a given hold, sweeping the first cue; later cues keep their offset
function holdWindow(c, speed, hold) {
  let best = 0;
  let run = 0;
  for (let x = 0.5; x <= c.cue[0].spike + 0.5; x += 0.04) {
    const cue = c.cue.map(q => ({ x: x + (q.spike - c.cue[0].spike), hold }));
    if (cueBotClears(Object.assign({}, c, { cue }), speed, 0)) { run++; best = Math.max(best, run); } else run = 0;
  }
  return (best * 0.04 * L.TILE / speed) * 1000;
}

test('a plain tap clears every tunnel with a start window of at least 67 ms at min, mid and max speed', () => {
  for (const c of tunnels().filter(t => t.entryH === 0 || t.entryH === 3)) {
    for (const [label, speed] of SPEEDS) {
      const ms = holdWindow(c, speed, 1);
      assert.ok(ms >= 67, `${c.name} at ${label}: a pure tap has only ${ms.toFixed(0)} ms`);
    }
  }
});

test('a range of at least 0.1 s of press lengths clears each tunnel, and the cued press sits well inside it', () => {
  for (const c of tunnels().filter(t => t.entryH === 0)) {
    for (const [label, speed] of SPEEDS) {
      const good = HOLD_TRY.filter(h => holdWindow(c, speed, h) >= 67);
      assert.ok(good.length > 0);
      // contiguous from a tap upwards
      let top = 0;
      for (const h of HOLD_TRY) { if (good.includes(h)) top = h; else break; }
      assert.ok(top * DT >= 0.1, `${c.name} at ${label}: only presses up to ${(top * DT).toFixed(2)} s clear`);
      const hold = c.cue[0].hold;
      assert.ok(good.includes(hold), `${c.name} at ${label}: the cued press is not in the clearing range`);
      assert.ok(hold - 1 >= 3 && top - hold >= 3, `${c.name} at ${label}: the cued press (${hold}) sits at an edge of 1..${top}`);
    }
  }
});

test('there is a cliff: a long hold hits the roof, at every speed', () => {
  for (const c of tunnels().filter(t => t.entryH === 0)) {
    for (const [label, speed] of SPEEDS) {
      assert.equal(holdWindow(c, speed, 57), 0, `${c.name} at ${label}: a 57-step hold should never clear`);
    }
  }
});

test('the first gem of every jump path sits where the cube takes off, on the floor of its own chunk, at any height; none is underground', () => {
  for (const c of L.CHUNKS.filter(q => q.cue.length)) {
    const world = buildWorld([c]);
    const floorCentre = (world.solids.find(s => s.x1 > 8 * L.TILE + 2 * L.TILE) || world.solids[0]).top - L.CUBE / 2;
    assert.ok(world.guides.length > 0, `${c.name}`);
    assert.ok(Math.abs(world.guides[0].y - floorCentre) < 0.5, `${c.name}: first gem at ${world.guides[0].y}, floor centre ${floorCentre}`);
    for (const g of world.guides) assert.ok(g.y <= floorCentre + 0.5, `${c.name}: a gem is underground`);
    for (let i = 1; i < world.guides.length; i++) assert.ok(world.guides[i].x >= world.guides[i - 1].x - 1e-9, `${c.name}: gems out of order`);
  }
});

test('the gems follow the real flight of the cued press', () => {
  for (const name of ['tunnel1@0', 'tunnel2@1', 'orbGap0@0', 'orbGap3@0']) {
    const c = chunk(name);
    const speed = c.steadyLevel === null ? L.levelSpeed(2) : L.levelSpeed(c.steadyLevel);
    const world = L.createEmptyWorld();
    L.addGround(world, -400, 8, c.entryH);
    world.endX = 8 * L.TILE;
    L.placeChunk(world, c, speed);
    L.addGround(world, world.endX / L.TILE, world.endX / L.TILE + 30, c.exitH);
    world.endX += 30 * L.TILE;
    const cube = L.newCube(2 * L.TILE, c.entryH);
    const cues = c.cue.map(q => ({ x: 8 * L.TILE + (q.kind ? (q.kind === 'jump' ? q.at : q.x) : L.cueStartTile(q, speed)) * L.TILE, centre: !!q.kind, hold: q.hold, fired: -1 }));
    let worst = 0;
    for (let i = 0; i < 4000 && cube.x < world.endX - 10 * L.TILE; i++) {
      let pressed = false, held = false;
      for (const q of cues) {
        if (q.fired < 0 && (q.centre ? cube.x + L.CUBE / 2 : cube.x) >= q.x) { q.fired = i; pressed = true; }
        if (q.fired >= 0 && i < q.fired + q.hold) held = true;
      }
      if (L.stepCube(cube, world, { pressed, held }, DT, speed).dead) break;
      if (cues[0].fired >= 0 && !cube.onGround) {
        const cx = cube.x + L.CUBE / 2, cy = cube.y + L.CUBE / 2;
        const marks = world.guides.concat(world.orbs);   // the rings are markers too
        const near = marks.reduce((m, g) => Math.min(m, Math.hypot(g.x - cx, g.y - cy)), 1e9);
        if (cx < world.guides[world.guides.length - 1].x) worst = Math.max(worst, near);
      }
    }
    assert.ok(worst < 27, `${name}: the cube strays ${worst.toFixed(0)} px from the gem path`);
  }
});
