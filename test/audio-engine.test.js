const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/audio.js');

// A stand-in for AudioContext: nodes do nothing, but every param change and every start/stop is recorded.
function fakeContext() {
  const ctx = { currentTime: 0, sampleRate: 48000, state: 'suspended', starts: [], gains: [] };
  const param = v => {
    const p = { value: v, set: [v] };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      p[m] = x => { p.set.push(x); if (m === 'setValueAtTime') p.value = x; return p; };
    }
    p.cancelScheduledValues = () => p;
    p.cancelAndHoldAtTime = () => p;
    return p;
  };
  const node = extra => Object.assign({ connect: n => n, disconnect() {} }, extra);
  const source = kind => {
    const s = node({ kind, frequency: param(440), detune: param(0), playbackRate: param(1), type: 'sine', buffer: null, loop: false });
    s.start = t => { s.startAt = t === undefined ? ctx.currentTime : t; ctx.starts.push(s); };
    s.stop = t => { s.stopAt = t === undefined ? ctx.currentTime : t; };
    return s;
  };
  ctx.createOscillator = () => source('osc');
  ctx.createBufferSource = () => source('buffer');
  ctx.createGain = () => { const g = node({ gain: param(1) }); ctx.gains.push(g); return g; };
  ctx.createBiquadFilter = () => node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) });
  ctx.delays = [];
  ctx.createDelay = () => { const d = node({ delayTime: param(0) }); ctx.delays.push(d); return d; };
  ctx.createDynamicsCompressor = () => node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) });
  ctx.createBuffer = (ch, len) => ({ length: len, getChannelData: () => new Float32Array(len) });
  ctx.destination = node({});
  ctx.resume = () => { ctx.state = 'running'; return Promise.resolve(); };
  ctx.suspend = () => { ctx.state = 'suspended'; return Promise.resolve(); };
  return ctx;
}

function fakeTimers() {
  const live = new Set();
  return {
    live,
    setInterval: f => { const id = { f }; live.add(id); return id; },
    clearInterval: id => { live.delete(id); },
  };
}

function engineWith(ctx) {
  const timers = fakeTimers();
  const e = A.createEngine({ makeContext: () => ctx, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  return { e, timers };
}
// move the fake clock forward, running the scheduler as the interval would
function run(ctx, e, seconds) {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end) { ctx.currentTime = Math.min(end, ctx.currentTime + 0.025); e.tick(); }
}
const master = e => e._nodes().master.gain.value;

test('with no AudioContext the engine is silent and never throws', () => {
  const e = A.createEngine({ makeContext: () => null });
  e.unlock(); e.setMuted(true); e.setMuted(false);
  e.startSong(3); e.queueSong(4); e.setFeel({ timeScale: 0.5, boosted: true });
  for (const k of Object.keys(A.SFX)) e.play(k);
  e.play('nothing'); e.tick(); e.stopSong(); e.suspend(); e.resume();
  assert.equal(e.beat(), null);
});

test('an AudioContext that throws on creation leaves the engine silent', () => {
  const e = A.createEngine({ makeContext: () => { throw new Error('blocked'); } });
  e.unlock(); e.startSong(0); e.tick(); e.play('jump');
  assert.equal(e.beat(), null);
});

test('nothing starts before unlock', () => {
  const ctx = fakeContext();
  let made = 0;
  const e = A.createEngine({ makeContext: () => { made++; return ctx; }, setInterval: () => 1, clearInterval() {} });
  e.startSong(0); e.play('jump'); e.tick();
  assert.equal(made, 0);
  assert.equal(ctx.starts.length, 0);
});

test('muted before the first tap stays silent, unmuting later plays in time', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.setMuted(true);
  e.unlock();
  e.startSong(0);
  run(ctx, e, 1);
  assert.equal(master(e), 0);
  const before = e.beat().step;
  assert.ok(before > 0);
  e.setMuted(false);
  assert.equal(master(e), 0.8);
  run(ctx, e, 0.5);
  assert.ok(e.beat().step > before, 'the song carried on from where it was');
});

test('rapid restarts keep one song', () => {
  const ctx = fakeContext();
  const { e, timers } = engineWith(ctx);
  e.unlock();
  for (let i = 0; i < 10; i++) { e.startSong(0); run(ctx, e, 0.05); }
  assert.equal(timers.live.size, 1);
  e.stopSong();
  e.startSong(0);
  run(ctx, e, 0.1);
  assert.equal(timers.live.size, 1);
  e.stopSong();
  assert.equal(timers.live.size, 0);
  assert.equal(e.beat(), null);
});

test('a queued level starts on the next beat, and the last one queued wins', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.unlock();
  e.startSong(0);
  run(ctx, e, 1.03);
  const at = e.beat().step;
  e.queueSong(1);
  e.queueSong(2);
  assert.equal(e.beat().level, 0, 'the old song plays until the beat');
  run(ctx, e, 1);
  const b = e.beat();
  assert.equal(b.level, 2);
  assert.equal(b.from % A.STEPS_PER_BEAT, 0, 'the new song began on a beat');
  assert.ok(b.from >= at && b.from - at < A.STEPS_PER_BEAT);
});

