/* Headless DOM/WebGL-stub test: boots the full Game and pumps frames.
 * Catches element-ID typos, HUD logic errors, state-machine bugs.   */
"use strict";
const fs = require("fs");
const vm = require("vm");

/* ---------- minimal DOM stub ---------- */
const elements = {};
function makeCtx2d() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient" ||
          k === "createConicGradient")
        return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 0 });
      if (k === "getImageData") return () => ({ data: [] });
      return typeof k === "string" ? () => {} : undefined;
    },
    set() { return true; },
  });
}
function makeElement(id) {
  const el = {
    id,
    style: {},
    dataset: {},
    textContent: "",
    innerHTML: "",
    width: 300, height: 300,
    offsetWidth: 300,
    children: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    getContext() { return makeCtx2d(); },
  };
  return el;
}
global.document = {
  getElementById(id) {
    if (!elements[id]) elements[id] = makeElement(id);
    return elements[id];
  },
  createElement(tag) { return makeElement("dyn-" + tag + "-" + Math.random()); },
  addEventListener() {},
};
global.window = {
  addEventListener() {},
  innerWidth: 1280, innerHeight: 800,
  devicePixelRatio: 1,
  AudioContext: undefined, // audio disabled gracefully
};
global.performance = { now: () => Date.now() };
let rafQueue = [];
global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };

/* ---------- THREE + WebGLRenderer stub ---------- */
global.THREE = require("./vendor/three.min.js");
global.THREE.WebGLRenderer = class {
  constructor() { this.shadowMap = {}; this.domElement = makeElement("glcanvas"); }
  setPixelRatio() {} setSize() {} render() {}
};

/* ---------- load game scripts ---------- */
for (const f of ["js/textures.js", "js/physics.js", "js/track.js", "js/audio.js", "js/ai.js", "js/effects.js", "js/game.js", "js/main.js"]) {
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
}

/* ---------- boot ---------- */
const game = new Game();
game.init(makeElement("game-canvas"));
console.log("Game booted, state =", game.state, "(MENU=0)");

game.startRace();
console.log("Race started: state =", game.state, "(COUNTDOWN=1), racers =", game.racers.length);
if (game.racers.length !== 6) throw new Error("FAIL: expected 6 racers");
if (!game.player) throw new Error("FAIL: no player");

/* ---------- pump frames through countdown ---------- */
let simClock = 0;
function pump(frames, dtMs = 16.67) {
  for (let i = 0; i < frames; i++) {
    simClock += dtMs;
    const q = rafQueue; rafQueue = [];
    for (const cb of q) cb(simClock);
    // fallback: call _loop directly if raf didn't chain
    if (rafQueue.length === 0) game._loop(simClock);
  }
}
pump(300); // ~5s → countdown ends
console.log("After countdown: state =", game.state, "(RACING=2)");
if (game.state !== 2) throw new Error("FAIL: countdown did not transition to RACING");

/* ---------- drive with throttle for 10 simulated seconds ---------- */
game.keys["KeyW"] = true;
const startX = game.player.car.x, startZ = game.player.car.z;
pump(600);
const moved = Math.hypot(game.player.car.x - startX, game.player.car.z - startZ);
console.log("After 10s driving: speed =", game.player.car.speedKmh.toFixed(1), "km/h, moved =", moved.toFixed(1), "m");
if (moved < 20) throw new Error("FAIL: player car did not move");
if (!isFinite(game.player.car.x)) throw new Error("FAIL: NaN position");

/* ---------- HUD element sanity ---------- */
const speedTxt = elements["speed-value"].textContent;
const posTxt = elements["pos-current"].textContent;
const lapTxt = elements["lap-current"].textContent;
console.log("HUD: speed =", speedTxt, "pos =", posTxt, "lap =", lapTxt);
if (!/^\d+$/.test(speedTxt)) throw new Error("FAIL: speed HUD not numeric");
if (!/^\d$/.test(posTxt)) throw new Error("FAIL: position HUD invalid");

/* ---------- handbrake drift ---------- */
game.keys["Space"] = true;
pump(120);
console.log("Drift check: driftAmount =", game.player.car.driftAmount.toFixed(2));
game.keys["Space"] = false;

/* ---------- pause / resume ---------- */
game.pause();
if (game.state !== 3) throw new Error("FAIL: pause");
game.resume();
if (game.state !== 2) throw new Error("FAIL: resume");
console.log("Pause/resume OK");

/* ---------- barrier collision: teleport player outside ---------- */
const s = game.track.samples[200];
game.player.car.x = s.pos.x + s.nx * 40;
game.player.car.z = s.pos.z + s.nz * 40;
game.player.car.vx = 20;
pump(30);
const lat = game.track.lateralOffset(game.player.car.x, game.player.car.z, game.track.nearestIndex(game.player.car.x, game.player.car.z));
console.log("Barrier: lat after correction =", lat.toFixed(2), "(limit ~", (game.track.barrierDist - 0.9).toFixed(1) + ")");
if (Math.abs(lat) > game.track.barrierDist) throw new Error("FAIL: car escaped barriers");

/* ---------- force race finish ---------- */
game.player.distSamples = game.track.samples.length * 3 - 5;
pump(60);
// cross the line
game.player.distSamples += 10;
game._updateLapProgress(game.player);
console.log("Finish: state =", game.state, "(FINISHED=4)");
if (game.state !== 4) throw new Error("FAIL: finish not detected");
pump(180); // wait for results screen delay
const resultsVisible = !elements["menu-results"].classList.contains("hidden");
console.log("Results screen visible =", resultsVisible, "title =", elements["results-title"].textContent);
if (!resultsVisible) throw new Error("FAIL: results not shown");

/* ---------- restart & quit ---------- */
game.restart();
if (game.state !== 1) throw new Error("FAIL: restart");
pump(10);
game.toMenu();
if (game.state !== 0) throw new Error("FAIL: toMenu");
console.log("Restart/quit OK");

console.log("\nFULL GAME LOGIC TEST PASSED");
