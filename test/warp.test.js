const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, plan, chunkClearable, driveTo } = require('./support.js');

const warpChunks = () => L.CHUNKS.filter(c => c.warps.length);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);

function levelSpeeds() {
  const out = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) {
    out.push({ label: `level ${k}`, speed: L.levelSpeed(k) });
    if (k > 0) for (const f of [0.15, 0.5, 0.85]) {
      const e = f * f * (3 - 2 * f);
      out.push({ label: `between ${k - 1} and ${k} at ${f}`, speed: L.levelSpeed(k - 1) + (L.levelSpeed(k) - L.levelSpeed(k - 1)) * e });
    }
  }
  return out;
}

test('there is a warp lesson at level 0 and harder forms with studs and a gap', () => {
  const names = warpChunks().map(c => c.name);
  for (const base of ['warpWall', 'warpSpike', 'warpGap']) for (let h = 0; h <= L.MAX_H; h++) assert.ok(names.includes(`${base}@${h}`), `${base}@${h}`);
  const wall = L.CHUNKS.find(c => c.name === 'warpWall@0');
  assert.equal(wall.diff, 1);
  assert.equal(wall.minLevel, 0);
  assert.ok(L.CHUNKS.find(c => c.name === 'warpSpike@0').diff === 2 && L.CHUNKS.find(c => c.name === 'warpGap@0').diff === 2);
});

test('portals sit on flat ground with a flat landing, and never share a chunk with a field, pad, orb or roof', () => {
  for (const c of warpChunks()) {
    assert.equal(c.warps.length, 1);
    assert.equal(c.entryH, c.exitH);
    const q = c.warps[0];
    assert.ok(q.a >= L.PAD + 1 && q.b > q.a + 3, `${c.name}: portal spacing`);
    assert.equal(c.fields.length + c.pads.length + c.orbs.length + c.ceilings.length + c.moving.length + c.crumble.length, 0, `${c.name}: mixed with another mechanic`);
    for (const s of c.spikes) assert.ok(s.x < q.a - 3 || s.x > q.b + 3, `${c.name}: a stud on a portal`);
    // flat ground under both portals and the wall
    for (const x of [q.a, q.b, c.walls[0].x]) assert.ok(c.ground.some(g => x >= g.x0 && x < g.x1 && g.h === c.entryH), `${c.name}: ground at ${x}`);
    // a landing zone of at least 10 flat tiles after B (a gap or stud is allowed further on in the harder forms)
    const lastGround = c.ground[c.ground.length - 1];
    assert.ok(lastGround.x1 - q.b >= 10 || c.name.startsWith('warpGap'), `${c.name}: landing`);
  }
});

test('the wall is too tall for any jump: full hold in anti-gravity off a ring stays a tile under it', () => {
  const apex = Math.max(...L.hopHeights(114, 900, L.FLOAT_GRAVITY));
  const ringLift = (0.5 + L.ORB_RING_H) * L.TILE;
  assert.ok(L.WARP_WALL_H * L.TILE - (apex + ringLift) >= L.TILE, `apex ${apex.toFixed(0)} px`);
});

test('without its portals the wall kills, at every level speed, including a boosted one', () => {
  for (const c of warpChunks().filter(q => q.entryH === 0)) {
    for (const { label, speed } of levelSpeeds()) {
      const world = buildWorld([c]);
      world.warps = [];
      const cube = L.newCube(2 * L.TILE, 0);
      const ok = c.name.startsWith('warpWall') ? driveTo(cube, world, speed, world.endX - 8 * L.TILE) : false;
      if (c.name.startsWith('warpWall')) assert.equal(ok, false, `${c.name} at ${label} cleared without a portal`);
    }
  }
});

