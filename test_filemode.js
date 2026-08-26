/* test_filemode.js — regression: full boot + race with NO fetch global
 * (simulates file:// double-click). Verifies embedded car models load,
 * all cars satisfy the wheel contract, and an imported-car race runs
 * 20+ seconds without a loop exception.                                */
"use strict";
const fs = require("fs");
const vm = require("vm");

const elements = {}, winListeners = {};
let tnow = 1000;

function makeCtx2d(el) {
  return new Proxy({}, {
    get(t, k) {
      if (k === "canvas") return el;
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient")
        return () => ({ addColorStop() {} });
      return typeof k === "string" ? () => {} : undefined;
    },
    set() { return true; },
  });
}
function makeElement(id) {
  const el = {
    id, style: {}, dataset: {}, textContent: "", innerHTML: "",
    width: 190, height: 190, clientWidth: 150,
    classList: {
      _s: new Set(),
      add(c) { el.classList._s.add(c); },
      remove(c) { el.classList._s.delete(c); },
      toggle(c, f) { if (f === undefined) {} else if (f) el.classList._s.add(c); else el.classList._s.delete(c); },
      contains(c) { return el.classList._s.has(c); },
    },
    getContext() { return makeCtx2d(el); },
    _ev: {},
    addEventListener(t, f) { (el._ev[t] = el._ev[t] || []).push(f); },
    _fire(t, ev) { (el._ev[t] || []).forEach(f => f(ev)); },
    appendChild() {},
  };
  return el;
}
global.document = {
  getElementById(id) { if (!elements[id]) elements[id] = makeElement(id); return elements[id]; },
  createElement() { return makeElement("dyn"); },
  addEventListener() {},
  dispatchEvent() {},                       // minimal envs may lack real events
};
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
global.screen = { orientation: { angle: 90 } };
global.window = {
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
};
global.performance = { now: () => tnow };
let rafQueue = [];
global.requestAnimationFrame = cb => { rafQueue.push(cb); return rafQueue.length; };
// NOTE: deliberately NO global.fetch — this is the file:// simulation
global.THREE = require("./vendor/three.min.js");
global.THREE.WebGLRenderer = class {
  constructor() { this.shadowMap = {}; this.domElement = makeElement("gl"); this.toneMappingExposure = 1; }
  setPixelRatio() {} setSize() {} render() {}
};

for (const f of ["js/textures.js", "js/gltf.js", "js/car_models_data.js",
                 "js/physics.js", "js/track.js", "js/audio.js",
                 "js/ai.js", "js/effects.js", "js/game.js", "js/main.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

(async () => {
  (winListeners["DOMContentLoaded"] || []).forEach(f => f());
  await window.__preloadCarModels();

  const states = Object.entries(window.__CAR_MODEL_CACHE__);
  for (const [k, v] of states) {
    console.log("model", k, "->", v.ready ? "ready" : v.failed ? "fallback" : "?");
    if (!v.ready && !v.failed) throw new Error(k + ": neither ready nor failed");
  }

  // every spec builds and satisfies the wheel contract
  for (const key of Object.keys(CAR_SPECS)) {
    const m = buildCarMesh(CAR_SPECS[key]);
    const w = m.userData.wheels;
    // every car must expose the full 4-hub contract (imports get
    // invisible filler hubs when their wheels are baked into the body)
    const ok = w.length === 4 && w.every(g => g.children[0] && g.children[1]);
    if (!ok) throw new Error(key + ": wheel contract violated");
  }
  console.log("all", Object.keys(CAR_SPECS).length, "cars build ✓");

  // player takes an IMPORTED car; AI pool covers the rest
  game.selectedCar = "lambo";
  game.startRace();
  let simT = 0;
  const pump = n => {
    for (let i = 0; i < n; i++) {
      tnow += 16.67; simT += 16.67;
      const q = rafQueue; rafQueue = [];
      for (const cb of q) cb(simT);
      if (!rafQueue.length) game._loop(simT);
    }
  };
  pump(600);                                   // ~10 s
  if (!game.player) throw new Error("player missing after countdown");
  const kinds = [...new Set(game.racers
    .filter(r => !r.isPlayer)
    .map(r => r.mesh.userData.spec.design))];
  console.log("raced 10 s | AI designs:", kinds.join(", ") || "(none)");

  // brake-light path over every racer (guards the tailMat deref)
  game.racers.forEach(r => { r.car._brakeLight = true; });
  try { pump(60); } catch (e) { throw new Error("loop threw during braking: " + e.message); }
  game.racers.forEach(r => { r.car._brakeLight = false; });
  pump(540);                                   // ~9 more seconds

  if (!Number.isFinite(game.player.car.x)) throw new Error("player position NaN");
  console.log("20 s total, loop alive, position finite ✓");
  console.log("\nFILE-MODE RACE REGRESSION PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
