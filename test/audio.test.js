const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const A = require('../src/audio.js');

const near = (a, b, eps) => Math.abs(a - b) <= eps;

test('tempo follows level speed at 8 tiles per beat', () => {
  assert.equal(A.TILES_PER_BEAT, 8);
  assert.equal(A.STEPS_PER_BEAT, 4);
  assert.equal(A.STEPS_PER_BAR, 16);
  assert.ok(near(A.songBpm(0), 101.25, 0.01), String(A.songBpm(0)));
  assert.ok(near(A.songBpm(6), 195, 0.01), String(A.songBpm(6)));
  for (let k = 1; k <= L.LAST_LEVEL; k++) assert.ok(A.songBpm(k) > A.songBpm(k - 1), `level ${k}`);
});

test("every song's data is well formed", () => {
  assert.ok(A.SONGS.length >= 1);
  for (const s of A.SONGS) {
    assert.equal(typeof s.name, 'string');
    assert.equal(s.scale[0], 0, s.name);
    for (let i = 1; i < s.scale.length; i++) assert.ok(s.scale[i] > s.scale[i - 1] && s.scale[i] <= 11, s.name);
    assert.ok(s.intro.length > 0 && s.loop.length > 0, s.name);
    for (const id of s.intro.concat(s.loop)) assert.ok(s.patterns[id], `${s.name} pattern ${id}`);
    for (const [id, p] of Object.entries(s.patterns)) {
      const where = `${s.name} ${id}`;
      for (const d of ['kick', 'snare', 'hat']) assert.match(p[d], /^[x.]{16}$/, `${where} ${d}`);
      assert.equal(p.bass.length, 16, where);
      assert.equal(p.lead.length, 16, where);
      for (const n of p.bass) if (n !== null) {
        const m = A.degreeToMidi(s, n, -2);
        assert.ok(m >= 28 && m <= 60, `${where} bass ${m}`);
      }
      for (const n of p.lead) if (n !== null) {
        const m = A.degreeToMidi(s, n, 1);
        assert.ok(m >= 55 && m <= 96, `${where} lead ${m}`);
      }
    }
  }
});

test('degrees map through the scale and wrap into the next octave', () => {
  const s = { root: 57, scale: [0, 2, 3, 5, 7, 8, 10] };
  assert.equal(A.degreeToMidi(s, 0, 0), 57);
  assert.equal(A.degreeToMidi(s, 2, 0), 60);
  assert.equal(A.degreeToMidi(s, 7, 0), 69);
  assert.equal(A.degreeToMidi(s, -1, 0), 55);
  assert.equal(A.degreeToMidi(s, 0, -2), 33);
  assert.ok(near(A.midiToHz(69), 440, 1e-9));
});

test('notesAt plays the intro once and then the loop', () => {
  const pat = kick => ({ kick, snare: '................', hat: '................', bass: Array(16).fill(null), lead: Array(16).fill(null) });
  const song = {
    name: 't', root: 57, scale: [0, 2, 3, 5, 7, 8, 10], intro: ['I'], loop: ['A', 'B'],
    patterns: { I: pat('x...............'), A: pat('.x..............'), B: pat('..x.............') },
  };
  const kickAt = step => A.notesAt(song, step).some(n => n.voice === 'kick');
  assert.ok(kickAt(0));          // I
  assert.ok(kickAt(17));         // A
  assert.ok(kickAt(34));         // B
  assert.ok(kickAt(49));         // A again
  assert.ok(kickAt(66));         // B again
  assert.ok(!kickAt(16) && !kickAt(48));
  const lead = { ...song, patterns: { ...song.patterns, I: { ...pat('................'), lead: [3].concat(Array(15).fill(null)) } } };
  assert.deepEqual(A.notesAt(lead, 0), [{ voice: 'lead', midi: A.degreeToMidi(lead, 3, 1) }]);
});

test('advanceClock schedules exactly the steps in the window', () => {
  const clock = { next: 0, step: 0 };
  const a = A.advanceClock(clock, 0, 0.25, 0.1);
  assert.deepEqual(a.map(x => x.step), [0, 1, 2]);
  a.forEach((x, i) => assert.ok(near(x.time, i * 0.1, 1e-9)));
  const b = A.advanceClock(clock, 0.1, 0.25, 0.1);
  assert.deepEqual(b.map(x => x.step), [3]);
});

test('a hidden tab does not flood notes', () => {
  const clock = { next: 1, step: 10 };
  const out = A.advanceClock(clock, 30, 0.12, 0.1);
  assert.ok(out.length <= Math.ceil(0.12 / 0.1), String(out.length));
  assert.ok(out[0].time >= 30);
  assert.ok(out[0].step > 10, 'the song keeps its place');
});

test('a tempo change takes effect on the next step', () => {
  const clock = { next: 0, step: 0 };
  const a = A.advanceClock(clock, 0, 0.15, 0.1);
  const b = A.advanceClock(clock, 0.15, 0.3, 0.2);
  const times = a.concat(b).map(x => x.time);
  assert.ok(near(times[1] - times[0], 0.1, 1e-9));
  assert.ok(near(times[2] - times[1], 0.1, 1e-9));
  assert.ok(near(times[3] - times[2], 0.2, 1e-9));
});

test('there is a song for every run level', () => {
  assert.equal(A.SONGS.length, L.LAST_LEVEL + 1);
  assert.equal(new Set(A.SONGS.map(s => s.name)).size, A.SONGS.length);
});
