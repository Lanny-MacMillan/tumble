// Pure game logic: no DOM, no timers. Loaded by index.html and by node tests.
(function (root) {
  'use strict';

  // Everything below scales from CUBE so a size change keeps the feel.
  const CUBE = 26;
  const TILE = CUBE;
  const FLOOR_Y = 420;
  const METER_PX = 40;

  const GRAVITY = Math.round(CUBE * 93.6);
  const JUMP_V = Math.round(CUBE * 18);
  const HOLD_GRAVITY = 0.55;
  const RELEASE_GRAVITY = 1.7;
  const FALL_GRAVITY = 1.3;
  const COYOTE = 0.09;
  const BUFFER = 0.10;
  // a tap jump (~0.24s in the air) gets close to a quarter turn; landing settles forward
  const SPIN = Math.PI / 2 / 0.27;

  const SPEED_MIN = CUBE * 13.5;
  const SPEED_MAX = CUBE * 26;
  // run levels: the metres at which each level starts, and the six-step speed climb they drive
  const LEVEL_STARTS_M = [0, 300, 600, 1200, 2000, 3000, 5000];
  const LAST_LEVEL = LEVEL_STARTS_M.length - 1;
  const LEVEL_EASE_PX = TILE * 6;

  const CUBE_INSET = 2;
  const LEDGE_FORGIVE = 6;
  const SPIKE_HIT_W = 0.5;
  const SPIKE_HIT_H = 0.6;
  // tunnel spikes are low studs (drawn at half height) so a plain tap clears them
  const SPIKE_LOW_HIT_H = 0.35;
  const PLATFORM_THICK = 0.35;
  const RESTART_LOCK = 0.25;
  const VOID_DEPTH = TILE * 3;

  const PAD = 3;
  const MAX_H = 3;
  const LOOKAHEAD_PX = TILE * 70;
  // The hardest tier a piece may have at a given distance and level. Everything exists from the start in an
  // easy form; levels (and distance inside a level) only raise the cap. The first stretch is plain on purpose.
  const TIER_STEP_M = 120;
  const PLAIN_START_M = 40;
  const MAX_DIFF = 4;
  const ZONE_M = 250;

  // Page geometry the level design relies on (the page scales to keep at least this much in view).
  const VIEW_H = 540;
  const MIN_VIEW_W = 1170;
  const CUBE_SCREEN_X = 150;
  const CUE_WARN_S = 1.5;

  // Crumbling tiles, moving platforms and tunnels.
  const CRUMBLE_DELAY = 0.5;
  const CRUMBLE_SHAKE = 0.25;
  const MOVER_PHASES = 16;
  const MOVER_SAMPLE_MAX_TILES = 0.15;
  const MOVER_MAX_SPEED = TILE * 1.5;
  const MIN_TUNNEL_CLEAR = 2.5;
  const TUNNEL_CLEAR = 3.8;
  const TUNNEL_CUE_HOLD = 6;
  // press this long before reaching the stud; the start ring is drawn where that is at the speed of the moment
  const CUE_LEAD_S = 0.15;

  // Boost pads and orbs.
  const BOOST_MUL = 1.3;
  const BOOST_RUN_TILES = 30;
  const BOOST_RAMP_TILES = 6;
  const BOOST_CAP = SPEED_MAX * BOOST_MUL;
  const ORB_R_TILES = 0.9;
  const ORB_HOLD = 14;
  const ORB_HOLD_MAX = 36;
  const ORB_RING_H = 1;
  const ORB_LEAD = 5;
  const ORB_ENTRY_CUE = 1;
  const ORB_EXIT_S = 0.45;
  // passing through a ring throws the cube up on its own, the same arc whatever the buttons do (about as high as the
  // short hop a tap in the ring used to give)
  const ORB_APEX_TILES = 2.1;
  const SIM_DT = 1 / 120;

  // Warp portals: a wall too tall to jump, with a twin portal past it. Tall enough that even a full anti-gravity
  // jump off a ring stays under it by a clear margin (a test holds that).
  const WARP_WALL_H = 11;
  // Flip portals turn the picture upside down (drawing only: the physics never sees them). The next one is
  // kept at least this far away so the view never flips back and forth.
  const FLIP_MIN_GAP_TILES = 60;
  // rage-bait traps keep at least this much ordinary track between them
  const TRAP_MIN_GAP_TILES = 40;

  // Slow-time and anti-gravity fields.
  const SLOW_SCALE = 0.5;
  const FLOAT_GRAVITY = 0.4;
  const FIELD_RAMP_TILES = 3;

  // Limits the chunk set must stay under, derived from the physics above.
  const FAIRNESS = 0.7;
  const MAX_HAZARDS_PER_JUMP = 3;
  const JUMP_PEAK = (JUMP_V * JUMP_V) / (2 * GRAVITY * HOLD_GRAVITY);
  // A bounce pad throws the cube up whatever the input: apex 1.8 times that of a full hold jump (about 5.7 tiles).
  // The platform it is meant to reach hangs 4 tiles up, a full tile and a half above what any plain jump reaches.
  const BOUNCE_APEX_MUL = 1.8;
  const BOUNCE_V = JUMP_V * Math.sqrt(BOUNCE_APEX_MUL);
  const BOUNCE_PEAK = (BOUNCE_V * BOUNCE_V) / (2 * GRAVITY * HOLD_GRAVITY);
  const BOUNCE_PLATFORM_H = 4;
  const ORB_V = Math.sqrt(2 * GRAVITY * HOLD_GRAVITY * ORB_APEX_TILES * TILE);

  // The shield: one hit from any hazard is absorbed, then a short spell in which hazards do nothing. Terrain is never a
  // hazard (walls, roofs, the undersides and sides of blocks, the void), so no shield saves you from those.
  const SHIELD_INV_S = 0.6;
  const PICKUP_R_TILES = 0.8;
  // A laser gate: an always-on beam too tall to jump, one tile wide. Only a shield gets you through, and the shield
  // for it hangs this many tiles before it, 2.2 tiles up so a hop takes it and a walk does not.
  const GATE_PICKUP_DIST_TILES = 14;
  const GATE_PICKUP_H = 2.2;
  // A drop trap: a spiked block hangs 4.5 tiles up over the path and falls when the cube is 12 tiles away, which is
  // earlier than the cube can reach it even at the top speed with a boost, and lands as a 9-wide, 3-tall wall of spikes.
  // The shield for it hangs 20 tiles before it. The shield breaks the whole block, not just the first moment of touching.
  const DROP_PICKUP_DIST_TILES = 20;
  const DROP_TRIGGER_TILES = 12;
  const DROP_HANG_TILES = 4.5;
  const DROP_W_TILES = 9;
  const DROP_H_TILES = 3;
  const DROP_G = GRAVITY;
  // A vanishing floor: solid-looking ground with an arch of gems over it. It shakes when the cube is 17 tiles from the
  // edge (half a second at the top speed with a boost) and falls away, leaving a gap the gems jump. The gap is plain
  // geometry; only the drawing knows the floor was ever there.
  const VANISH_TRIGGER_TILES = 17;
  const VANISH_LEAD = 19;
  const VANISH_HOLD = 114;
  const VANISH_EXIT = 6;
  // Pop-up spikes: a gap, then two studs on the first tiles of the far side that stand up when the cube is 17 tiles away.
  // A short hop lands on them; the long hop the gems show flies over. The studs are plain spikes in the world; only the
  // drawing keeps them flat until the trigger.
  const POP_TRIGGER_TILES = 17;
  const POP_LEAD = 19;
  const POP_HOLD = 114;
  const POP_EXIT = 6;
  const POP_SPIKES = 2;
  // A slam roof: a hatched slab hangs high over a flat stretch and drops to 1.15 tiles above the floor when the cube is
  // 17 tiles away. A cube on the floor passes under it with a hair to spare; anything airborne at the edge, or any press
  // made under it, hits the underside. The roof is ordinary ceiling in the world; only the drawing hangs it.
  const SLAM_TRIGGER_TILES = 17;
  const SLAM_LEAD = 19;
  const SLAM_CLEAR = 1.15;
  const SLAM_EXIT = 6;
  const AIR_TIME_FULL = JUMP_V / (GRAVITY * HOLD_GRAVITY) + Math.sqrt((2 * JUMP_PEAK) / (GRAVITY * FALL_GRAVITY));
  const JUMP_RANGE_MAX_TILES = (SPEED_MAX * AIR_TIME_FULL) / TILE;
  const MAX_STEP_TILES = Math.floor((JUMP_PEAK * 0.7) / TILE);
  const MAX_GAP_TILES = Math.floor((SPEED_MIN * AIR_TIME_FULL * FAIRNESS) / TILE);
  const CRUMBLE_MAX_TILES = Math.floor((SPEED_MIN * CRUMBLE_DELAY * 0.7) / TILE);
  // how far ahead the view shows the world, and how long that warns a player at top speed
  const VIEW_AHEAD_PX = MIN_VIEW_W - CUBE_SCREEN_X;
  const CUE_WARN_AT_MAX_S = VIEW_AHEAD_PX / SPEED_MAX;

  // biggest vertical move of a platform top between two neighbouring phase samples, in tiles
  function moverSampleStep(m) { return m.amp * 2 * Math.sin(Math.PI / MOVER_PHASES); }
  function moverSpeed(m) { return (m.amp * TILE * 2 * Math.PI) / m.period; }

  function levelAt(distPx) {
    const m = Math.max(0, distPx) / METER_PX;
    let k = 0;
    while (k < LAST_LEVEL && m >= LEVEL_STARTS_M[k + 1]) k++;
    return k;
  }

  // top speed of level k: six equal ratio steps from SPEED_MIN to SPEED_MAX
  function levelSpeed(k) {
    return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, Math.min(Math.max(k, 0), LAST_LEVEL) / LAST_LEVEL);
  }

  // speed is a pure function of distance: it eases from the old level's speed to the new one
  function speedAt(distPx) {
    const k = levelAt(distPx);
    if (k === 0) return SPEED_MIN;
    const into = distPx - LEVEL_STARTS_M[k] * METER_PX;
    const f = Math.min(1, Math.max(0, into / LEVEL_EASE_PX));
    const e = f * f * (3 - 2 * f);
    return levelSpeed(k - 1) + (levelSpeed(k) - levelSpeed(k - 1)) * e;
  }

  // Showcase speed at track position x: the level of the last mark passed, eased in over LEVEL_EASE_PX like a
  // normal level up. A normal world has no marks and uses speedAt(distance) instead.
  function showcaseAt(world, x) {
    let level = 0, from = 0, x0 = -Infinity;
    for (const m of world.levelMarks) {
      if (m.x > x) break;
      from = level; level = m.level; x0 = m.x;
    }
    return { level, from, x0 };
  }
  function showcaseSpeedAt(world, x) {
    const s = showcaseAt(world, x);
    const f = Math.min(1, Math.max(0, (x - s.x0) / LEVEL_EASE_PX));
    const e = f * f * (3 - 2 * f);
    return levelSpeed(s.from) + (levelSpeed(s.level) - levelSpeed(s.from)) * e;
  }

  function heatAt(level) { return Math.min(2.5, 0.4 + 0.45 * level); }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- chunks -------------------------------------------------------------

  function makeChunk(name, diff, entryH, exitH, core) {
    const w = PAD * 2 + core.w;
    const raw = [{ x0: 0, x1: PAD, h: entryH }];
    for (const g of core.ground || []) raw.push({ x0: g.x0 + PAD, x1: g.x1 + PAD, h: g.h });
    raw.push({ x0: PAD + core.w, x1: w, h: exitH });
    raw.sort((a, b) => a.x0 - b.x0);
    const ground = [];
    for (const s of raw) {
      if (s.x1 <= s.x0) continue;
      const prev = ground[ground.length - 1];
      if (prev && prev.x1 === s.x0 && prev.h === s.h) prev.x1 = s.x1;
      else ground.push({ x0: s.x0, x1: s.x1, h: s.h });
    }
    const spikes = (core.spikes || []).map(s => (s.low ? { x: s.x + PAD, h: s.h, low: true } : { x: s.x + PAD, h: s.h }));
    const platforms = (core.platforms || []).map(p => ({ x: p.x + PAD, w: p.w, h: p.h }));
    const moving = (core.moving || []).map(m => ({ x: m.x + PAD, w: m.w, h: m.h, amp: m.amp }));
    const crumble = (core.crumble || []).map(p => ({ x: p.x + PAD, w: p.w, h: p.h }));
    const ceilings = (core.ceilings || []).map(c => ({ x0: c.x0 + PAD, x1: c.x1 + PAD, h: c.h, clear: c.clear }));
    const guides = [];
    const cue = (core.cue || []).map(c => {
      if (c.kind === 'jump') return { kind: 'jump', at: c.at + PAD, hold: c.hold };
      if (c.kind === 'orb') return { kind: 'orb', x: c.x + PAD, hold: c.hold };
      return { spike: c.spike + PAD, hold: c.hold };
    });
    const pads = (core.pads || []).map(p => ({ x: p.x + PAD, w: p.w, h: p.h === undefined ? entryH : p.h }));
    const orbs = (core.orbs || []).map(o => ({ x: o.x + PAD, h: o.h }));
    const period = core.period || 0;
    const fields = (core.fields || []).map(f => ({ kind: f.kind, x0: f.x0 + PAD, x1: f.x1 + PAD }));
    const warps = (core.warps || []).map(q => ({ a: q.a + PAD, b: q.b + PAD }));
    const flips = (core.flips || []).map(q => ({ x: q.x + PAD }));
    // floating blocks: x and width in tiles, underside and top as heights above the floor in tiles
    const bounces = (core.bounces || []).map(q => ({ x: q.x + PAD, w: q.w }));
    // a pickup floats at height h (tiles above the floor, to its centre) at tile x
    const pickups = (core.pickups || []).map(q => ({ x: q.x + PAD, h: q.h }));
    const gates = (core.gates || []).map(q => ({ x: q.x + PAD, w: q.w, kind: q.kind || 'laser', trigger: q.trigger, hang: q.hang, hgt: q.hgt }));
    const boxes = (core.boxes || []).map(q => ({ x: q.x + PAD, w: q.w, bottom: q.top - (q.thick || 1), top: q.top }));
    const walls = (core.walls || []).map(q => ({ x: q.x + PAD, w: q.w, h: q.h }));
    const vanish = (core.vanish || []).map(q => ({ x: q.x + PAD, w: q.w }));
    const pops = (core.pops || []).map(q => ({ x: q.x + PAD, w: q.w }));
    const slams = (core.slams || []).map(q => ({ x: q.x + PAD, w: q.w }));

    // longest unsupported run and tallest hop, in tiles, for the limit tests
    let maxGap = 0;
    for (let x = 0; x < w; x += 0.25) {
      if (supported(x)) continue;
      let end = x;
      while (end < w && !supported(end)) end += 0.25;
      maxGap = Math.max(maxGap, end - x);
      x = end;
    }
    function supported(x) {
      return ground.some(g => x >= g.x0 && x < g.x1) || platforms.some(p => x >= p.x && x < p.x + p.w) ||
        moving.some(p => x >= p.x && x < p.x + p.w) || crumble.some(p => x >= p.x && x < p.x + p.w) ||
        boxes.some(p => x >= p.x && x < p.x + p.w);
    }
    let maxStep = 0;
    for (let i = 1; i < ground.length; i++) maxStep = Math.max(maxStep, ground[i].h - ground[i - 1].h);
    for (const p of platforms) {
      const under = Math.max(...ground.map(g => g.h));
      maxStep = Math.max(maxStep, p.h - Math.min(entryH, exitH, under));
    }
    for (const p of moving) maxStep = Math.max(maxStep, p.h + p.amp - Math.min(entryH, exitH));
    for (const p of crumble) maxStep = Math.max(maxStep, p.h - Math.min(entryH, exitH));
    // a block hung too high to reach from the ground (clear all the way under it) is not a step anyone has to climb
    const groundTop = Math.max(entryH, exitH, ...ground.map(g => g.h));
    for (const p of boxes) if (p.bottom < groundTop + MIN_TUNNEL_CLEAR) maxStep = Math.max(maxStep, p.top - Math.min(entryH, exitH));
    // raised ground drawn as bricks (the physics is plain ground): each block stands down to the lowest ground of the chunk
    const baseH = Math.min(entryH, exitH, ...(core.ground || []).map(g => g.h));
    const blocks = (core.ground || []).filter(g => g.block).map(g => ({ x0: g.x0 + PAD, x1: g.x1 + PAD, h: g.h }));
    const tunnel = ceilings.length > 0;
    return {
      name, diff, entryH, exitH, w, ground, spikes, platforms, moving, crumble, ceilings, guides, cue, period, tunnel,
      pads, orbs, fields, warps, walls, flips, blocks, baseH, boxes, bounces, pickups, gates, needsBounce: !!core.needsBounce, needsField: !!core.needsField, needsVanish: !!core.needsVanish, needsPop: !!core.needsPop, vanish, pops, slams, trap: !!core.trap, boost: pads.length > 0, minLevel: core.minLevel || 0,
      steadyLevel: core.steadyLevel === undefined ? null : core.steadyLevel, needsOrb: !!core.needsOrb,
      maxGap, maxStep,
    };
  }

  // A tunnel: a low roof with a spike to hop under. The roof is the cue, and `cue` says where a
  // player following the guide markers starts the hop and how long they hold it.
  function TUNNEL1(h) {
    return {
      w: 12, ground: [{ x0: 0, x1: 12, h }], spikes: [{ x: 8, h, low: true }],   // four tiles of lead-in under the roof
      ceilings: [{ x0: 0, x1: 12 + PAD, h, clear: TUNNEL_CLEAR }],
      cue: [{ spike: 8, hold: TUNNEL_CUE_HOLD }],
    };
  }
  // two low studs, seven tiles apart, so it is two separate taps
  function TUNNEL2(h) {
    return {
      w: 18, ground: [{ x0: 0, x1: 18, h }], spikes: [{ x: 7, h, low: true }, { x: 14, h, low: true }],
      ceilings: [{ x0: 0, x1: 18 + PAD, h, clear: TUNNEL_CLEAR }],
      cue: [{ spike: 7, hold: TUNNEL_CUE_HOLD }, { spike: 14, hold: TUNNEL_CUE_HOLD }],
    };
  }

  function smooth01(f) { const q = Math.min(1, Math.max(0, f)); return q * q * (3 - 2 * q); }
  function fieldWeight(f, x) {
    const ramp = FIELD_RAMP_TILES * TILE;
    return smooth01((x - f.x0) / ramp) * smooth01((f.x1 - x) / ramp);
  }
  // how much slower time runs at the cube's position, and how much weaker gravity is. Both are functions of x.
  function timeScale(world, c) {
    let ts = 1;
    const cx = c.x + CUBE / 2;
    for (const f of world.fields) if (f.kind === 'slow' && cx > f.x0 && cx < f.x1) ts *= 1 - (1 - SLOW_SCALE) * fieldWeight(f, cx);
    return ts;
  }
  function gravMul(world, c) {
    let gm = 1;
    const cx = c.x + CUBE / 2;
    for (const f of world.fields) if (f.kind === 'anti' && cx > f.x0 && cx < f.x1) gm *= 1 - (1 - FLOAT_GRAVITY) * fieldWeight(f, cx);
    return gm;
  }
  // seconds a full-hold jump stays in the air with anti-gravity at full strength
  function floatAirTime() {
    let vy = -JUMP_V, h = 0;
    for (let i = 0; i < 2000; i++) {
      let g = GRAVITY * FLOAT_GRAVITY;
      if (vy < 0) g *= i < 57 ? HOLD_GRAVITY : RELEASE_GRAVITY; else g *= FALL_GRAVITY;
      vy += g * SIM_DT;
      h -= vy * SIM_DT;
      if (h <= 0 && vy > 0) return (i + 1) * SIM_DT;
    }
    return null;
  }
  const FLOAT_RANGE_MUL = floatAirTime() / AIR_TIME_FULL;

  // speed multiplier while a boost is running: eases up, holds, eases down, all as a function of x
  function boostMul(c) {
    if (c.boostX0 === null || c.boostX0 === undefined) return 1;
    const run = BOOST_RUN_TILES * TILE, ramp = BOOST_RAMP_TILES * TILE;
    const d = c.x - c.boostX0;
    if (d <= 0 || d >= run) return 1;
    const sm = f => { const q = Math.min(1, Math.max(0, f)); return q * q * (3 - 2 * q); };
    return 1 + (BOOST_MUL - 1) * Math.min(sm(d / ramp), sm((run - d) / ramp));
  }

  // height (px above the press point, up is positive) after each step of a press with `hold` steps held; v0 is the
  // throw speed (a jump unless given), and a hold of Infinity is a throw that rises on the held arc whatever the input
  function hopHeights(hold, steps, gm, v0) {
    const out = [];
    let vy = -(v0 || JUMP_V), h = 0;
    for (let i = 0; i < steps; i++) {
      let g = GRAVITY * (gm || 1);
      if (vy < 0) g *= i < hold ? HOLD_GRAVITY : RELEASE_GRAVITY; else g *= FALL_GRAVITY;
      vy += g * SIM_DT;
      h -= vy * SIM_DT;
      out.push(h);
    }
    return out;
  }
  // seconds until the hop is going down through `target` px above the press point
  function hopCrossing(hold, target, v0) {
    const hs = hopHeights(hold, 900, 1, v0);
    for (let i = 1; i < hs.length; i++) if (hs[i] <= target && hs[i - 1] > target) return (i + 1) * SIM_DT;
    return null;
  }

  // A wide gap with a bridge of orbs, sized from the physics at the level's own speed so a plain
  // jump cannot cross it and a player who jumps at the gems is carried across, ring to ring.
  function orbGapCore(k, h) {
    const S = levelSpeed(k);
    const tps = S / TILE;
    const RH = ORB_RING_H * TILE;
    const plain = (S * (AIR_TIME_FULL + COYOTE)) / TILE + 2;
    const xs = ORB_LEAD - ORB_ENTRY_CUE;
    // each ring throws from its centre and the throw comes back down through the next ring's centre
    const tRet = hopCrossing(Infinity, 0, ORB_V), tLand = hopCrossing(Infinity, -RH, ORB_V);
    // two rings when they can do it (the gentlest form), more only if needed; the shortest take-off press that works
    for (let n = 2; n <= 9; n++) {
      for (let hold = ORB_HOLD; hold <= ORB_HOLD_MAX; hold += 2) {
        const t1 = hopCrossing(hold, RH);
        if (t1 === null) continue;
        const rings = [xs + tps * t1];
        for (let i = 1; i < n; i++) rings.push(rings[i - 1] + tps * tRet);
        const land = rings[n - 1] + tps * tLand;
        const gap = Math.floor(land - 1.5 - ORB_LEAD);
        if (gap < plain) continue;
        // flat run after the landing, so whatever follows has its usual room to be jumped
        const exit = Math.ceil(tps * ORB_EXIT_S);
        return {
          w: ORB_LEAD + gap + exit, ground: [{ x0: 0, x1: ORB_LEAD, h }, { x0: ORB_LEAD + gap, x1: ORB_LEAD + gap + exit, h }],
          orbs: rings.map(x => ({ x, h: h + 0.5 + ORB_RING_H })),
          cue: [{ kind: 'jump', at: xs, hold }].concat(rings.map(x => ({ kind: 'orb', x }))),
          steadyLevel: k, minLevel: 0, needsOrb: true,
        };
      }
    }
    throw new Error('no orb gap fits level ' + k);
  }

  // A gap in ground that looks solid until the cube is close, sized for its level's speed so one full hop at the gems
  // clears it and a walker falls.
  function vanishCore(k, h) {
    const S = levelSpeed(k);
    const xs = VANISH_LEAD - ORB_ENTRY_CUE;
    const land = xs + (S * hopCrossing(VANISH_HOLD, 0)) / TILE;
    const gap = Math.floor(land - 1.5 - VANISH_LEAD) - 1;
    if (gap < 3) throw new Error('no vanishing floor fits level ' + k);
    const w = VANISH_LEAD + gap + VANISH_EXIT;
    return {
      w, ground: [{ x0: 0, x1: VANISH_LEAD, h }, { x0: VANISH_LEAD + gap, x1: w, h }],
      vanish: [{ x: VANISH_LEAD, w: gap }],
      cue: [{ kind: 'jump', at: xs, hold: VANISH_HOLD }],
      steadyLevel: k, minLevel: 0, needsVanish: true, trap: true,
    };
  }

  // A gap with two pop-up studs right after it. The gap grows with the level (3 tiles at level 0, 9 at level 6) so that
  // at every speed a hop held for 0.2 s or less lands on the studs and a full hold lands past them.
  function popCore(k, h) {
    const gap = k + 3;
    const w = POP_LEAD + gap + POP_SPIKES + POP_EXIT;
    return {
      w, ground: [{ x0: 0, x1: POP_LEAD, h }, { x0: POP_LEAD + gap, x1: w, h }],
      spikes: [{ x: POP_LEAD + gap, h }, { x: POP_LEAD + gap + 1, h }],
      pops: [{ x: POP_LEAD + gap, w: POP_SPIKES }],
      cue: [{ kind: 'jump', at: POP_LEAD - ORB_ENTRY_CUE, hold: POP_HOLD }],
      steadyLevel: k, minLevel: 0, needsPop: true, trap: true,
    };
  }

  function slamCore(len, h) {
    const w = SLAM_LEAD + len + SLAM_EXIT;
    return { w, ground: [{ x0: 0, x1: w, h }], slams: [{ x: SLAM_LEAD, w: len }], trap: true };
  }

  // A gap that a plain jump cannot cross but a jump in anti-gravity can, with the field over the whole chunk.
  function floatGapCore(k, h) {
    const S = levelSpeed(k);
    const plain = (S * (AIR_TIME_FULL + COYOTE)) / TILE + 2;
    const range = (S * floatAirTime()) / TILE;
    const gap = Math.ceil(plain);
    if (range < gap + 1.5) throw new Error('no float gap fits level ' + k);
    const xs = ORB_LEAD - ORB_ENTRY_CUE;
    const exit = Math.ceil(range - gap) + 3;
    const w = ORB_LEAD + gap + exit;
    return {
      w, ground: [{ x0: 0, x1: ORB_LEAD, h }, { x0: ORB_LEAD + gap, x1: w, h }],
      fields: [{ kind: 'anti', x0: 0, x1: w }],
      cue: [{ kind: 'jump', at: xs, hold: 57 }],
      steadyLevel: k, minLevel: 0, needsField: true,
    };
  }

  // The wall-and-portal lesson. The entry portal A is on the floor, the wall starts a tile after it, and the exit
  // portal B is three tiles past the wall with a long flat landing. Running on through A is the whole answer.
  // `extra` adds studs (before A or after B) or a gap in the landing for the harder forms.
  function warpCore(h, extra) {
    const x = extra || {};
    const A = x.a === undefined ? 2 : x.a;
    const B = A + 5;
    const w = x.w || (B + 11);
    const ground = x.gapAt === undefined ? [{ x0: 0, x1: w, h }] : [{ x0: 0, x1: x.gapAt, h }, { x0: x.gapAt + 3, x1: w, h }];
    return {
      w, ground, warps: [{ a: A, b: B }], walls: [{ x: A + 1, w: 1, h: WARP_WALL_H }],
      spikes: (x.studs || []).map(sx => ({ x: sx, h })),
    };
  }

  // A flat stretch with a flip portal: three flat tiles before it, eight after, and nothing else in it. The
  // pieces either side keep their own hazards at least three tiles from the ends, so no hazard is nearer than 8.
  function flipCore(h) {
    return { w: 5, ground: [{ x0: 0, x1: 5, h }], flips: [{ x: 0 }] };
  }

  function buildChunkSet() {
    const set = [];
    const add = (...a) => set.push(makeChunk(...a));
    for (let h = 0; h <= MAX_H; h++) {
      add(`flat@${h}`, 0, h, h, { w: 2, ground: [{ x0: 0, x1: 2, h }] });
      add(`gap2@${h}`, 0, h, h, { w: 2 });
      add(`gap3@${h}`, 1, h, h, { w: 3 });
      add(`spike1@${h}`, 0, h, h, { w: 3, ground: [{ x0: 0, x1: 3, h }], spikes: [{ x: 1, h }] });
      add(`spike2@${h}`, 1, h, h, { w: 4, ground: [{ x0: 0, x1: 4, h }], spikes: [{ x: 1, h }, { x: 2, h }] });
      add(`spike3@${h}`, 2, h, h, { w: 5, ground: [{ x0: 0, x1: 5, h }], spikes: [{ x: 1, h }, { x: 2, h }, { x: 3, h }] });
      add(`spikeGap@${h}`, 2, h, h, { w: 8, ground: [{ x0: 0, x1: 6, h }], spikes: [{ x: 1, h }] });
      add(`hops@${h}`, 3, h, h, { w: 19, ground: [{ x0: 0, x1: 19, h }], spikes: [{ x: 1, h }, { x: 9, h }, { x: 17, h }] });
      add(`doubleGap@${h}`, 3, h, h, { w: 6, ground: [{ x0: 2, x1: 4, h }] });
      add(`platGap@${h}`, 2, h, h, { w: 5, platforms: [{ x: 1.5, w: 2, h: h + 2 }] });
      add(`spikeRun@${h}`, 4, h, h, { w: 27, ground: [{ x0: 0, x1: 27, h }], spikes: [{ x: 1, h }, { x: 2, h }, { x: 12, h }, { x: 22, h }, { x: 23, h }] });
      add(`gapSpike@${h}`, 4, h, h, { w: 9, ground: [{ x0: 3, x1: 9, h }], spikes: [{ x: 6, h }] });
      // boost: a lit pad, a long runway proven at boosted speed, ramps in and out inside the chunk
      add(`boostRun@${h}`, 1, h, h, {
        w: 30, ground: [{ x0: 0, x1: 20, h }, { x0: 22, x1: 30, h }], spikes: [{ x: 9, h }],
        pads: [{ x: 0, w: 3 }],
      });
      for (let k = 0; k <= LAST_LEVEL; k++) add(`orbGap${k}@${h}`, 1, h, h, orbGapCore(k, h));
      // fields: slowed time and anti-gravity
      add(`slowRun@${h}`, 0, h, h, { w: 16, ground: [{ x0: 0, x1: 7, h }, { x0: 9, x1: 16, h }], spikes: [{ x: 12, h }], fields: [{ kind: 'slow', x0: 0, x1: 16 }] });
      add(`slowSpikes@${h}`, 2, h, h, { w: 14, ground: [{ x0: 0, x1: 14, h }], spikes: [{ x: 4, h }, { x: 5, h }, { x: 6, h }], fields: [{ kind: 'slow', x0: 0, x1: 14 }] });
      for (let k = 0; k <= LAST_LEVEL; k++) add(`floatGap${k}@${h}`, 1, h, h, floatGapCore(k, h));
      for (let k = 0; k <= LAST_LEVEL; k++) add(`vanish${k}@${h}`, 2, h, h, vanishCore(k, h));
      for (let k = 0; k <= LAST_LEVEL; k++) add(`popSpikes${k}@${h}`, 3, h, h, popCore(k, h));
      add(`slamRoof@${h}`, 2, h, h, slamCore(10, h));
      add(`slamLong@${h}`, 3, h, h, slamCore(18, h));
      add(`floatRun@${h}`, 2, h, h, { w: 20, ground: [{ x0: 0, x1: 20, h }], spikes: [{ x: 5, h }, { x: 6, h }, { x: 13, h }], fields: [{ kind: 'anti', x0: 0, x1: 20 }] });
      // easy variety for the first stretch
      add(`spikesApart@${h}`, 0, h, h, { w: 9, ground: [{ x0: 0, x1: 9, h }], spikes: [{ x: 1, h }, { x: 7, h }] });
      add(`crumbleBridge@${h}`, 0, h, h, { w: 2, crumble: [{ x: 0, w: 2, h }] });
      add(`moveStone@${h}`, 1, h, h, { w: 5, moving: [{ x: 1.5, w: 2, h: h + 1, amp: 0.35 }], period: 2.4 });
      add(`crumbleRun@${h}`, 2, h, h, { w: 8, crumble: [{ x: 0, w: 2, h }, { x: 3, w: 2, h }, { x: 6, w: 2, h }] });
      add(`warpWall@${h}`, 1, h, h, warpCore(h));
      add(`warpSpike@${h}`, 2, h, h, warpCore(h, { a: 8, studs: [2, 8 + 5 + 6], w: 8 + 5 + 14 }));
      add(`warpGap@${h}`, 2, h, h, warpCore(h, { gapAt: 2 + 5 + 3, w: 2 + 5 + 17 }));
      add(`flipPad@${h}`, 1, h, h, flipCore(h));
      // a drop trap and the shield that breaks it: the pickup, 20 tiles of flat ground, then the block that falls when
      // the cube is 12 tiles away, and a long landing
      add(`shieldDrop@${h}`, 3, h, h, {
        w: 6 + DROP_PICKUP_DIST_TILES + DROP_W_TILES + 8, ground: [{ x0: 0, x1: 6 + DROP_PICKUP_DIST_TILES + DROP_W_TILES + 8, h }],
        pickups: [{ x: 6, h: h + GATE_PICKUP_H }],
        gates: [{ x: 6 + DROP_PICKUP_DIST_TILES, w: DROP_W_TILES, kind: 'drop', trigger: DROP_TRIGGER_TILES, hang: DROP_HANG_TILES, hgt: DROP_H_TILES }],
        cue: [{ spike: 6, hold: ORB_HOLD }],
      });
      // a laser gate and the shield that gets you through it: a hop takes the pickup, then flat ground to the beam
      // GATE_PICKUP_DIST_TILES later, and a long landing. Nothing else is in between.
      add(`shieldLaser@${h}`, 2, h, h, {
        w: 6 + GATE_PICKUP_DIST_TILES + 1 + 7, ground: [{ x0: 0, x1: 6 + GATE_PICKUP_DIST_TILES + 1 + 7, h }],
        pickups: [{ x: 6, h: h + GATE_PICKUP_H }], gates: [{ x: 6 + GATE_PICKUP_DIST_TILES, w: 1 }],
        cue: [{ spike: 6, hold: ORB_HOLD }],
      });
      // a bounce pad two tiles past the run-up, a gap too wide to jump at slow speeds, and a platform four tiles up that
      // the bounce lands on at any speed (it throws the cube 8.5 tiles at the slowest speed and 16.5 at the fastest)
      add(`bounceUp@${h}`, 1, h, h, {
        w: 29, ground: [{ x0: 0, x1: 6, h }, { x0: 26, x1: 29, h }], bounces: [{ x: 2, w: 2 }],
        platforms: [{ x: 8, w: 15.5, h: h + BOUNCE_PLATFORM_H }], needsBounce: true,
      });
      // square blocks: raised ground drawn as bricks, each with a two-tile run-up before its first wall
      if (h + 1 <= MAX_H) {
        add(`blockHop@${h}`, 0, h, h, { w: 7, ground: [{ x0: 2, x1: 3, h: h + 1, block: true }, { x0: 6, x1: 7, h: h + 1, block: true }] });
        add(`blockSpike@${h}`, 2, h, h, { w: 7, ground: [{ x0: 2, x1: 3, h: h + 1, block: true }], spikes: [{ x: 2, h: h + 1 }] });   // a long landing after the jump
      }
      // floating blocks: a block hung MIN_TUNNEL_CLEAR above the ground (the same clearance as a tunnel roof) that you
      // may run under, and that kills you if you jump into it
      add(`floatBlock@${h}`, 1, h, h, { w: 6, ground: [{ x0: 0, x1: 6, h }], boxes: [{ x: 0, w: 3, top: h + MIN_TUNNEL_CLEAR + 1 }] });
      // stepping stones over a gap, each one a floating block you land on from above
      if (h + 2 <= MAX_H) add(`blockBridge@${h}`, 2, h, h, { w: 10, boxes: [{ x: 2, w: 2, top: h + 1 }, { x: 6, w: 2, top: h + 2 }] });
      if (h + 2 <= MAX_H) add(`blockTower@${h}`, 1, h, h, { w: 9, ground: [{ x0: 4, x1: 6, h: h + 2, block: true }], spikes: [{ x: 7, h }] });   // four tiles of run-up
      add(`tunnel1@${h}`, 1, h, h, TUNNEL1(h));
      add(`tunnel2@${h}`, 2, h, h, TUNNEL2(h));
      if (h + 1 <= MAX_H) add(`bump@${h}`, 0, h, h, { w: 4, ground: [{ x0: 2, x1: 4, h: h + 1 }] });  // two tiles of run-up before the wall
      if (h - 1 >= 0) add(`dip@${h}`, 0, h, h, { w: 2, ground: [{ x0: 0, x1: 2, h: h - 1 }] });
      if (h + 1 <= MAX_H) {
        // the wall of each step-up sits two tiles past the entry pad, so a late landing still has room to jump it
        add(`up1@${h}`, 0, h, h + 1, { w: 2, ground: [{ x0: 0, x1: 2, h }] });
        add(`gapUp1@${h}`, 2, h, h + 1, { w: 5, ground: [{ x0: 0, x1: 2, h }] });
        add(`plateauSpike@${h}`, 2, h, h + 1, { w: 8, ground: [{ x0: 0, x1: 2, h }, { x0: 2, x1: 8, h: h + 1 }], spikes: [{ x: 4, h: h + 1 }] });
      }
      if (h === 0) {
        // steps are five tiles deep: at two or three tiles there is no fair window to land and jump again at some speed
        add(`blockStairsUp@0`, 1, 0, 3, { w: 17, ground: [{ x0: 2, x1: 7, h: 1, block: true }, { x0: 7, x1: 12, h: 2, block: true }, { x0: 12, x1: 17, h: 3, block: true }] });
      }
      if (h === 3) {
        add(`blockStairsDown@3`, 1, 3, 0, { w: 6, ground: [{ x0: 0, x1: 2, h: 2, block: true }, { x0: 2, x1: 4, h: 1, block: true }, { x0: 4, x1: 6, h: 0, block: true }] });
      }
      if (h + 2 <= MAX_H) {
        add(`up2@${h}`, 1, h, h + 2, { w: 4, ground: [{ x0: 0, x1: 4, h }] });  // a flat run-up so the high jump has room at speed
        add(`stairsUp@${h}`, 2, h, h + 2, { w: 5, ground: [{ x0: 0, x1: 2, h }, { x0: 2, x1: 5, h: h + 1 }] });
      }
      if (h - 1 >= 0) {
        add(`down1@${h}`, 0, h, h - 1, { w: 0 });
        add(`gapDown1@${h}`, 1, h, h - 1, { w: 3 });
      }
      if (h - 2 >= 0) {
        add(`down2@${h}`, 1, h, h - 2, { w: 0 });
        add(`stairsDown@${h}`, 2, h, h - 2, { w: 3, ground: [{ x0: 0, x1: 3, h: h - 1 }] });
      }
    }
    return set;
  }

  const CHUNKS = buildChunkSet();

  // ---- world --------------------------------------------------------------

  function createEmptyWorld() {
    return { solids: [], spikes: [], platforms: [], movers: [], crumbles: [], ceilings: [], guides: [], pads: [], orbs: [], fields: [], walls: [], warps: [], flips: [], blocks: [], boxes: [], bounces: [], pickups: [], gates: [], vanish: [], pops: [], slams: [], flipParity: 0, lastFlipX: -1e9, lastTrapEnd: -1e9, placed: [], endX: 0, exitH: 0, lastName: null, lastDiff: 0, count: 0, rng: null };
  }

  function addSolid(world, x0, x1, top) {
    const prev = world.solids[world.solids.length - 1];
    if (prev && prev.x1 === x0 && prev.top === top) prev.x1 = x1;
    else world.solids.push({ x0, x1, top });
  }

  function addGround(world, x0Tiles, x1Tiles, h) {
    addSolid(world, x0Tiles * TILE, x1Tiles * TILE, FLOOR_Y - h * TILE);
  }

  // where the player should press for a cue, in chunk tiles, at a given speed
  function cueStartTile(cue, speed) { return cue.spike - (speed * CUE_LEAD_S) / TILE; }

  // Gems that trace the flight of each cued press, worked out for the speed the chunk is placed at: the
  // first one sits where to take off, the rest show how the jump flies. Markers only: nothing to collect.
  function cueGems(chunk, off, speed) {
    // a steady chunk is built for one speed, so its path is always drawn for that speed
    const S = chunk.steadyLevel !== null ? levelSpeed(chunk.steadyLevel) : (speed || SPEED_MIN);
    const floorCentre = FLOOR_Y - chunk.entryH * TILE - CUBE / 2;
    const gm = chunk.fields.some(f => f.kind === 'anti') ? FLOAT_GRAVITY : 1;
    const presses = chunk.cue.map(q => {
      if (q.kind === 'jump') return { x: off + q.at * TILE, y: floorCentre, hold: q.hold, ring: false };
      if (q.kind === 'orb') {
        const o = chunk.orbs.reduce((a, b) => (Math.abs(b.x - q.x) < Math.abs(a.x - q.x) ? b : a));
        return { x: off + q.x * TILE, y: FLOOR_Y - o.h * TILE, hold: Infinity, v0: ORB_V, ring: true };
      }
      return { x: off + cueStartTile(q, S) * TILE + CUBE / 2, y: floorCentre, hold: q.hold, ring: false };
    });
    const gems = [];
    presses.forEach((p, i) => {
      const hs = hopHeights(p.hold, 600, gm, p.v0);
      const next = presses[i + 1];
      const dtG = 22 / S;   // a gem about every 22 px of travel, whatever the speed
      for (let t = p.ring ? dtG : 0; t < 4; t += dtG) {
        const k = Math.round(t / SIM_DT) - 1;
        const h = k < 0 ? 0 : hs[Math.min(k, hs.length - 1)];
        const x = p.x + S * t, y = p.y - h;
        if (next && x >= next.x - TILE * 0.6) break;
        if (t > 0.1 && y > floorCentre + 0.5) break;   // landed
        gems.push({ x, y, gem: true });
      }
    });
    // the arc a bounce pad throws the cube along, up to the platform it is meant to reach
    for (const b of chunk.bounces) {
      const x0 = off + b.x * TILE - 9;   // the cube is thrown up as its leading edge reaches the pad
      let vy = -BOUNCE_V, h = 0, t = 0, nextX = 0;
      for (let i = 0; i < 1200; i++) {
        let g = GRAVITY * (vy < 0 ? HOLD_GRAVITY : FALL_GRAVITY);
        vy += g * SIM_DT;
        h -= vy * SIM_DT;
        t += SIM_DT;
        if (vy > 0 && h <= BOUNCE_PLATFORM_H * TILE + 0.5) break;
        if ((S * t) >= nextX) { gems.push({ x: x0 + S * t, y: floorCentre - h, gem: true }); nextX += 22; }
      }
    }
    return gems;
  }

  function placeChunk(world, chunk, speed) {
    const off = world.endX;
    for (const q of chunk.walls) {
      const x0 = off + q.x * TILE, top = FLOOR_Y - (chunk.entryH + q.h) * TILE;
      world.walls.push({ x0, x1: x0 + q.w * TILE, top });
    }
    for (const g of chunk.ground) addSolid(world, off + g.x0 * TILE, off + g.x1 * TILE, FLOOR_Y - g.h * TILE);
    for (const s of chunk.spikes) {
      const x0 = off + s.x * TILE;
      world.spikes.push({ x0, x1: x0 + TILE, base: FLOOR_Y - s.h * TILE, low: !!s.low });
    }
    for (const p of chunk.platforms) {
      const x0 = off + p.x * TILE;
      world.platforms.push({ x0, x1: x0 + p.w * TILE, top: FLOOR_Y - p.h * TILE });
    }
    for (const m of chunk.moving) {
      const x0 = off + m.x * TILE;
      world.movers.push({ id: 'm' + Math.round(x0), x0, x1: x0 + m.w * TILE, base: FLOOR_Y - m.h * TILE, amp: m.amp * TILE, period: chunk.period });
    }
    for (const p of chunk.crumble) {
      const x0 = off + p.x * TILE, top = FLOOR_Y - p.h * TILE;
      world.crumbles.push({ id: 'c' + Math.round(x0) + ':' + Math.round(top), x0, x1: x0 + p.w * TILE, top });
    }
    for (const c of chunk.ceilings) {
      world.ceilings.push({ x0: off + c.x0 * TILE, x1: off + c.x1 * TILE, bottom: FLOOR_Y - (c.h + c.clear) * TILE });
    }
    for (const g of cueGems(chunk, off, speed)) world.guides.push(g);
    for (const p of chunk.pads) world.pads.push({ x0: off + p.x * TILE, x1: off + (p.x + p.w) * TILE, top: FLOOR_Y - p.h * TILE });
    for (const o of chunk.orbs) {
      const x = off + o.x * TILE, y = FLOOR_Y - o.h * TILE;
      world.orbs.push({ id: 'o' + Math.round(x) + ':' + Math.round(y), x, y, r: ORB_R_TILES * TILE });
    }
    for (const f of chunk.fields) world.fields.push({ kind: f.kind, x0: off + f.x0 * TILE, x1: off + f.x1 * TILE });
    for (const q of chunk.vanish) {
      const x0 = off + q.x * TILE;
      world.vanish.push({ x0, x1: x0 + q.w * TILE, top: FLOOR_Y - chunk.entryH * TILE, trigger: x0 - VANISH_TRIGGER_TILES * TILE });
    }
    for (const q of chunk.pops) {
      const x0 = off + q.x * TILE;
      world.pops.push({ x0, x1: x0 + q.w * TILE, base: FLOOR_Y - chunk.entryH * TILE, trigger: x0 - POP_TRIGGER_TILES * TILE });
    }
    for (const q of chunk.slams) {
      const x0 = off + q.x * TILE, x1 = x0 + q.w * TILE, bottom = FLOOR_Y - (chunk.entryH + SLAM_CLEAR) * TILE;
      world.ceilings.push({ x0, x1, bottom });
      world.slams.push({ x0, x1, bottom, trigger: x0 - SLAM_TRIGGER_TILES * TILE });
      // gems run flat along the floor under it: the cue is not to press
      for (let x = x0 + TILE / 2; x < x1; x += 22) world.guides.push({ x, y: FLOOR_Y - chunk.entryH * TILE - CUBE / 2, gem: true });
    }
    for (const q of chunk.bounces) world.bounces.push({ x0: off + q.x * TILE, x1: off + (q.x + q.w) * TILE, top: FLOOR_Y - chunk.entryH * TILE });
    chunk.gates.forEach((q, i) => {
      const gate = { id: 'g' + Math.round(off + q.x * TILE) + ':' + i, x0: off + q.x * TILE, x1: off + (q.x + q.w) * TILE, y: FLOOR_Y - chunk.entryH * TILE, kind: q.kind };
      if (q.kind === 'drop') {
        // trigger: the cube's centre x. hangTop: the top of the block while it hangs. fall: how far it drops to the ground.
        gate.trigger = off + (q.x - q.trigger) * TILE;
        gate.h = q.hgt * TILE;
        gate.hangTop = gate.y - q.hang * TILE - gate.h;
        gate.fall = q.hang * TILE;
      }
      world.gates.push(gate);
    });
    chunk.pickups.forEach((q, i) => world.pickups.push({ id: 'p' + Math.round(off + q.x * TILE) + ':' + i, x: off + q.x * TILE + TILE / 2, y: FLOOR_Y - q.h * TILE, r: PICKUP_R_TILES * TILE }));
    for (const q of chunk.boxes) world.boxes.push({ x0: off + q.x * TILE, x1: off + (q.x + q.w) * TILE, top: FLOOR_Y - q.top * TILE, bottom: FLOOR_Y - q.bottom * TILE });
    for (const b of chunk.blocks) world.blocks.push({ x0: off + b.x0 * TILE, x1: off + b.x1 * TILE, top: FLOOR_Y - b.h * TILE, bottom: FLOOR_Y - chunk.baseH * TILE });
    for (const q of chunk.flips) {
      world.flips.push({ x: off + q.x * TILE, y: FLOOR_Y - chunk.entryH * TILE });
      world.lastFlipX = off + q.x * TILE;
    }
    for (const q of chunk.warps) {
      const ax = off + q.a * TILE, bx = off + q.b * TILE;
      world.warps.push({ id: 'w' + Math.round(ax), ax, bx, y: FLOOR_Y - chunk.entryH * TILE });
    }
    if (chunk.trap) world.lastTrapEnd = off + chunk.w * TILE;
    world.placed.push({ chunk, x0: off, x1: off + chunk.w * TILE });
    world.endX = off + chunk.w * TILE;
    world.exitH = chunk.exitH;
    world.lastName = chunk.name;
    world.lastDiff = chunk.diff;
    world.count++;
  }

  // may this chunk be placed at chunkDist? A steady chunk (an orb gap) needs the speed to be exactly its
  // level's speed along its whole length, so it only goes where the level has finished easing in and
  // the next level has not started yet.
  function fitsLevel(c, chunkDist, level, world) {
    if (c.steadyLevel === null) return true;
    if (c.steadyLevel !== level) return false;
    if (world.levelOverride !== undefined) return true;
    if (level > 0 && chunkDist < LEVEL_STARTS_M[level] * METER_PX + LEVEL_EASE_PX) return false;
    return level >= LAST_LEVEL || chunkDist + c.w * TILE <= LEVEL_STARTS_M[level + 1] * METER_PX;
  }

  function tierCap(metres, level) {
    if (metres < PLAIN_START_M) return 0;
    return Math.min(MAX_DIFF, Math.max(1 + Math.floor(metres / TIER_STEP_M), level + 1));
  }

  function pickChunk(world, chunkDist) {
    // practice runs serve a fixed list of chunks, in order, over and over (a showcase loops only its last level)
    if (world.sequence && world.sequence.length) {
      const n = world.sequence.length, i = world.seqIdx++;
      world.seqAt = i < n ? i : world.seqLoopFrom + (i - n) % (n - world.seqLoopFrom);
      return world.sequence[world.seqAt];
    }
    chunkDist = Math.max(0, chunkDist);
    const forced = world.levelOverride !== undefined;
    const m = (forced ? 1e9 : chunkDist) / METER_PX;
    const level = forced ? world.levelOverride : levelAt(chunkDist);
    const cap = tierCap(m, level);
    let pool = CHUNKS.filter(c => c.entryH === world.exitH && c.diff <= cap && c.name !== world.lastName &&
      c.minLevel <= level && fitsLevel(c, chunkDist, level, world) &&
      (c.flips.length === 0 || world.endX - world.lastFlipX >= FLIP_MIN_GAP_TILES * TILE) &&
      (!c.trap || world.endX - world.lastTrapEnd >= TRAP_MIN_GAP_TILES * TILE));
    if (world.exclude) pool = pool.filter(c => !world.exclude(c));
    if (world.lastDiff >= 3 && level < 2) {
      const easy = pool.filter(c => c.diff <= 1);
      if (easy.length) pool = easy;
    }
    const heat = heatAt(level);
    const weights = pool.map(c => {
      let w = 1 + c.diff * heat;
      if (c.name.startsWith('flat')) w *= 0.4;
      if (c.boost) w *= 2;
      if (world.exitH >= 2 && c.exitH < world.exitH) w *= 2;
      return w;
    });
    let r = world.rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // `exclude` is for tests: a predicate for chunks that must not be placed, applied from the first chunk on
  // `levelOverride` (tests) forces the level the pieces are chosen for from the very first piece
  // `stages` (showcase only) gives each sequence entry its level and where the sequence loops back to
  function createWorld(seed, sequence, exclude, levelOverride, stages) {
    const world = createEmptyWorld();
    if (levelOverride !== undefined) world.levelOverride = levelOverride;
    world.rng = mulberry32(seed);
    world.sequence = sequence || null;
    world.exclude = exclude || null;
    world.seqIdx = 0;
    world.seqLoopFrom = stages ? stages.loopFrom : 0;
    world.seqLevels = stages ? stages.levels : null;
    world.levelMarks = stages ? [] : null;
    addGround(world, -400, 14, 0);
    world.endX = 14 * TILE;
    extendWorld(world, TILE * 2, 0);
    return world;
  }

  function extendWorld(world, x, distPx) {
    while (world.endX < x + LOOKAHEAD_PX) {
      const chunkDist = distPx + (world.endX - x);
      const chunk = pickChunk(world, chunkDist);
      let speed = speedAt(chunkDist);
      if (world.seqLevels) {
        // a showcase steps its level where a piece of a new level starts, whatever the distance
        const lv = world.seqLevels[world.seqAt], marks = world.levelMarks;
        if (!marks.length || marks[marks.length - 1].level !== lv) marks.push({ x: world.endX, level: lv });
        speed = levelSpeed(lv);
      }
      placeChunk(world, chunk, speed);
    }
  }

  function pruneWorld(world, behindX) {
    if (world.solids.length < 120) return;
    world.solids = world.solids.filter(s => s.x1 > behindX);
    world.spikes = world.spikes.filter(s => s.x1 > behindX);
    world.platforms = world.platforms.filter(p => p.x1 > behindX);
    world.movers = world.movers.filter(m => m.x1 > behindX);
    world.crumbles = world.crumbles.filter(p => p.x1 > behindX);
    world.ceilings = world.ceilings.filter(c => c.x1 > behindX);
    world.pads = world.pads.filter(p => p.x1 > behindX);
    world.orbs = world.orbs.filter(o => o.x > behindX);
    world.placed = world.placed.filter(p => p.x1 > behindX);
    world.fields = world.fields.filter(f => f.x1 > behindX);
    world.walls = world.walls.filter(q => q.x1 > behindX);
    world.blocks = world.blocks.filter(q => q.x1 > behindX);
    world.boxes = world.boxes.filter(q => q.x1 > behindX);
    world.bounces = world.bounces.filter(q => q.x1 > behindX);
    world.vanish = world.vanish.filter(q => q.x1 > behindX);
    world.pops = world.pops.filter(q => q.x1 > behindX);
    world.slams = world.slams.filter(q => q.x1 > behindX);
    world.pickups = world.pickups.filter(q => q.x > behindX);
    world.gates = world.gates.filter(q => q.x1 > behindX);
    // a portal that has gone by still counts: keep its turn in the parity
    world.flipParity = (world.flipParity + world.flips.filter(q => q.x <= behindX).length) & 1;
    world.flips = world.flips.filter(q => q.x > behindX);
    world.warps = world.warps.filter(q => q.bx > behindX);
    world.guides = world.guides.filter(g => g.x > behindX);
  }

  // is the picture upside down at this x? A pure function of x and the portals passed: restart, pause and
  // slow time cannot put it out of step. Nothing in stepCube reads it.
  function flipAt(world, x) {
    return ((world.flipParity + world.flips.filter(q => q.x <= x).length) & 1) === 1;
  }

  // ---- cube ---------------------------------------------------------------

  function newCube(x, h) {
    return { x, y: FLOOR_Y - (h || 0) * TILE - CUBE, vy: 0, angle: 0, onGround: true, coyote: COYOTE, buffer: 0, t: 0, cr: {}, stand: null, boostX0: null, orbs: {}, warps: {}, bouncing: false, shield: false, inv: 0, picked: {}, broken: {}, dropAt: {} };
  }

  function cloneCube(c) { return Object.assign({}, c, { cr: Object.assign({}, c.cr), orbs: Object.assign({}, c.orbs), warps: Object.assign({}, c.warps), picked: Object.assign({}, c.picked), broken: Object.assign({}, c.broken), dropAt: Object.assign({}, c.dropAt) }); }

  // the top of a drop block at the cube's clock: hanging until the cube has set it off, then falling to the ground
  function dropTop(q, c) {
    const t0 = c.dropAt[q.id];
    if (t0 === undefined) return q.hangTop;
    return q.hangTop + Math.min(q.fall, 0.5 * DROP_G * (c.t - t0) * (c.t - t0));
  }

  // top of a moving platform at time t (screen y, so up is smaller)
  function moverTop(m, t) { return m.base - m.amp * Math.sin((2 * Math.PI * t) / m.period); }
  function crumbleGone(c, id) { const t0 = c.cr[id]; return t0 !== undefined && c.t - t0 >= CRUMBLE_DELAY; }

  // is a cube-sized box at (x, y) free of solid ground, roofs and spikes?
  function boxClear(world, x, y) {
    const x0 = x + CUBE_INSET, x1 = x + CUBE - CUBE_INSET, bottom = y + CUBE;
    for (const s of world.solids) if (x1 > s.x0 && x0 < s.x1 && bottom > s.top + 0.5) return false;
    for (const s of world.walls) if (x1 > s.x0 && x0 < s.x1 && bottom > s.top + 0.5) return false;
    for (const r of world.ceilings) if (x1 > r.x0 && x0 < r.x1 && y + CUBE_INSET < r.bottom) return false;
    for (const b of world.boxes) if (x1 > b.x0 && x0 < b.x1 && bottom > b.top + 0.5 && y + CUBE_INSET < b.bottom) return false;
    for (const s of world.spikes) {
      const cx = (s.x0 + s.x1) / 2, hw = (TILE * SPIKE_HIT_W) / 2, hitH = s.low ? SPIKE_LOW_HIT_H : SPIKE_HIT_H;
      if (x1 > cx - hw && x0 < cx + hw && bottom > s.base - TILE * hitH && y + CUBE_INSET < s.base) return false;
    }
    return true;
  }

  function stepCube(c, world, input, dt, speed) {
    const ev = { jumped: false, landed: false, dead: null };
    const cxPrev = c.x + CUBE / 2;

    // slow time scales everything the cube integrates, including its progress along x
    dt *= timeScale(world, c);
    c.inv = Math.max(0, c.inv - dt);
    const tPrev = c.t;
    c.t += dt;
    const tNow = c.t;

    if (input.pressed) c.buffer = BUFFER;
    c.buffer = Math.max(0, c.buffer - dt);
    if (c.onGround) c.coyote = COYOTE;
    else c.coyote = Math.max(0, c.coyote - dt);

    if (c.buffer > 0 && (c.onGround || c.coyote > 0)) {
      c.vy = -JUMP_V;
      c.onGround = false;
      c.coyote = 0;
      c.buffer = 0;
      c.stand = null;
      ev.jumped = true;
    }

    const prevBottom = c.y + CUBE;
    const prevTop = c.y;
    if (c.bouncing && c.vy >= 0) c.bouncing = false;
    let g = GRAVITY * gravMul(world, c);
    // a bounce rises on the held-jump arc whatever the buttons do
    if (c.vy < 0) g *= (input.held || c.bouncing) ? HOLD_GRAVITY : RELEASE_GRAVITY;
    else g *= FALL_GRAVITY;
    c.vy += g * dt;
    const cxBefore = c.x + CUBE / 2;
    c.x += speed * dt;
    c.y += c.vy * dt;

    // crossing a portal's x with the cube centre sends the cube to its twin, keeping height and speed of fall
    for (const q of world.warps) {
      if (c.warps[q.id] || cxBefore >= q.ax || c.x + CUBE / 2 < q.ax) continue;
      c.warps[q.id] = true;
      c.x += q.bx - q.ax;
      ev.warp = q.id;
      break;
    }

    const wasAir = !c.onGround;

    const x0 = c.x + CUBE_INSET;
    const x1 = c.x + CUBE - CUBE_INSET;

    // riding a moving platform: stay attached to its top
    let carried = false;
    if (c.stand && !wasAir) {
      const m = world.movers.find(q => q.id === c.stand);
      if (m && x1 > m.x0 && x0 < m.x1) {
        c.y = moverTop(m, tNow) - CUBE;
        c.vy = 0;
        carried = true;
      }
    }
    c.onGround = false;
    const bottom = c.y + CUBE;

    let landTop = null;
    let landMover = null;
    let landCrumble = null;
    for (const s of world.solids) {
      if (x1 <= s.x0 || x0 >= s.x1 || bottom <= s.top) continue;
      const depth = bottom - s.top;
      if (prevBottom <= s.top + 0.001 || (depth <= LEDGE_FORGIVE && c.vy >= 0)) {
        if (landTop === null || s.top < landTop) { landTop = s.top; landMover = null; landCrumble = null; }
      }
    }
    for (const p of world.platforms) {
      if (x1 <= p.x0 || x0 >= p.x1 || bottom < p.top || c.vy < 0) continue;
      if (prevBottom <= p.top + 0.001) {
        if (landTop === null || p.top < landTop) { landTop = p.top; landMover = null; landCrumble = null; }
      }
    }
    // floating blocks are landed on from above like a platform, and are solid on every other side
    for (const b of world.boxes) {
      if (x1 <= b.x0 || x0 >= b.x1 || bottom < b.top || c.vy < 0) continue;
      if (prevBottom <= b.top + 0.001) {
        if (landTop === null || b.top < landTop) { landTop = b.top; landMover = null; landCrumble = null; }
      }
    }
    for (const p of world.crumbles) {
      if (x1 <= p.x0 || x0 >= p.x1 || bottom < p.top || c.vy < 0) continue;
      if (crumbleGone(c, p.id)) continue;
      if (prevBottom <= p.top + 0.001) {
        if (landTop === null || p.top < landTop) { landTop = p.top; landMover = null; landCrumble = p.id; }
      }
    }
    for (const m of world.movers) {
      if (x1 <= m.x0 || x0 >= m.x1 || (c.vy < 0 && !carried)) continue;
      const topPrev = moverTop(m, tPrev);
      const topNow = moverTop(m, tNow);
      if (prevBottom <= topPrev + 0.5 && bottom >= topNow - 0.001) {
        if (landTop === null || topNow < landTop) { landTop = topNow; landMover = m.id; landCrumble = null; }
      }
    }
    if (landTop !== null) {
      c.y = landTop - CUBE;
      c.vy = 0;
      c.onGround = true;
      c.stand = landMover;
      if (landCrumble !== null && c.cr[landCrumble] === undefined) { c.cr[landCrumble] = c.t; ev.crumble = true; }
    } else {
      c.stand = null;
    }

    const bottom2 = c.y + CUBE;
    let hazard = null;   // what a shield can absorb; terrain deaths below are set straight on ev.dead
    let hazardGate = null;
    for (const s of world.solids) {
      if (x1 <= s.x0 || x0 >= s.x1) continue;
      if (bottom2 > s.top + 0.5) ev.dead = 'wall';
    }
    for (const s of world.walls) {
      if (x1 > s.x0 && x0 < s.x1 && bottom2 > s.top + 0.5) ev.dead = 'wall';
    }
    for (const s of world.spikes) {
      const cx = (s.x0 + s.x1) / 2;
      const hw = (TILE * SPIKE_HIT_W) / 2;
      const hitH = s.low ? SPIKE_LOW_HIT_H : SPIKE_HIT_H;
      if (x1 > cx - hw && x0 < cx + hw && bottom2 > s.base - TILE * hitH && c.y + CUBE_INSET < s.base) hazard = 'spike';
    }
    for (const r of world.ceilings) {
      if (x1 > r.x0 && x0 < r.x1 && c.y + CUBE_INSET < r.bottom) ev.dead = 'ceiling';
    }
    for (const b of world.boxes) {
      if (x1 > b.x0 && x0 < b.x1 && bottom2 > b.top + 0.5 && c.y + CUBE_INSET < b.bottom) ev.dead = prevTop + CUBE_INSET >= b.bottom ? 'ceiling' : 'wall';   // the move itself put the head into the underside
    }
    if (c.y > FLOOR_Y + VOID_DEPTH) ev.dead = 'void';
    // gates are hazards that never move out of the way: the beam fills the whole height
    for (const q of world.gates) {
      if (q.kind === 'drop' && c.dropAt[q.id] === undefined && c.x + CUBE / 2 >= q.trigger) c.dropAt[q.id] = c.t;
      if (c.broken[q.id] || x1 <= q.x0 || x0 >= q.x1) continue;
      if (q.kind === 'drop') {
        const top = dropTop(q, c);
        if (!(bottom2 > top + 0.5 && c.y + CUBE_INSET < top + q.h)) continue;
      }
      hazard = q.kind; hazardGate = q;
    }
    // a hazard hit: spent shield and a moment of safety, or nothing at all during that moment, or death
    if (hazard && !ev.dead) {
      if (hazardGate) {
        // a gate always takes the shield if there is one, and either way (shield or safe spell) it is gone for this cube
        if (c.shield) { c.shield = false; c.inv = SHIELD_INV_S; ev.shield = true; c.broken[hazardGate.id] = true; }
        else if (c.inv > 0) c.broken[hazardGate.id] = true;
        else ev.dead = hazard;
      } else if (c.inv > 0) { /* safe for now */ } else if (c.shield) { c.shield = false; c.inv = SHIELD_INV_S; ev.shield = true; } else ev.dead = hazard;
    }
    // a pickup is taken by touching it
    if (!ev.dead) {
      const pcx = c.x + CUBE / 2, pcy = c.y + CUBE / 2;
      for (const q of world.pickups) {
        if (c.picked[q.id] || Math.hypot(pcx - q.x, pcy - q.y) > q.r + CUBE / 2) continue;
        c.picked[q.id] = true;
        c.shield = true;
        ev.pickup = q.id;
      }
    }

    // a bounce pad throws the cube up the moment it stands on it (running onto it or landing on it): the press, the
    // buffer and the coyote time are all spent, so nothing the player does adds height
    if (c.onGround && !ev.dead) {
      for (const p of world.bounces) {
        if (x1 > p.x0 && x0 < p.x1 && Math.abs(c.y + CUBE - p.top) < 1) {
          c.vy = -BOUNCE_V;
          c.onGround = false;
          c.coyote = 0;
          c.buffer = 0;
          c.stand = null;
          c.bouncing = true;
          ev.bounce = true;
          break;
        }
      }
    }

    // touching a boost pad on the ground starts a boost; it ends by itself a fixed distance later
    if (c.onGround && !ev.dead && (c.boostX0 === null || c.boostX0 === undefined)) {
      for (const p of world.pads) if (x1 > p.x0 && x0 < p.x1) { c.boostX0 = p.x0; ev.boost = true; break; }
    }
    if (c.boostX0 !== null && c.boostX0 !== undefined && c.x - c.boostX0 >= BOOST_RUN_TILES * TILE) c.boostX0 = null;

    // an orb throws the cube up by itself as the cube centre passes the ring's centre line inside the ring, on the
    // same arc whatever the buttons do: a press waiting in the buffer is spent, so it cannot add a jump on landing
    if (!ev.dead && !ev.warp) {
      const cx = c.x + CUBE / 2, cy = c.y + CUBE / 2;
      for (const o of world.orbs) {
        if (c.orbs[o.id]) continue;
        if (cxBefore < o.x && cx >= o.x && Math.abs(cy - o.y) <= o.r) {
          c.orbs[o.id] = true;
          c.vy = -ORB_V;
          // the ring pulls the cube to its centre, but never into ground, a roof or a spike
          if (boxClear(world, c.x, o.y - CUBE / 2)) c.y = o.y - CUBE / 2;
          c.buffer = 0;
          c.coyote = 0;
          c.onGround = false;
          c.stand = null;
          c.bouncing = true;
          ev.jumped = true;
          ev.orb = o.id;
          break;
        }
      }
    }

    if (!c.onGround) {
      c.angle += SPIN * dt;
    } else {
      const target = Math.ceil(c.angle / (Math.PI / 2) - 1e-3) * (Math.PI / 2);
      c.angle += (target - c.angle) * Math.min(1, dt * 30);
      if (Math.abs(target - c.angle) < 0.001) c.angle = target;
    }

    if (c.onGround && wasAir) ev.landed = true;
    // a rage-bait trap goes off as the cube's centre crosses its trigger; reported for sound, nothing else reads it
    const cx = c.x + CUBE / 2;
    const crossed = q => cxPrev < q.trigger && cx >= q.trigger;
    if (world.vanish.some(crossed) || world.pops.some(crossed) || world.slams.some(crossed) || world.gates.some(q => q.kind === 'drop' && crossed(q))) ev.trap = true;
    return ev;
  }

  // ---- saved record -------------------------------------------------------

  const SAVE_KEY = 'tumble.save';
  const SAVE_VERSION = 2;

  // Cube levels come from the lifetime distance (every counted run added up). Each one unlocks colours and wearables
  // for good; wearing them is optional. The core square and the aura come with their level and are not worn.
  const CUBE_LEVELS = [
    { name: 'Rookie', at: 0, colors: ['magenta'], wear: [] },
    { name: 'Roller', at: 250, colors: ['cyan', 'solar'], wear: ['shades'] },
    { name: 'Tumbler', at: 1000, colors: ['toxic', 'ember'], wear: ['antenna', 'headphones'] },
    { name: 'Acrobat', at: 3000, colors: ['ghost'], wear: ['cap'] },
    { name: 'Legend', at: 7500, colors: ['gold', 'prism'], wear: ['crown'] },
  ];
  // each wearable sits in one slot, and a slot holds one thing: one hat, shades, headphones
  const WEAR_SLOTS = { shades: 'face', antenna: 'head', cap: 'head', crown: 'head', headphones: 'ears' };
  const DEFAULT_LOOK = { color: 'magenta', head: null, face: null, ears: null };

  // the cube level (1 to 5) for a lifetime distance in metres
  function cubeLevelFor(total) {
    const t = Number.isFinite(total) ? total : 0;
    let lv = 1;
    CUBE_LEVELS.forEach((q, i) => { if (t >= q.at) lv = i + 1; });
    return lv;
  }
  // everything unlocked at a cube level
  function unlockedAt(level) {
    const colors = [], wear = [];
    CUBE_LEVELS.slice(0, Math.max(1, level)).forEach(q => { colors.push(...q.colors); wear.push(...q.wear); });
    return { colors, wear };
  }
  // a look with anything unknown, locked or in the wrong slot put back to the default
  function sanitizeLook(look, level) {
    const u = unlockedAt(level), out = Object.assign({}, DEFAULT_LOOK);
    if (!look || typeof look !== 'object') return out;
    if (u.colors.includes(look.color)) out.color = look.color;
    for (const slot of ['head', 'face', 'ears']) {
      const w = look[slot];
      if (typeof w === 'string' && WEAR_SLOTS[w] === slot && u.wear.includes(w)) out[slot] = w;
    }
    return out;
  }

  // Keeps the best distance, the lifetime distance and the chosen look. Reads and writes never throw: if storage is
  // missing, blocked or full, everything lives in memory for the rest of the session. A version 1 record (best only)
  // is read as a version 2 one whose lifetime distance starts at that best.
  function createStore(getStorage) {
    const cnt = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
    let mem = { best: 0, total: 0, look: null };

    function readSaved() {
      const none = { best: 0, total: 0, look: null };
      try {
        const ls = getStorage();
        if (!ls) return none;
        const raw = ls.getItem(SAVE_KEY);
        if (raw === null || raw === undefined) return none;
        const rec = JSON.parse(raw);
        if (!rec || typeof rec !== 'object') return none;
        const best = cnt(rec.best);
        if (best === null) return none;
        if (rec.v === 1) return { best, total: best, look: null };
        if (rec.v !== SAVE_VERSION) return none;
        const total = cnt(rec.total);
        return { best, total: Math.max(best, total === null ? best : total), look: rec.look && typeof rec.look === 'object' ? rec.look : null };
      } catch (e) {
        return none;
      }
    }

    function write() {
      try {
        const ls = getStorage();
        if (ls) ls.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, best: mem.best, total: mem.total, look: mem.look }));
      } catch (e) { /* memory copy still holds it */ }
    }

    // another tab may have saved more since: never let a number go down
    function sync() {
      const saved = readSaved();
      mem.best = Math.max(mem.best, saved.best);
      mem.total = Math.max(mem.total, saved.total);
      if (!mem.look && saved.look) mem.look = saved.look;
    }

    mem = readSaved();

    return {
      getBest() { sync(); return mem.best; },
      getTotal() { sync(); return mem.total; },
      getLevel() { sync(); return cubeLevelFor(mem.total); },
      // the saved look, cleaned for the current cube level
      getLook() { sync(); return sanitizeLook(mem.look, cubeLevelFor(mem.total)); },
      setLook(look) {
        sync();
        mem.look = sanitizeLook(look, cubeLevelFor(mem.total));
        write();
        return mem.look;
      },
      // a finished run: adds its distance to the lifetime total and keeps the best
      recordRun(meters) {
        const m = Number.isFinite(meters) ? Math.max(0, Math.floor(meters)) : 0;
        sync();
        const levelBefore = cubeLevelFor(mem.total);
        const isNewBest = m > mem.best;
        if (isNewBest) mem.best = m;
        mem.total += m;
        if (m > 0) write();
        const level = cubeLevelFor(mem.total);
        return { best: mem.best, isNewBest, total: mem.total, level, levelUp: level > levelBefore };
      },
    };
  }

  // ---- game ---------------------------------------------------------------

  function newGame(seed, running, best, sequence, startLevel) {
    const world = createWorld(seed, sequence);
    const cube = newCube(TILE * 2, 0);
    const lv = Math.max(0, Math.min(LAST_LEVEL, startLevel || 0));
    const g = {
      state: running ? 'running' : 'ready',
      seed, world, cube,
      startX: cube.x,
      deadT: 0,
      deadReason: null,
      bestAtStart: Math.max(0, Math.floor(best || 0)),
      bestPassed: false,
      level: 0,
    };
    // practice only: begin well inside level lv, at that level's steady speed
    if (lv > 0) { g.startX = cube.x - (LEVEL_STARTS_M[lv] * METER_PX + LEVEL_EASE_PX + TILE); g.level = lv; }
    return g;
  }

  // where the previous best ended, so the page can mark it on the track
  function bestMarkerX(g) {
    return g.bestAtStart > 0 ? g.startX + g.bestAtStart * METER_PX : null;
  }

  function gameSpeed(g) { return g.world.levelMarks ? showcaseSpeedAt(g.world, g.cube.x) : speedAt(distancePx(g)); }
  function gameLevel(g) { return g.world.levelMarks ? showcaseAt(g.world, g.cube.x).level : levelAt(distancePx(g)); }

  // Showcase runs: one mechanic, each level's form in turn (from level 0's speed up to level 6's), each piece
  // after a flat runway that holds the level-up ease. The last level repeats. Never two of a piece in a row, as
  // in a normal run.
  const SHOWCASE_REPEATS = 2;
  const SHOWCASES = {
    spikes: k => [['spike1@0'], ['spike2@0'], ['spike3@0'], ['spikeGap@0'], ['gapSpike@0'], ['hops@0'], ['spikeRun@0']][k],
    platforms: k => [k < 2 ? 'crumbleBridge@0' : k < 4 ? 'moveStone@0' : 'crumbleRun@0'],
    tunnel: k => [k < 3 ? 'tunnel1@0' : 'tunnel2@0'],
    boost: () => ['boostRun@0'],
    orbGap: k => [`orbGap${k}@0`],
    slow: k => [k < 3 ? 'slowRun@0' : 'slowSpikes@0'],
    float: k => [k < 2 ? 'floatRun@0' : `floatGap${k}@0`],
    warp: k => [k < 2 ? 'warpWall@0' : k < 4 ? 'warpSpike@0' : 'warpGap@0'],
    flip: () => ['flipPad@0'],
    blocks: k => [['blockHop@0'], ['blockTower@0'], ['floatBlock@0'], ['blockSpike@0'], ['blockBridge@0'], ['blockStairsUp@0', 'blockStairsDown@3'], ['blockStairsUp@0', 'blockStairsDown@3']][k],
    bounce: () => ['bounceUp@0'],
    shield: k => [k < 3 ? 'shieldLaser@0' : 'shieldDrop@0'],
    vanish: k => [`vanish${k}@0`],
    popSpikes: k => [`popSpikes${k}@0`],
    slam: k => [k < 3 ? 'slamRoof@0' : 'slamLong@0'],
  };

  // the chunk list and per-entry levels for a showcase, or null for an unknown name
  function showcaseSequence(name) {
    const make = Object.prototype.hasOwnProperty.call(SHOWCASES, name) ? SHOWCASES[name] : null;
    if (!make) return null;
    const sequence = [], levels = [];
    let loopFrom = 0;
    for (let k = 0; k <= LAST_LEVEL; k++) {
      if (k === LAST_LEVEL) loopFrom = sequence.length;
      for (let r = 0; r < SHOWCASE_REPEATS; r++) {
        for (const n of ['flat@0', ...make(k)]) {
          const c = CHUNKS.find(q => q.name === n);
          if (!c) throw new Error('showcase ' + name + ': no chunk ' + n);
          sequence.push(c); levels.push(k);
        }
      }
    }
    return { sequence, levels, loopFrom };
  }

  function newShowcase(seed, name, running, best) {
    const sc = showcaseSequence(name);
    if (!sc) return null;
    const g = newGame(seed, running, best, null, 0);
    g.world = createWorld(seed, sc.sequence, null, undefined, sc);
    g.showcase = name;
    return g;
  }

  // practice runs begin at the level an orb gap was built for, so its speed is the one it is sized for
  function practiceStart(chunks) {
    const c = chunks.find(q => q.steadyLevel !== null && q.steadyLevel !== undefined);
    return c ? c.steadyLevel : 0;
  }

  function distancePx(g) { return g.cube.x - g.startX; }
  function meters(g) { return Math.max(0, Math.floor(distancePx(g) / METER_PX)); }
  function zoneAt(distPx) { return Math.floor(distPx / METER_PX / ZONE_M); }
  function canRestart(g) { return g.state === 'dead' && g.deadT >= RESTART_LOCK; }

  function stepGame(g, input, dt) {
    const events = [];
    const flipBefore = flipAt(g.world, g.cube.x + CUBE / 2);
    if (g.state === 'ready') {
      if (!input.pressed) return events;
      g.state = 'running';
      events.push('start');
    }
    if (g.state === 'running') {
      const dist = distancePx(g);
      const ev = stepCube(g.cube, g.world, input, dt, gameSpeed(g) * boostMul(g.cube));
      extendWorld(g.world, g.cube.x, dist);
      pruneWorld(g.world, g.cube.x - TILE * 20);
      if (ev.jumped) events.push('jump');
      if (ev.landed) events.push('land');
      if (ev.orb) events.push('orb');
      if (ev.warp) events.push('warp');
      if (ev.bounce) events.push('bounce');
      if (ev.shield) events.push('shield');
      if (ev.pickup) events.push('pickup');
      if (ev.boost) events.push('boost');
      if (ev.crumble) events.push('crumble');
      if (ev.trap) events.push('trap');
      if (flipAt(g.world, g.cube.x + CUBE / 2) !== flipBefore) events.push('flip');
      const lvl = gameLevel(g);
      if (lvl > g.level) {
        g.level = lvl;
        events.push('level');
      }
      if (g.bestAtStart > 0 && !g.bestPassed && meters(g) > g.bestAtStart) {
        g.bestPassed = true;
        events.push('best');
      }
      if (ev.dead) {
        g.state = 'dead';
        g.deadT = 0;
        g.deadReason = ev.dead;
        events.push('die');
      }
    } else if (g.state === 'dead') {
      g.deadT += dt;
    }
    return events;
  }

  const api = {
    CUBE_LEVELS, WEAR_SLOTS, DEFAULT_LOOK, cubeLevelFor, unlockedAt, sanitizeLook,
    CUBE, TILE, FLOOR_Y, METER_PX, GRAVITY, JUMP_V, HOLD_GRAVITY, RELEASE_GRAVITY, FALL_GRAVITY,
    COYOTE, BUFFER, SPIN, SPEED_MIN, SPEED_MAX, LEVEL_STARTS_M, LAST_LEVEL, LEVEL_EASE_PX, CUBE_INSET, LEDGE_FORGIVE,
    SHIELD_INV_S, PICKUP_R_TILES, GATE_PICKUP_DIST_TILES, GATE_PICKUP_H, DROP_PICKUP_DIST_TILES, DROP_TRIGGER_TILES, DROP_HANG_TILES, DROP_W_TILES, DROP_H_TILES, DROP_G, dropTop, VANISH_TRIGGER_TILES, VANISH_LEAD, VANISH_HOLD, VANISH_EXIT, POP_TRIGGER_TILES, POP_LEAD, POP_HOLD, POP_EXIT, POP_SPIKES, SLAM_TRIGGER_TILES, SLAM_LEAD, SLAM_CLEAR, SLAM_EXIT, BOUNCE_V, BOUNCE_PEAK, BOUNCE_APEX_MUL, BOUNCE_PLATFORM_H, WARP_WALL_H, FLIP_MIN_GAP_TILES, TRAP_MIN_GAP_TILES, flipAt, pruneWorld, SPIKE_HIT_W, SPIKE_HIT_H, PLATFORM_THICK, RESTART_LOCK, PAD, MAX_H, ZONE_M,
    JUMP_PEAK, AIR_TIME_FULL, MAX_STEP_TILES, MAX_GAP_TILES, FAIRNESS, MAX_HAZARDS_PER_JUMP, JUMP_RANGE_MAX_TILES, CHUNKS,
    speedAt, levelAt, levelSpeed, heatAt, gameSpeed, gameLevel, showcaseSpeedAt, SHOWCASES, SHOWCASE_REPEATS, showcaseSequence, newShowcase, mulberry32, makeChunk, cloneCube, moverTop, crumbleGone, moverSampleStep, moverSpeed, createEmptyWorld, addSolid, addGround, placeChunk,
    createWorld, extendWorld, newCube, stepCube, newGame, stepGame, distancePx, meters,
    zoneAt, canRestart, createStore, bestMarkerX, SAVE_KEY, SAVE_VERSION,
    VIEW_H, MIN_VIEW_W, CUBE_SCREEN_X, CUE_WARN_S, CUE_WARN_AT_MAX_S, VIEW_AHEAD_PX,
    SLOW_SCALE, FLOAT_GRAVITY, FIELD_RAMP_TILES, FLOAT_RANGE_MUL, floatAirTime, fieldWeight, timeScale, gravMul,
    tierCap, TIER_STEP_M, PLAIN_START_M, cueGems, cueStartTile, CUE_LEAD_S, practiceStart, boxClear, boostMul, hopHeights, hopCrossing, BOOST_MUL, BOOST_RUN_TILES, BOOST_RAMP_TILES, BOOST_CAP, ORB_R_TILES, ORB_HOLD, ORB_RING_H, ORB_LEAD, ORB_V, ORB_APEX_TILES, SIM_DT, CRUMBLE_DELAY, CRUMBLE_SHAKE, CRUMBLE_MAX_TILES, MOVER_PHASES, MOVER_SAMPLE_MAX_TILES, MOVER_MAX_SPEED,
    MIN_TUNNEL_CLEAR, TUNNEL_CLEAR, SPIKE_LOW_HIT_H,
  };

  root.TumbleLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
