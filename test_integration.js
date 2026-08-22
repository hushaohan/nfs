/* Headless integration test: track + AI lap completion */
"use strict";
const fs = require("fs");
const vm = require("vm");

global.THREE = require("./vendor/three.min.js");
// stub document/canvas for texture generation
const noopCtx = new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient")
  ? () => ({ addColorStop: () => {} })
  : () => {} });
global.document = { createElement: () => ({ getContext: () => noopCtx, width: 0, height: 0, style: {} }) };

for (const f of ["js/track.js", "js/physics.js", "js/ai.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

const scene = new THREE.Scene();
const track = new Track(scene);
console.log("Track length:", track.length.toFixed(0), "m, samples:", track.samples.length);

const s0 = track.samples[0];
const idx = track.nearestIndex(s0.pos.x, s0.pos.z);
console.log("nearestIndex at start:", idx, "lateral offset:", track.lateralOffset(s0.pos.x, s0.pos.z, idx).toFixed(3));

const out = track.collide(s0.pos.x + s0.nx * 30, s0.pos.z + s0.nz * 30, 0);
console.log("collision test: hit =", out.hit, "corrected lat =", track.lateralOffset(out.x, out.z, out.idx).toFixed(2));
if (!out.hit) throw new Error("FAIL: barrier collision not detected");

// AI full-lap test
const car = new CarPhysics(CAR_SPECS.falcon);
const p = track.pointAt(0.999, 0);
car.reset(p.x, p.z, Math.atan2(p.tan.z, p.tan.x));
const ai = new AIDriver(track, car, 0.8, 0);
const cars = [car];
const dt = 1 / 60;
let maxSpeed = 0, minSpeed = Infinity;
let prevIdx = ai.hintIdx, progress = 0, laps = 0;
const N = track.samples.length;
for (let t = 0; t < 240; t += dt) {
  const input = ai.drive(dt, cars, true);
  car.step(dt, input);
  const res = track.collide(car.x, car.z, ai.hintIdx);
  car.x = res.x; car.z = res.z;
  ai.hintIdx = res.idx;
  maxSpeed = Math.max(maxSpeed, car.speedKmh);
  minSpeed = Math.min(minSpeed, car.speedKmh);
  const idx2 = track.nearestIndex(car.x, car.z, prevIdx);
  let d = idx2 - prevIdx;
  if (d > N / 2) d -= N; if (d < -N / 2) d += N;
  prevIdx = idx2; progress += d;
  if (progress >= N) { laps++; progress -= N; console.log("  lap", laps, "at t =", t.toFixed(1) + "s"); if (laps >= 2) break; }
  if (!isFinite(car.x)) throw new Error("FAIL: NaN");
}
console.log("AI: laps =", laps, "max speed =", maxSpeed.toFixed(0), "km/h, min =", minSpeed.toFixed(0), "km/h");
if (laps < 2) throw new Error("FAIL: AI could not complete 2 laps in 240s");
console.log("\nTRACK + AI INTEGRATION PASSED");
