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
  const DORIAN = [0, 2, 3, 5, 7, 9, 10];
  const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
  const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

  // drum rows and bass lines shared by the songs
  const FOUR = 'x...x...x...x...', BACK = '....x.......x...', FILL = '....x.......xxxx', NONE = '................';
  const OFFHAT = '..x...x...x...x.', HAT8 = 'x.x.x.x.x.x.x.x.', HAT16 = 'xxx.xxx.xxx.xxx.';
  const pump = d => `${d} - ${d + 7} - `.repeat(4);
  const drive = d => `${d} - ${d} ${d} - ${d} ${d} - `.repeat(2);
  const skip = d => `${d} - ${d + 7} ${d} - ${d} ${d + 7} - `.repeat(2);
  const roll = d => `${d} - - - - - ${d} - - - ${d + 7} - ${d} - - -`;

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
    {
      name: 'Roller',
      root: 52,
      scale: DORIAN,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar(FOUR, NONE, OFFHAT, pump(0)),
        A: bar(FOUR, BACK, OFFHAT, pump(0), '7 - 4 - 2 - 4 - 7 - 4 - 9 - 8 -'),
        B: bar(FOUR, BACK, OFFHAT, pump(2), '9 - 7 - 4 - 7 - 9 - 7 - 11 - 9 -'),
        C: bar(FOUR, BACK, OFFHAT, pump(6), '8 - 6 - 3 - 6 - 8 - 6 - 10 - 8 -'),
        D: bar(FOUR, BACK, OFFHAT, pump(3), '7 - 5 - 3 - 5 - 7 - 8 - 7 - 5 -'),
        E: bar(FOUR, FILL, HAT8, pump(3), '7 - 5 - 3 - 5 7 8 9 10 11 - 10 9 -'),
      },
    },
    {
      name: 'Tumbler',
      root: 55,
      scale: MINOR,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar(FOUR, NONE, HAT8, drive(0)),
        A: bar(FOUR, BACK, HAT8, drive(0), '4 - - 2 - - 4 - - 7 - - 6 - 4 -'),
        B: bar(FOUR, BACK, HAT8, drive(3), '5 - - 3 - - 5 - - 7 - - 8 - 7 -'),
        C: bar(FOUR, BACK, HAT8, drive(5), '7 - - 5 - - 2 - - 5 - - 7 - 9 -'),
        D: bar(FOUR, BACK, HAT8, drive(4), '8 - - 6 - - 4 - - 6 - - 4 - 1 -'),
        E: bar(FOUR, FILL, HAT16, drive(4), '8 - - 6 - - 8 - 9 - 10 - 11 - 13 -'),
      },
    },
    {
      name: 'Acrobat',
      root: 59,
      scale: HARMONIC,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar(FOUR, NONE, HAT8, skip(0)),
        A: bar(FOUR, BACK, HAT8, skip(0), '0 2 4 7 4 2 0 2 4 7 9 7 4 2 4 7'),
        B: bar(FOUR, BACK, HAT8, skip(5), '5 7 9 12 9 7 5 7 9 12 14 12 9 7 9 12'),
        C: bar(FOUR, BACK, HAT8, skip(3), '3 5 7 10 7 5 3 5 7 10 12 10 7 5 7 10'),
        D: bar(FOUR, BACK, HAT8, skip(4), '4 6 8 11 8 6 4 6 8 11 13 11 8 6 4 6'),
        E: bar(FOUR, FILL, HAT16, skip(4), '4 6 8 11 13 11 8 6 4 - 6 - 8 - 11 -'),
      },
    },
    {
      name: 'Glider',
      root: 53,
      scale: PHRYGIAN,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar(FOUR, NONE, HAT16, drive(0)),
        A: bar(FOUR, BACK, HAT16, drive(0), '7 - - - 8 - - - 7 - 4 - 3 - - -'),
        B: bar(FOUR, BACK, HAT16, drive(1), '8 - - - 10 - - - 8 - 7 - 8 - - -'),
        C: bar(FOUR, BACK, HAT16, drive(0), '7 - - - 4 - - - 3 - 4 - 7 - - -'),
        D: bar(FOUR, BACK, HAT16, drive(6), '6 - - - 5 - - - 6 - 8 - 10 - - -'),
        E: bar(FOUR, FILL, HAT16, drive(6), '6 - - - 5 - 6 - 8 - 10 - 11 - 14 -'),
      },
    },
    {
      name: 'Comet',
      root: 58,
      scale: MINOR,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar('x.........x.....', NONE, HAT8, roll(0)),
        A: bar('x.........x.....', BACK, HAT8, roll(0), '7 - 9 - 7 - 4 - 7 - 9 - 11 - 9 -'),
        B: bar('x.........x.....', BACK, HAT8, roll(6), '8 - 6 - 3 - 6 - 8 - 9 - 8 - 6 -'),
        C: bar('x.........x.....', BACK, HAT8, roll(5), '7 - 5 - 2 - 5 - 7 - 9 - 10 - 9 -'),
        D: bar('x.........x.....', BACK, HAT8, roll(6), '8 - 9 - 11 - 9 - 8 - 6 - 8 - - -'),
        E: bar('x.........x.x...', FILL, HAT16, roll(6), '8 - 9 - 11 - 13 - 14 - 13 - 11 - 9 -'),
      },
    },
    {
      // written half-time: the snare lands once a bar, so 195 BPM feels big rather than frantic
      name: 'Legend',
      root: 54,
      scale: MINOR,
      intro: ['I'],
      loop: ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'E'],
      patterns: {
        I: bar('x.........x.....', NONE, HAT8, roll(0)),
        A: bar('x.........x.....', '........x.......', HAT8, roll(0), '7 - - - - - 9 - 11 - - - 9 - 7 -'),
        B: bar('x.........x.....', '........x.......', HAT8, roll(5), '12 - - - - - 11 - 9 - - - 7 - 9 -'),
        C: bar('x.........x.....', '........x.......', HAT8, roll(2), '9 - - - - - 11 - 12 - - - 14 - 12 -'),
        D: bar('x.........x.....', '........x.......', HAT8, roll(6), '13 - - - - - 11 - 10 - - - 8 - 6 -'),
        E: bar('x.........x.x...', '........x...x.xx', HAT16, roll(6), '13 - - - 11 - 13 - 14 - - - - - - -'),
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

  // The steps that start before now + ahead, in order (at most max of them). A clock left far behind (a hidden tab)
  // jumps to now instead of playing everything it missed, but keeps counting so the song keeps its place in the bar.
  function advanceClock(clock, now, ahead, stepDur, max) {
    if (clock.next < now - stepDur) {
      clock.step += Math.floor((now - clock.next) / stepDur);
      clock.next = now;
    }
    const out = [];
    while (clock.next < now + ahead && (max === undefined || out.length < max)) {
      out.push({ step: clock.step, time: clock.next });
      clock.step++;
      clock.next += stepDur;
    }
    return out;
  }

  // ---- sounds -------------------------------------------------------------

  const noiseBuffers = new WeakMap();
  function noise(ctx) {
    let b = noiseBuffers.get(ctx);
    if (!b) {
      b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuffers.set(ctx, b);
    }
    return b;
  }

  // silent at t, up to peak after attack, gone by t + len
  function env(ctx, out, t, peak, attack, len) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(out);
    return g;
  }
  function tone(ctx, out, t, type, hz, peak, len, attack, cutoff) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    const g = env(ctx, out, t, peak, attack || 0.005, len);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      o.connect(f); f.connect(g);
    } else o.connect(g);
    o.start(t);
    o.stop(t + len + 0.02);
    return o;
  }
  function hiss(ctx, out, t, type, hz, peak, len, attack) {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(hz, t);
    s.connect(f);
    f.connect(env(ctx, out, t, peak, attack || 0.002, len));
    s.start(t);
    s.stop(t + len + 0.02);
    return { s, f };
  }
  const glide = (p, to, at) => p.exponentialRampToValueAtTime(to, at);

  // Effects, by game event. The jump is heard all the time, so it sets the ceiling: only the level up and the
  // crash are louder, and anything that falls or crumbles stays well under it.
  const SFX = {
    jump(ctx, out, t) {
      const o = tone(ctx, out, t, 'triangle', 200, 0.5, 0.2);
      glide(o.frequency, 560, t + 0.08);
      glide(o.frequency, 470, t + 0.16);
    },
    land(ctx, out, t) { glide(tone(ctx, out, t, 'sine', 130, 0.25, 0.08).frequency, 60, t + 0.07); },
    orb(ctx, out, t) { glide(tone(ctx, out, t, 'triangle', 420, 0.45, 0.15).frequency, 940, t + 0.09); },
    bounce(ctx, out, t) {
      const o = tone(ctx, out, t, 'triangle', 140, 0.5, 0.38);
      glide(o.frequency, 720, t + 0.2);
      glide(o.frequency, 600, t + 0.32);
    },
    boost(ctx, out, t) { glide(hiss(ctx, out, t, 'bandpass', 400, 0.4, 0.42, 0.05).f.frequency, 4200, t + 0.38); },
    warp(ctx, out, t) {
      tone(ctx, out, t, 'sine', 660, 0.4, 0.06);
      tone(ctx, out, t + 0.06, 'sine', 990, 0.4, 0.06);
      tone(ctx, out, t + 0.12, 'sine', 740, 0.35, 0.09);
    },
    flip(ctx, out, t) {
      tone(ctx, out, t, 'sine', 880, 0.4, 0.07);
      glide(hiss(ctx, out, t, 'highpass', 5000, 0.25, 0.28, 0.03).f.frequency, 1200, t + 0.26);
    },
    pickup(ctx, out, t) {
      tone(ctx, out, t, 'triangle', 1047, 0.35, 0.22);
      tone(ctx, out, t + 0.06, 'triangle', 1568, 0.35, 0.3);
    },
    shield(ctx, out, t) {
      hiss(ctx, out, t, 'highpass', 5000, 0.45, 0.26);
      glide(tone(ctx, out, t, 'square', 1800, 0.2, 0.16).frequency, 600, t + 0.15);
    },
    crumble(ctx, out, t) { hiss(ctx, out, t, 'lowpass', 900, 0.2, 0.16); },
    trap(ctx, out, t) {
      glide(tone(ctx, out, t, 'triangle', 300, 0.25, 0.22).frequency, 150, t + 0.2);
      hiss(ctx, out, t, 'lowpass', 600, 0.15, 0.2);
    },
    best(ctx, out, t) {
      tone(ctx, out, t, 'square', 784, 0.4, 0.1, 0.005, 3000);
      tone(ctx, out, t + 0.1, 'square', 1047, 0.4, 0.22, 0.005, 3000);
    },
    level(ctx, out, t) {
      glide(tone(ctx, out, t, 'sawtooth', 200, 0.6, 0.8, 0.05, 2400).frequency, 1600, t + 0.6);
      glide(hiss(ctx, out, t, 'bandpass', 500, 0.3, 0.8, 0.2).f.frequency, 6000, t + 0.7);
    },
    die(ctx, out, t) {
      glide(hiss(ctx, out, t, 'lowpass', 3000, 1, 0.6).f.frequency, 200, t + 0.55);
      glide(tone(ctx, out, t, 'sawtooth', 300, 0.6, 0.6).frequency, 40, t + 0.55);
    },
  };

  // ---- engine -------------------------------------------------------------

  const AHEAD = 0.12;
  const TICK_MS = 25;
  const MASTER = 0.8, MUSIC = 0.5, EFFECTS = 0.35;
  const DULL_HZ = 2500, BRIGHT_HZ = 12000;
  const TAPE_STOP_S = 0.3;

  // The engine makes no AudioContext until unlock(), which the page calls from a tap or key press. With no
  // AudioContext at all every method still works and nothing is heard.
  function createEngine(opts) {
    opts = opts || {};
    const makeContext = opts.makeContext || (() => {
      const C = root.AudioContext || root.webkitAudioContext;
      return C ? new C() : null;
    });
    const setTimer = opts.setInterval || ((f, ms) => setInterval(f, ms));
    const clearTimer = opts.clearInterval || (id => clearInterval(id));
    let ctx = null, broken = false, muted = false, nodes = null;
    let song = null;     // { level, from, clock } while a song plays; from is the step it began on
    let wanted = null;   // a song asked for before unlock
    let queued = null;   // { level, at }: the next song and the beat it starts on
    let timer = null;
    let feel = { timeScale: 1, boosted: false };
    let live = [];       // music sources scheduled or sounding, for the tape stop

    const clampLevel = k => Math.max(0, Math.min(L.LAST_LEVEL, Math.floor(k) || 0));
    const songData = k => SONGS[Math.min(k, SONGS.length - 1)];
    const stepDur = () => 60 / songBpm(song.level) / STEPS_PER_BEAT / feel.timeScale;

    function build() {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-12, 0);
      comp.ratio.setValueAtTime(4, 0);
      const master = ctx.createGain();
      master.gain.setValueAtTime(muted ? 0 : MASTER, 0);
      master.connect(comp);
      comp.connect(ctx.destination);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(feel.boosted ? BRIGHT_HZ : DULL_HZ, 0);
      const music = ctx.createGain();
      music.gain.setValueAtTime(MUSIC, 0);
      filter.connect(music);
      music.connect(master);
      const fx = ctx.createGain();
      fx.gain.setValueAtTime(EFFECTS, 0);
      fx.connect(master);
      nodes = { master, comp, filter, music, fx };
    }

    function track(src, hz, start, end) { live.push({ src, hz, start, end }); }

    // one note of the song; slow time lowers the pitch along with the tempo
    function playNote(n, t, d) {
      const pm = feel.timeScale, out = nodes.filter;
      if (n.voice === 'kick') {
        const o = tone(ctx, out, t, 'sine', 150 * pm, 0.9, 0.28);
        glide(o.frequency, 45 * pm, t + 0.12);
        track(o, 150 * pm, t, t + 0.3);
      } else if (n.voice === 'snare') {
        track(hiss(ctx, out, t, 'bandpass', 1800 * pm, 0.4, 0.15).s, 0, t, t + 0.17);
        track(tone(ctx, out, t, 'triangle', 190 * pm, 0.2, 0.08), 190 * pm, t, t + 0.1);
      } else if (n.voice === 'hat') {
        track(hiss(ctx, out, t, 'highpass', 7000, 0.12, 0.04).s, 0, t, t + 0.06);
      } else {
        const hz = midiToHz(n.midi) * pm;
        const bass = n.voice === 'bass';
        const len = d * (bass ? 1.9 : 1.6);
        track(tone(ctx, out, t, bass ? 'sawtooth' : 'square', hz, bass ? 0.3 : 0.12, len, 0.005, bass ? 700 : 4000), hz, t, t + len);
      }
    }

    function stopTimer() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    }
    // drop notes that were scheduled ahead and have not started
    function cancelAhead(now) {
      for (const v of live) if (v.start > now) v.src.stop(now);
      live = live.filter(v => v.start <= now && v.end > now);
    }

    function tick() {
      if (!ctx || !song) return;
      const now = ctx.currentTime;
      for (let i = 0; i < 64; i++) {
        const due = advanceClock(song.clock, now, AHEAD, stepDur(), 1);
        if (!due.length) break;
        const { step, time } = due[0];
        if (queued && step >= queued.at) {
          song.level = queued.level;
          song.from = step;
          queued = null;
          song.clock.next = time + stepDur();
        }
        for (const n of notesAt(songData(song.level), step - song.from)) playNote(n, time, stepDur());
      }
      live = live.filter(v => v.end > now);
    }

    function startSong(level) {
      level = clampLevel(level);
      if (!ctx) { wanted = level; return; }
      const now = ctx.currentTime;
      stopTimer();
      cancelAhead(now);
      const g = nodes.music.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(MUSIC, now);
      song = { level, from: 0, clock: { next: now + 0.02, step: 0 } };
      queued = null;
      timer = setTimer(tick, TICK_MS);
      tick();
    }

    function play(name) {
      if (!ctx || !SFX[name]) return;
      SFX[name](ctx, nodes.fx, ctx.currentTime);
    }

    return {
      unlock() {
        if (broken) return;
        if (!ctx) {
          try { ctx = makeContext(); } catch (e) { ctx = null; }
          if (!ctx) { broken = true; return; }
          build();
          if (wanted !== null) { const w = wanted; wanted = null; startSong(w); }
        }
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      },
      setMuted(m) {
        muted = !!m;
        if (!nodes) return;
        const g = nodes.master.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(muted ? 0 : MASTER, ctx.currentTime);
      },
      startSong,
      // the next level's song comes in on the next beat of the one playing, with the level-up sweep
      queueSong(level) {
        level = clampLevel(level);
        if (!ctx) { wanted = level; return; }
        if (!song) { startSong(level); return; }
        queued = { level, at: Math.ceil(song.clock.step / STEPS_PER_BEAT) * STEPS_PER_BEAT };
        play('level');
      },
      // a tape stop: what is sounding bends down and fades out, what was scheduled ahead never starts
      stopSong() {
        stopTimer();
        queued = null;
        wanted = null;
        if (!ctx || !song) { song = null; return; }
        const now = ctx.currentTime;
        cancelAhead(now);
        for (const v of live) {
          if (v.hz > 0) glide(v.src.frequency, Math.max(20, v.hz * 0.25), now + TAPE_STOP_S);
          else v.src.playbackRate.linearRampToValueAtTime(0.25, now + TAPE_STOP_S);
        }
        live = [];
        const g = nodes.music.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(MUSIC, now);
        g.linearRampToValueAtTime(0, now + TAPE_STOP_S);
        song = null;
      },
      setFeel(f) {
        const boosted = !!f.boosted;
        feel.timeScale = Math.max(0.25, Math.min(1, f.timeScale || 1));
        if (nodes && boosted !== feel.boosted) nodes.filter.frequency.setTargetAtTime(boosted ? BRIGHT_HZ : DULL_HZ, ctx.currentTime, 0.08);
        feel.boosted = boosted;
      },
      play,
      suspend() { if (ctx && ctx.suspend) ctx.suspend(); },
      resume() { if (ctx && ctx.resume) ctx.resume(); },
      tick,
      // where the music is, for lining things up with the beat later
      beat() {
        if (!ctx || !song) return null;
        const s = song.clock.step;
        const toBeat = (STEPS_PER_BEAT - (s % STEPS_PER_BEAT)) % STEPS_PER_BEAT;
        return { level: song.level, step: s, from: song.from, nextBeatTime: song.clock.next + toBeat * stepDur() };
      },
      _nodes: () => nodes,
    };
  }

  const api = { TILES_PER_BEAT, STEPS_PER_BEAT, STEPS_PER_BAR, songBpm, degreeToMidi, midiToHz, SONGS, notesAt, advanceClock, SFX, createEngine };

  root.TumbleAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