test('no jump of any length or timing gets over the wall, even in anti-gravity at boosted top speed', () => {
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  for (const anti of [false, true]) {
    for (const speed of [L.SPEED_MIN, L.SPEED_MAX * L.BOOST_MUL]) {
      for (const hold of [1, 20, 57, 114]) {
        for (let wait = 0; wait < 400; wait += 4) {
          const world = buildWorld([c]);
          world.warps = [];
          if (anti) world.fields.push({ kind: 'anti', x0: -1e5, x1: 1e6 });
          const cube = L.newCube(2 * L.TILE, 0);
          let dead = null;
          for (let i = 0; i < 2500 && !dead && cube.x < world.endX - 8 * L.TILE; i++) dead = step(cube, world, i >= wait && i < wait + hold, i === wait, speed).dead;
          assert.ok(dead, `wait ${wait} hold ${hold} speed ${Math.round(speed)} anti ${anti}: got over the wall`);
        }
      }
    }
  }
});

test('running straight through warps exactly once and lands on the far side, at every height', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = L.CHUNKS.find(q => q.name === `warpWall@${h}`);
    for (const { label, speed } of levelSpeeds()) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, h);
      let warps = 0;
      for (let i = 0; i < 3000 && cube.x < world.endX - 6 * L.TILE; i++) {
        const ev = step(cube, world, false, false, speed);
        assert.equal(ev.dead, null, `died at ${label}, height ${h}`);
        if (ev.warp) warps++;
      }
      assert.equal(warps, 1, `${label}, height ${h}: ${warps} warps`);
      assert.ok(cube.onGround);
    }
  }
});

test('a cube in the air at the portal and one on the floor both warp once and land safely', () => {
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  for (const speed of [L.SPEED_MIN, L.levelSpeed(3), L.SPEED_MAX]) {
    for (const hold of [1, 12, 40, 114]) {
      // press times chosen so the cube is on the floor, rising, at the top and falling as it crosses the portal
      let airborneAtPortal = 0;
      const crossing = Math.round((buildWorld([c]).warps[0].ax - 2 * L.TILE) / (speed * DT));
      for (let wait = 0; wait < crossing + 10; wait += 2) {
        const world = buildWorld([c]);
        const cube = L.newCube(2 * L.TILE, 0);
        let warps = 0, landedAfter = false;
        let dead = null;
        for (let i = 0; i < 3000 && (cube.x < world.endX - 6 * L.TILE || !cube.onGround) && !dead; i++) {
          const ev = step(cube, world, i >= wait && i < wait + hold, i === wait, speed);
          dead = ev.dead;
          if (ev.warp) { warps++; if (!cube.onGround) airborneAtPortal++; }
          if (warps && ev.landed) landedAfter = true;
        }
        assert.equal(dead, null, `wait ${wait} hold ${hold} speed ${Math.round(speed)}: died`);
        assert.equal(warps, 1, `wait ${wait}: ${warps} warps`);
        assert.ok(landedAfter || cube.onGround, `wait ${wait}: never landed`);
      }
      assert.ok(airborneAtPortal > 5, `hold ${hold}: only ${airborneAtPortal} airborne warps tested`);
    }
  }
});

test('the teleport moves x only: height and fall speed carry over, and the portal does not fire twice', () => {
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  const world = buildWorld([c]);
  const cube = L.newCube(2 * L.TILE, 0);
  const q = world.warps[0];
  let before = null, after = null;
  for (let i = 0; i < 3000 && !after; i++) {
    const pressed = i === 0;
    const snapY = cube.y;
    const ev = step(cube, world, i < 30, pressed, L.SPEED_MIN);
    if (!before && cube.x > q.ax - 60 && !ev.warp) before = { y: snapY };
    if (ev.warp) after = { y: cube.y, dx: cube.x, snapY };
  }
  assert.ok(after, 'warped');
  assert.ok(Math.abs(after.y - after.snapY) < 12, 'no jump in height at the portal');
  for (let i = 0; i < 400; i++) assert.equal(step(cube, world, false, false, L.SPEED_MIN).warp, undefined);
});

test('a warp is recorded on the cube: clones keep it, and the planner state tells apart before and after', () => {
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  const world = buildWorld([c]);
  const cube = L.newCube(2 * L.TILE, 0);
  while (!step(cube, world, false, false, L.SPEED_MIN).warp);
  const copy = L.cloneCube(cube);
  assert.deepEqual(copy.warps, cube.warps);
  copy.warps['x'] = true;
  assert.equal(cube.warps['x'], undefined);
});

