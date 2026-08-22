/* =====================================================================
 * ai.js — AI opponents
 *   • Follow the track centerline with a per-driver lateral offset
 *   • Look-ahead steering (pure pursuit)
 *   • Brake before corners based on curvature ahead
 *   • Simple avoidance of cars ahead
 * ===================================================================== */
"use strict";

const AI_NAMES = ["RAVEN", "BLAZE", "KOBRA", "GHOST", "TITAN", "NOVA", "ONYX"];
const AI_COLORS = [0x9b59ff, 0x2ecc71, 0xff7f27, 0xf1c40f, 0x3498db, 0xe84393, 0x1abc9c];

class AIDriver {
  constructor(track, physics, skill, index) {
    this.track = track;
    this.car = physics;
    this.skill = skill;               // 0..1
    this.index = index;
    this.lateralWish = (Math.random() * 2 - 1) * (track.halfW * 0.45);
    this.hintIdx = 0;
    this.stuckTimer = 0;
    this.recoverTimer = 0;
    this.throttleNoise = Math.random() * 10;
  }

  /* sample curvature ahead to decide target speed */
  _curvatureAhead(distMeters) {
    const N = this.track.samples.length;
    const perSample = this.track.length / N;
    const steps = Math.max(2, Math.floor(distMeters / perSample / 6));
    let maxCurv = 0;
    for (let k = 1; k <= steps; k++) {
      const i = (this.hintIdx + k * 6) % N;
      const a = this.track.samples[(i - 3 + N) % N];
      const b = this.track.samples[i];
      const c = this.track.samples[(i + 3) % N];
      const v1x = b.pos.x - a.pos.x, v1z = b.pos.z - a.pos.z;
      const v2x = c.pos.x - b.pos.x, v2z = c.pos.z - b.pos.z;
      const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
      if (l1 < 1e-4 || l2 < 1e-4) continue;
      const cross = (v1x * v2z - v1z * v2x) / (l1 * l2);
      const curv = Math.abs(cross) / ((l1 + l2) * 0.5);
      // weight nearer corners more
      const w = 1 - (k / steps) * 0.5;
      maxCurv = Math.max(maxCurv, curv * w);
    }
    return maxCurv;
  }

  drive(dt, cars, raceActive) {
    const car = this.car;
    const track = this.track;

    this.hintIdx = track.nearestIndex(car.x, car.z, this.hintIdx);
    const s = track.samples[this.hintIdx];

    /* ---------- stuck detection / recovery ---------- */
    if (raceActive && Math.abs(car.vx) < 1.2) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > 2.5) this.recoverTimer = 1.6;

    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      // reverse toward track center
      const lat = track.lateralOffset(car.x, car.z, this.hintIdx);
      return {
        throttle: 0, brake: 0.8, steer: clampAI(lat * 0.15, -1, 1),
        handbrake: false, nitro: false, reversing: true,
      };
    }

    /* ---------- steering: pure pursuit ---------- */
    const speed = Math.abs(car.vx);
    const lookDist = 6 + speed * 0.55;
    const N = track.samples.length;
    const perSample = track.length / N;
    const lookIdx = (this.hintIdx + Math.round(lookDist / perSample)) % N;
    const ls = track.samples[lookIdx];
    // target point = centerline + desired lateral offset
    const tx = ls.pos.x + ls.nx * this.lateralWish;
    const tz = ls.pos.z + ls.nz * this.lateralWish;

    // direction to target in car's local frame
    const dx = tx - car.x, dz = tz - car.z;
    const cosH = Math.cos(car.heading), sinH = Math.sin(car.heading);
    const localX = dx * cosH + dz * sinH;   // forward
    const localY = -dx * sinH + dz * cosH;  // left
    let steer = clampAI(Math.atan2(localY, Math.max(localX, 0.5)) * 2.2, -1, 1);

    /* ---------- speed control ---------- */
    const curv = this._curvatureAhead(18 + speed * speed * 0.045);
    // cornering speed limit: v = sqrt(latAccel / curvature)
    const maxLat = 8.5 + this.skill * 3.5; // m/s² the AI dares
    let targetSpeed = curv > 1e-4 ? Math.sqrt(maxLat / curv) : 200;
    targetSpeed *= 0.72 + this.skill * 0.33;
    // straight-line top speed by skill
    const topSpeed = 42 + this.skill * 16;
    targetSpeed = Math.min(targetSpeed, topSpeed);

    if (!raceActive) targetSpeed = 0;

    let throttle = 0, brake = 0;
    if (speed < targetSpeed - 0.5) {
      throttle = clampAI((targetSpeed - speed) * 0.4, 0.25, 1);
    } else if (speed > targetSpeed + 1.5) {
      brake = clampAI((speed - targetSpeed) * 0.25, 0, 1);
    }

    /* ---------- avoidance ---------- */
    for (const other of cars) {
      if (other === car) continue;
      const ox = other.x - car.x, oz = other.z - car.z;
      const fwd = ox * cosH + oz * sinH;
      const side = -ox * sinH + oz * cosH;
      if (fwd > 0 && fwd < 14 && Math.abs(side) < 3.2) {
        // car ahead in our path — steer around it
        steer += side > 0 ? -0.35 : 0.35;
        if (fwd < 7 && speed > Math.abs(other.vx) + 2) brake = Math.max(brake, 0.4);
      }
    }

    /* ---------- nitro on straights ---------- */
    const nitro = raceActive && curv < 0.008 && speed > 20 && car.nitro > 0.35 && this.skill > 0.4;

    // occasionally change racing line
    this.throttleNoise += dt;
    if (this.throttleNoise > 6) {
      this.throttleNoise = 0;
      this.lateralWish = (Math.random() * 2 - 1) * (track.halfW * 0.45);
    }

    return { throttle, brake, steer: clampAI(steer, -1, 1), handbrake: false, nitro };
  }
}

function clampAI(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
