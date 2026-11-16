// npm run test:chains   (all 7 level speeds and the in-between points; takes several minutes)
// npm run test:chains -- 6        (just level 6)
// CLOSURE_Q=8 for finer positions. Exit code 1 if any speed has a dead sequence.
'use strict';
const L = require('../../src/logic.js');
const S = require('../support.js');
const { closure, EXCLUDED, included } = require('./closure.js');

const args = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
const speeds = [];
for (let k = 0; k <= L.LAST_LEVEL; k++) {
  if (!args.length || args.includes(k)) speeds.push({ label: `level ${k}`, speed: L.levelSpeed(k) });
  if (!args.length && k > 0) {
    // halfway through the ease from the previous level, where speed is between two steady speeds
    const e = 0.5 * 0.5 * (3 - 2 * 0.5);
    speeds.push({ label: `between ${k - 1} and ${k}`, speed: L.levelSpeed(k - 1) + (L.levelSpeed(k) - L.levelSpeed(k - 1)) * e });
  }
}

// moving platforms appear in a witness as moveStone#phase@h; the planner check uses the plain chunk (its clock starts at 0)
const g = n => L.CHUNKS.find(c => c.name === n.replace(/#\d+/, ''));
let failed = 0;
const t0 = Date.now();
console.log(`chain closure: ${L.CHUNKS.filter(included).length} of ${L.CHUNKS.length} chunks, positions at 1/${process.env.CLOSURE_Q || 4} step`);
for (const { label, speed } of speeds) {
  const r = closure(speed);
  const status = r.startOk ? 'SAFE' : 'DEAD';
  console.log(`${label.padEnd(20)} ${String(Math.round(speed)).padStart(4)} px/s  ${status}  ${r.vectors} vectors, ${(r.totalMs / 1000).toFixed(0)} s`);
  if (!r.startOk) {
    failed++;
    const seen = new Set();
    for (const w of r.witnesses) {
      const key = w.join(' > ');
      if (seen.has(key)) continue;
      seen.add(key);
      const cs = w.map(g);
      const world = S.buildWorld(cs);
      const p = S.plan(L.newCube(2 * L.TILE, cs[0].entryH), world, speed, world.endX - 8 * L.TILE, new Map());
      console.log(`    ${key}   planner: ${p ? 'a plan exists (the closure is stricter)' : 'no plan (confirmed dead end)'}`);
    }
  }
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('\nCovered: all chunks. Cue chunks (tunnels, orb gaps, float gaps) are checked on their cue play only; moving platforms');
console.log('as 16 worst-case phases; boost runs as separate states for having touched the pad or not; steady chunks only at');
console.log('their own level speed. NOT covered: level boundaries inside a chunk, speeds other than the 13 sampled, a player who');
console.log('sees only one or two chunks ahead, phases between the 16 buckets.');
process.exit(failed ? 1 : 0);
