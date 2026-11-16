const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld, chunkClearable } = require('./support.js');
const { runsOf } = require('./closure/closure.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const step = (c, w, held, pressed, speed) => L.stepCube(c, w, { pressed, held }, DT, speed);
const levelSpeeds = () => {
  const out = [];
  for (let k = 0; k <= L.LAST_LEVEL; k++) { out.push(L.levelSpeed(k)); if (k) out.push((L.levelSpeed(k) + L.levelSpeed(k - 1)) / 2); }
  return out;
};

test('bounceUp exists at every height, tier 1, and is the only piece that needs a bounce', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`bounceUp@${h}`);
    assert.ok(c, `bounceUp@${h}`);
    assert.equal(c.diff, 1);
    assert.equal(c.needsBounce, true);
    assert.equal(c.bounces.length, 1);
  }
  assert.deepEqual(L.CHUNKS.filter(c => c.bounces.length).map(c => c.name.split('@')[0]).filter((n, i, a) => a.indexOf(n) === i), ['bounceUp']);
});

test('the numbers: apex 1.8 times a full jump, fits on the narrowest screen, platform 4 tiles up', () => {
  assert.ok(Math.abs(L.BOUNCE_PEAK / L.JUMP_PEAK - L.BOUNCE_APEX_MUL) < 0.01);
  // the apex measured by running the physics, not just the formula
  const world = L.createEmptyWorld();
  L.addGround(world, -50, 5000, 0);
  world.bounces.push({ x0: 100, x1: 200, top: L.FLOOR_Y });
  const cube = L.newCube(0, 0);
  cube.x = 150;
  let apex = 0;
  for (let i = 0; i < 400; i++) {
    step(cube, world, false, false, 0);
    apex = Math.max(apex, L.FLOOR_Y - (cube.y + L.CUBE));
  }
  assert.ok(Math.abs(apex - L.BOUNCE_PEAK) < 4, `apex ${apex.toFixed(1)} px vs ${L.BOUNCE_PEAK.toFixed(1)}`);
  // at the highest ground the top of the cube still sits well below the score at the top of the screen
  const topY = L.FLOOR_Y - L.MAX_H * L.TILE - L.BOUNCE_PEAK - L.CUBE;
  assert.ok(topY >= 120, `the cube would reach y=${topY.toFixed(0)}`);
  assert.ok(L.VIEW_H > L.FLOOR_Y - topY);
  assert.equal(L.BOUNCE_PLATFORM_H, 4);
});

test('a plain jump, an orb and a boost cannot reach the platform: margin to +4 tiles', () => {
  const margin = L.BOUNCE_PLATFORM_H * L.TILE - L.JUMP_PEAK;
  assert.ok(margin >= 0.5 * L.TILE, `plain jump apex ${(L.JUMP_PEAK / L.TILE).toFixed(2)} tiles, margin ${(margin / L.TILE).toFixed(2)}`);
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`bounceUp@${h}`);
    assert.equal(c.orbs.length + c.pads.length + c.fields.length + c.spikes.length + c.ceilings.length + c.boxes.length + c.moving.length + c.crumble.length + c.warps.length, 0, `${c.name}: something else on the route`);
    // the gap is wider than the farthest plain jump, coyote time included, at the top speed
    const world = buildWorld([c]);
    world.bounces = [];
    for (const hold of [20, 57, 114]) {
      for (let wait = 0; wait < 160; wait += 2) {
        const cube = L.newCube(2 * L.TILE, h);
        let dead = null, onPlatform = false;
        for (let i = 0; i < 2000 && !dead && cube.x < world.endX - 8 * L.TILE; i++) {
          dead = step(cube, world, i >= wait && i < wait + hold, i === wait, L.SPEED_MAX).dead;
          if (cube.onGround && Math.abs(cube.y + L.CUBE - (L.FLOOR_Y - (h + 4) * L.TILE)) < 1) onPlatform = true;
        }
        assert.equal(onPlatform, false, `${c.name}: a plain jump (hold ${hold}, wait ${wait}) stood on the platform`);
        assert.ok(dead, `${c.name}: a plain jump (hold ${hold}, wait ${wait}) crossed the gap`);
      }
    }
  }
  assert.ok((L.SPEED_MAX * (L.AIR_TIME_FULL + L.COYOTE)) / L.TILE < chunk('bounceUp@0').w - 6 - 2 * L.PAD + 3, 'gap vs the farthest plain jump');
});