test('queueSong with nothing playing just starts that song', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.unlock();
  e.queueSong(3);
  run(ctx, e, 0.3);
  assert.equal(e.beat().level, 3);
});

test('slow time stretches the steps', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.unlock();
  e.startSong(0);
  run(ctx, e, 1);
  const s0 = e.beat().step;
  run(ctx, e, 2);
  const normal = e.beat().step - s0;
  e.setFeel({ timeScale: 0.5, boosted: false });
  const s1 = e.beat().step;
  run(ctx, e, 2);
  const slow = e.beat().step - s1;
  assert.ok(Math.abs(slow - normal / 2) <= 2, `${slow} vs ${normal}`);
});

test('advanceClock can hand out one step at a time', () => {
  const clock = { next: 0, step: 0 };
  assert.deepEqual(A.advanceClock(clock, 0, 1, 0.1, 1).map(x => x.step), [0]);
  assert.deepEqual(A.advanceClock(clock, 0, 1, 0.1, 1).map(x => x.step), [1]);
});

const EVENTS = ['jump', 'land', 'orb', 'warp', 'bounce', 'shield', 'pickup', 'boost', 'crumble', 'trap', 'flip', 'level', 'best', 'die'];

test('every event stepGame can emit has a sound that starts and ends', () => {
  for (const k of EVENTS) {
    assert.equal(typeof A.SFX[k], 'function', k);
    const ctx = fakeContext();
    ctx.currentTime = 2;
    const out = ctx.createGain();
    A.SFX[k](ctx, out, 2);
    assert.ok(ctx.starts.length > 0, `${k} starts a source`);
    for (const s of ctx.starts) assert.ok(s.stopAt !== undefined && s.stopAt <= 2 + 1.5, `${k} stops within 1.5 s`);
  }
});

function peakOf(k) {
  const ctx = fakeContext();
  const out = ctx.createGain();
  const n = ctx.gains.length;
  A.SFX[k](ctx, out, 1);
  return Math.max(...ctx.gains.slice(n).flatMap(g => g.gain.set.slice(1)));
}

test('effects stay under the jump, except the crash and the level up', () => {
  const jump = peakOf('jump');
  for (const k of EVENTS) {
    if (k === 'die' || k === 'level') continue;
    assert.ok(peakOf(k) <= jump + 1e-9, `${k} ${peakOf(k)} > jump ${jump}`);
  }
  assert.ok(peakOf('crumble') < jump && peakOf('trap') < jump, 'falling things are lighter than a jump');
});

test('the engine plays effects only after unlock', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.play('jump');
  assert.equal(ctx.starts.length, 0);
  e.unlock();
  e.play('jump');
  assert.ok(ctx.starts.length > 0);
});

test('dying in slow time or a boost does not carry into the next song', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.unlock();
  e.startSong(0);
  run(ctx, e, 0.5);
  e.setFeel({ timeScale: 0.5, boosted: true });
  run(ctx, e, 0.5);
  e.stopSong();
  run(ctx, e, 0.3);
  const n = ctx.starts.length;
  e.startSong(0);
  const kicks = ctx.starts.slice(n).filter(s => s.kind === 'osc' && s.frequency.set[1] === 150);
  assert.ok(kicks.length > 0, 'the first kick is at full pitch');
  const f = e._nodes().filter.frequency.set;
  assert.equal(f[f.length - 1], 2500, 'the music filter is closed again');
});

test('a restart during the tape stop silences the old notes at once', () => {
  const ctx = fakeContext();
  const { e } = engineWith(ctx);
  e.unlock();
  e.startSong(0);
  run(ctx, e, 0.03);   // the first kick and bass note have just started and ring for about 0.3 s
  const old = ctx.starts.filter(s => s.startAt <= ctx.currentTime);
  assert.ok(old.some(s => s.stopAt > ctx.currentTime + 0.25), 'a note is still ringing at the restart');
  e.stopSong();
  ctx.currentTime += 0.25;
  e.startSong(0);
  for (const s of old) assert.ok(s.stopAt <= ctx.currentTime + 1e-9, `${s.kind} still sounding at ${s.stopAt}`);
});

test('traps are clearly heard: close to a jump in level and pitched where the music does not cover them', () => {
  const jump = peakOf('jump');
  assert.ok(peakOf('trap') >= 0.8 * jump, `trap ${peakOf('trap')} vs jump ${jump}`);
  const ctx = fakeContext();
  A.SFX.trap(ctx, ctx.createGain(), 1);
  const top = Math.max(...ctx.starts.filter(s => s.kind === 'osc').flatMap(s => s.frequency.set.slice(1)));
  assert.ok(top >= 600, `highest tone ${top} Hz`);
});

test('portals echo', () => {
  for (const k of ['warp', 'flip']) {
    const ctx = fakeContext();
    A.SFX[k](ctx, ctx.createGain(), 1);
    assert.ok(ctx.delays.length > 0, `${k} has an echo`);
    assert.ok(ctx.delays.every(d => d.delayTime.set.slice(1).some(v => v >= 0.08)), `${k} echo is long enough to hear`);
  }
});
