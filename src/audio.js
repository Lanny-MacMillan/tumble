// Music and sound effects, all synthesized with WebAudio. The song data, tempo and step scheduling are pure and
// tested in node; the engine below them plays through whatever AudioContext it is given.
(function (root) {
  'use strict';

  const L = root.TumbleLogic || require('./logic.js');

  // one beat is always the same stretch of track, so every song's tempo follows its level's speed
  const TILES_PER_BEAT = 8;
  const STEPS_PER_BEAT = 4;
  const STEPS_PER_BAR = 16;

  function songBpm(k) { return (L.levelSpeed(k) / L.TILE / TILES_PER_BEAT) * 60; }

  // degree 0 is the song's root; degrees past the scale wrap into the next octave (and below 0 into the one under)
  function degreeToMidi(song, degree, octave) {
    const n = song.scale.length;
    const o = Math.floor(degree / n);
    return song.root + 12 * (octave + o) + song.scale[degree - o * n];
  }
  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // '0 - 7 -' style note rows: a number is a scale degree, '-' is a rest
  function row(s) {
    return s.trim().split(/\s+/).map(t => (t === '-' ? null : +t));
  }
  const REST = row('- - - - - - - - - - - - - - - -');
  function bar(kick, snare, hat, bass, lead) {
    return { kick, snare, hat, bass: bass ? row(bass) : REST, lead: lead ? row(lead) : REST };
  }

  const MINOR = [0, 2, 3, 5, 7, 8, 10];

  // Songs, one per run level. Bass plays two octaves under the root, the lead one octave over it.
  const SONGS = [
    {
      name: 'Rookie',
      root: 57,
      scale: MINOR,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar('x...x...x...x...', '................', '..x...x...x...x.', '0 - - - - - - - 0 - - - - - - -'),
        A: bar('x...x...x...x...', '....x.......x...', '..x...x...x...x.',
          '0 - 7 - 0 - 7 - 0 - 7 - 0 - 7 -', '4 - - 4 - - 2 - 4 - - 7 - - 6 -'),
        B: bar('x...x...x...x...', '....x.......x...', '..x...x...x...x.',
          '5 - 12 - 5 - 12 - 5 - 12 - 5 - 12 -', '5 - - 5 - - 4 - 2 - - 0 - - 2 -'),
        C: bar('x...x...x...x...', '....x.......x...', '..x...x...x...x.',
          '2 - 9 - 2 - 9 - 2 - 9 - 2 - 9 -', '4 - - 4 - - 2 - 4 - - 9 - - 7 -'),
        D: bar('x...x...x...x...', '....x.......x...', '..x...x...x...x.',
          '6 - 13 - 6 - 13 - 6 - 13 - 6 - 13 -', '6 - - 6 - - 7 - 8 - - 6 - - 4 -'),
        E: bar('x...x...x...x.x.', '....x.......x.xx', '..x.x.x.x.x.x.x.',
          '6 - 13 - 6 - 13 - 6 6 13 13 6 6 13 13', '6 - - 6 - - 7 - 8 - 9 - 8 - 7 -'),
      },
    },
  ];

  // what plays at a step, counted from the song's first bar: the intro once, then the loop forever
  function notesAt(song, step) {
    const b = Math.floor(step / STEPS_PER_BAR);
    const s = step - b * STEPS_PER_BAR;
    const id = b < song.intro.length ? song.intro[b] : song.loop[(b - song.intro.length) % song.loop.length];
    const p = song.patterns[id];
    const out = [];
    if (p.kick[s] === 'x') out.push({ voice: 'kick' });
    if (p.snare[s] === 'x') out.push({ voice: 'snare' });
    if (p.hat[s] === 'x') out.push({ voice: 'hat' });
    if (p.bass[s] !== null) out.push({ voice: 'bass', midi: degreeToMidi(song, p.bass[s], -2) });
    if (p.lead[s] !== null) out.push({ voice: 'lead', midi: degreeToMidi(song, p.lead[s], 1) });
    return out;
  }

  // The steps that start before now + ahead, in order. A clock left far behind (a hidden tab) jumps to now
  // instead of playing everything it missed, but keeps counting so the song keeps its place in the bar.
  function advanceClock(clock, now, ahead, stepDur) {
    if (clock.next < now - stepDur) {
      clock.step += Math.floor((now - clock.next) / stepDur);
      clock.next = now;
    }
    const out = [];
    while (clock.next < now + ahead) {
      out.push({ step: clock.step, time: clock.next });
      clock.step++;
      clock.next += stepDur;
    }
    return out;
  }

  const api = { TILES_PER_BEAT, STEPS_PER_BEAT, STEPS_PER_BAR, songBpm, degreeToMidi, midiToHz, SONGS, notesAt, advanceClock };

  root.TumbleAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