test('walking onto the pad lands on the platform at every level speed and in between, at every height', () => {
  for (let h = 0; h <= L.MAX_H; h++) {
    const c = chunk(`bounceUp@${h}`);
    for (const speed of levelSpeeds()) {
      const world = buildWorld([c]);
      const cube = L.newCube(2 * L.TILE, h);
      let dead = null, bounces = 0, stood = false;
      for (let i = 0; i < 3000 && !dead && cube.x < world.endX - 8 * L.TILE; i++) {
        const ev = step(cube, world, false, false, speed);
        dead = ev.dead;
        if (ev.bounce) { bounces++; assert.equal(ev.landed, false, 'a bounce is not a landing'); }
        if (cube.onGround && Math.abs(cube.y + L.CUBE - (L.FLOOR_Y - (h + 4) * L.TILE)) < 1) stood = true;
      }
      assert.equal(dead, null, `${c.name} at ${Math.round(speed)}: ${dead}`);
      assert.equal(bounces, 1, `${c.name}: ${bounces} bounces`);
      assert.ok(stood, `${c.name} at ${Math.round(speed)}: never stood on the platform`);
    }
  }
});

test('nothing the player does changes a bounce: hold, taps and a press buffered before the pad add no height', () => {
  const c = chunk('bounceUp@0');
  const speed = L.levelSpeed(3);
  const run = (script) => {
    const world = buildWorld([c]);
    const cube = L.newCube(2 * L.TILE, 0);
    const ys = [];
    let bounced = false, landed = false;
    for (let i = 0; i < 400 && !landed; i++) {
      const input = script(i, cube, bounced);
      const ev = step(cube, world, input.held, input.pressed, speed);
      if (ev.bounce) { bounced = true; assert.equal(cube.coyote, 0); assert.equal(cube.buffer, 0); }
      if (bounced) ys.push(+cube.y.toFixed(3));
      if (bounced && ev.landed) landed = true;
    }
    return ys;
  };
  const base = run(() => ({ held: false, pressed: false }));
  assert.ok(base.length > 40);
  assert.deepEqual(run(() => ({ held: true, pressed: false })), base, 'holding changed the bounce');
  assert.deepEqual(run((i, cube) => ({ held: true, pressed: cube.x > 8 * L.TILE + 4 * L.TILE })), base, 'a press just before the pad changed the bounce');
  assert.deepEqual(run((i, cube, bounced) => ({ held: bounced && i % 3 === 0, pressed: bounced && i % 5 === 0 })), base, 'taps in flight changed the bounce');
});

test('a game run through the pad reports one bounce event', () => {
  const g = L.newGame(5, true, 0, [chunk('bounceUp@0')]);
  let n = 0;
  for (let i = 0; i < 6000 && g.state === 'running' && g.cube.x < 14 * L.TILE + 30 * L.TILE; i++) n += L.stepGame(g, { pressed: false, held: false }, DT).filter(e => e === 'bounce').length;
  assert.equal(g.state, 'running');
  assert.equal(n, 1);
});

test('bounceUp: gems trace the launch arc, the pad is fair at every speed, and the closure sees the platform as a run', () => {
  const c = chunk('bounceUp@0');
  const w = buildWorld([c]);
  assert.ok(w.guides.length >= 8, `${w.guides.length} gems`);
  for (let k = 0; k <= L.LAST_LEVEL; k++) assert.ok(chunkClearable(c, L.levelSpeed(k)), `level ${k}`);
  assert.ok(runsOf(c, L.SPEED_MIN).length >= 3, 'runs: before the pad, the platform, the landing');
});