test('every warp chunk is clearable at every level speed and with a level boundary inside it', () => {
  const failed = [];
  for (const c of warpChunks()) {
    for (const { label, speed } of levelSpeeds()) if (!chunkClearable(c, speed)) failed.push(`${c.name} at ${label}`);
    for (let k = 1; k <= L.LAST_LEVEL; k++) {
      // speed eases from the old level to the new one across the first 6 tiles after the boundary; put it mid-chunk
      const x0 = 8 * L.TILE, mid = x0 + (c.w / 2) * L.TILE;
      const fn = x => (x < mid ? L.levelSpeed(k - 1) : x > mid + L.LEVEL_EASE_PX ? L.levelSpeed(k) : L.levelSpeed(k - 1) + ((L.levelSpeed(k) - L.levelSpeed(k - 1)) * (x - mid)) / L.LEVEL_EASE_PX);
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, c.entryH);
      if (plan(cube, world, fn, world.endX - 8 * L.TILE, new Map()) === null) failed.push(`${c.name} across the boundary into level ${k}`);
    }
  }
  assert.deepEqual(failed, [], failed.join('; '));
});

test('the 3-hazard cap holds when the warp is counted as no distance at all', () => {
  for (const { speed } of levelSpeeds()) {
    const range = (speed * L.AIR_TIME_FULL) / L.TILE;
    for (const c of warpChunks()) {
      const q = c.warps[0];
      const skip = q.b - q.a;
      const xs = c.spikes.map(s => (s.x > q.b ? s.x - skip : s.x)).concat(c.ground.length > 1 ? [c.ground[0].x1 - skip] : []).sort((a, b) => a - b);
      for (let i = 0; i < xs.length; i++) {
        const inReach = xs.filter(x => x >= xs[i] && x + 1 - xs[i] <= range).length;
        assert.ok(inReach <= L.MAX_HAZARDS_PER_JUMP, `${c.name}: ${inReach} hazards in one jump`);
      }
    }
  }
});

test('the skipped distance is small, so warping cannot inflate the score', () => {
  for (const c of warpChunks()) {
    const q = c.warps[0];
    assert.ok(((q.b - q.a) * L.TILE) / L.METER_PX <= 4, `${c.name}: skips ${((q.b - q.a) * L.TILE) / L.METER_PX} m`);
  }
  // and a whole run through the lesson scores the same distance as walking it, give or take that skip
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  const g = L.newGame(1, true, 0, [c]);
  let sawWarp = 0;
  for (let i = 0; i < 4000 && g.state === 'running' && g.cube.x < 14 * L.TILE + c.w * L.TILE - 1; i++) {
    const evs = L.stepGame(g, { pressed: false, held: false }, DT);
    sawWarp += evs.filter(e => e === 'warp').length;
  }
  assert.equal(g.state, 'running');
  assert.equal(sawWarp, 1, 'one warp event');
});

test('restarting gives a fresh cube that can warp again', () => {
  const c = L.CHUNKS.find(q => q.name === 'warpWall@0');
  for (let run = 0; run < 2; run++) {
    const g = L.newGame(7 + run, true, 0, [c]);
    let n = 0;
    for (let i = 0; i < 4000 && g.cube.x < 14 * L.TILE + c.w * L.TILE - 1; i++) n += L.stepGame(g, { pressed: false, held: false }, DT).filter(e => e === 'warp').length;
    assert.equal(n, 1);
  }
});

test('warp worlds are deterministic', () => {
  const sig = seed => {
    const w = L.createWorld(seed);
    while (w.count < 200) L.extendWorld(w, w.endX + 1, 5000 * L.METER_PX);
    return JSON.stringify([w.warps, w.walls]);
  };
  assert.equal(sig(11), sig(11));
  assert.ok(sig(11).includes('"ax"'), 'generated worlds contain warps');
});
