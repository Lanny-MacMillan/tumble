const test = require('node:test');
const assert = require('node:assert/strict');
const { L, DT, buildWorld } = require('./support.js');

const chunk = name => L.CHUNKS.find(c => c.name === name);
const dropChunk = () => L.CHUNKS.find(c => c.gates.some(g => g.kind === 'drop') && c.entryH === 0);

// runs a cube that never jumps through the chunk and collects what each step reported
function runFlat(c0, speed = L.SPEED_MIN) {
  const world = buildWorld([c0]);
  const cube = L.newCube(2 * L.TILE, c0.entryH);
  const steps = [];
  for (let i = 0; i < 4000 && cube.x < world.endX - 8 * L.TILE; i++) {
    const cxPrev = cube.x + L.CUBE / 2;
    const ev = L.stepCube(cube, world, { pressed: false, held: false }, DT, speed * L.boostMul(cube));
    steps.push({ ev, cxPrev, cx: cube.x + L.CUBE / 2 });
    if (ev.dead) break;
  }
  return { world, steps };
}
const count = (steps, k) => steps.filter(s => s.ev[k]).length;

test('boost fires once when the cube first touches a pad, not again while boosted', () => {
  const { steps } = runFlat(chunk('boostRun@0'));
  assert.equal(count(steps, 'boost'), 1);
});

test('crumble fires once per tile the cube lands on', () => {
  const { steps } = runFlat(chunk('crumbleBridge@0'));
  assert.equal(count(steps, 'crumble'), 1);
});

test('trap fires once per trap as its trigger is crossed', () => {
  const cases = [
    ['vanish0@0', w => w.vanish[0].trigger],
    ['popSpikes0@0', w => w.pops[0].trigger],
    ['slamRoof@0', w => w.slams[0].trigger],
    [dropChunk().name, w => w.gates.find(g => g.kind === 'drop').trigger],
  ];
  for (const [name, triggerOf] of cases) {
    const { world, steps } = runFlat(chunk(name));
    assert.equal(count(steps, 'trap'), 1, name);
    const at = steps.find(s => s.ev.trap);
    const trigger = triggerOf(world);
    assert.ok(at.cxPrev < trigger && at.cx >= trigger, `${name} fires on the step that crosses the trigger`);
  }
});

test('plain chunks report none of the new events', () => {
  for (const name of ['flat@0', 'spike1@0', 'gap2@0']) {
    const c = chunk(name);
    if (!c) continue;
    const { steps } = runFlat(c);
    assert.equal(count(steps, 'boost') + count(steps, 'crumble') + count(steps, 'trap'), 0, name);
  }
});

test('stepGame passes the new events on by name', () => {
  for (const [name, e] of [['boostRun@0', 'boost'], ['crumbleBridge@0', 'crumble'], ['slamRoof@0', 'trap']]) {
    const g = L.newGame(5, true, 0, [chunk(name)]);
    const seen = new Set();
    for (let i = 0; i < 6000 && g.state === 'running'; i++) {
      for (const x of L.stepGame(g, { pressed: false, held: false }, DT)) seen.add(x);
    }
    assert.ok(seen.has(e), `${name} gives ${e}`);
  }
});
