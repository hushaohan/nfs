/* =====================================================================
 * physics.js — Realistic vehicle dynamics
 * ---------------------------------------------------------------------
 * A semi-professional bicycle/slip model:
 *   • Pacejka-style "Magic Formula" tire lateral forces per axle
 *   • Longitudinal engine/brake forces with a friction-circle traction
 *     limit (combined slip)
 *   • Longitudinal + lateral weight transfer onto each axle
 *   • Load-sensitive tire grip (friction drops slightly under load)
 *   • Drivetrain: torque curve, gearbox, final drive, auto-shift
 *   • Aerodynamic drag + speed-sensitive downforce
 *   • Handbrake (rear lockup → oversteer / drift)
 *   • Nitro boost
 * Units are SI (m, s, kg, N). Speed stored in m/s.
 * ===================================================================== */
"use strict";

/* ---------- small helpers ---------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const sign  = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/* Pacejka Magic Formula. Returns a force that OPPOSES the slip input.
 * x    : slip angle (rad) for lateral, or slip ratio for longitudinal
 * load : normal load on the tire (N)
 * B,C,D,E : shape parameters; D is the peak friction coefficient      */
function pacejka(x, load, B, C, D, E) {
  const peak = D * load;                 // peak force (N)
  const Bx = B * x;
  const inner = Bx - E * (Bx - Math.atan(Bx));
  return -peak * Math.sin(C * Math.atan(inner));
}

/* =====================================================================
 * CarPhysics
 * ===================================================================== */
class CarPhysics {
  constructor(spec) {
    this.spec = spec;

    /* ---- geometry / mass ---- */
    this.mass        = spec.mass;                 // kg
    this.inertia     = spec.inertia;              // yaw inertia kg·m²
    this.wheelbase   = spec.wheelbase;            // m
    this.cgToFront   = spec.wheelbase * spec.cgFront; // CG→front axle (m)
    this.cgToRear    = spec.wheelbase - this.cgToFront;
    this.cgHeight    = spec.cgHeight;             // m
    this.trackWidth  = spec.trackWidth;           // m
    this.wheelRadius = spec.wheelRadius;          // m

    /* ---- tires ---- */
    this.tire = spec.tire;                        // {B,C,D,E,loadSens}
    this.baseMu = spec.tire.D;                    // peak friction coeff

    /* ---- drivetrain ---- */
    this.engine      = spec.engine;               // {maxTorque, redline, idle}
    this.gears       = spec.gears;                // array of ratios
    this.finalDrive  = spec.finalDrive;
    this.driveBias   = spec.driveBias;            // 0=RWD 1=FWD 0.5=AWD
    this.gear        = 1;                         // current gear index (0 = neutral-ish)
    this.rpm         = this.engine.idle;

    /* ---- aero ---- */
    this.dragCoef    = spec.dragCoef;             // lumped ½ρCdA
    this.downforce   = spec.downforce;            // N per (m/s)²

    /* ---- state ---- */
    this.x = 0; this.z = 0;                       // world position
    this.heading = 0;                             // yaw (rad), 0 = +X
    this.vx = 0;                                  // body forward speed (m/s)
    this.vy = 0;                                  // body lateral speed (m/s, +left)
    this.yawRate = 0;                             // rad/s
    this.steer = 0;                               // smoothed steering (rad)

    this.wheelSpin = 0;                           // visual wheel rotation
    this.slipRear = 0; this.slipFront = 0;        // for FX / drift detection
    this.drifting = false;
    this.driftAmount = 0;

    /* ---- resources ---- */
    this.nitro = 1.0;                             // 0..1
    this.nitroActive = false;

    /* ---- per-frame outputs (for game/FX) ---- */
    this.accelX = 0; this.accelY = 0;             // body accel (m/s²)
    this.speedKmh = 0;
    this.localGrip = 1;

    this._brakeLight = false;
  }

  /* Place the car on the track */
  reset(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = 0; this.vy = 0; this.yawRate = 0; this.steer = 0;
    this.gear = 1; this.rpm = this.engine.idle;
    this.wheelSpin = 0; this.drifting = false; this.driftAmount = 0;
    this.accelX = 0; this.accelY = 0;
  }

  /* Current forward speed (m/s) */
  get speed() { return this.vx; }

  /* ------------------------------------------------------------------
   * step — advance the simulation by dt seconds
   * input = { throttle, brake, steer(-1..1), handbrake, nitro }
   * ------------------------------------------------------------------ */
  step(dt, input, surfaceGrip = 1.0) {
    const th   = clamp(input.throttle, 0, 1);
    const br   = clamp(input.brake, 0, 1);
    const stIn = clamp(input.steer, -1, 1);
    const hb   = input.handbrake ? 1 : 0;

    /* ---------- steering (rate-limited, speed-sensitive) ---------- */
    const maxSteer = this.spec.maxSteer;                 // rad at low speed
    // reduce max steering angle with speed for stability
    const speedFactor = 1.0 / (1.0 + this.spec.steerSpeedFall * Math.abs(this.vx));
    const targetSteer = stIn * maxSteer * speedFactor;
    const steerRate = this.spec.steerRate;               // rad/s
    const dSteer = clamp(targetSteer - this.steer, -steerRate * dt, steerRate * dt);
    this.steer += dSteer;

    /* ---------- longitudinal slip / drivetrain ---------- */
    const rolling = this.vx;                              // signed forward speed
    const wheelOmega = rolling / this.wheelRadius;        // rad/s (rolling)

    // engine rpm from drive wheels
    const ratio = this.gears[this.gear - 1] * this.finalDrive;
    let engineRpmFromWheels = Math.abs(wheelOmega) * ratio * 60 / (2 * Math.PI);
    this.rpm = clamp(Math.max(engineRpmFromWheels, this.engine.idle),
                     this.engine.idle, this.engine.redline * 1.05);

    // auto gearbox
    this._autoShift();

    // engine torque from rpm curve
    const torque = this._engineTorque(this.rpm);
    // nitro boost multiplies torque
    this.nitroActive = false;
    let boost = 1.0;
    if (input.nitro && this.nitro > 0.02 && th > 0.1) {
      boost = this.spec.nitroBoost;
      this.nitro = Math.max(0, this.nitro - this.spec.nitroDrain * dt);
      this.nitroActive = true;
    } else {
      this.nitro = Math.min(1, this.nitro + this.spec.nitroRegen * dt);
    }

    // drive force at the wheels (N)
    let driveForce = 0;
    let reversing = false;
    if (th > 0) {
      driveForce = torque * boost * th * ratio * this.spec.drivetrainEff / this.wheelRadius;
      this._reversing = false;
    } else if (br > 0.5 && this.vx < 0.8) {
      // hard brake at standstill → reverse gear (capped reverse speed);
      // light brake pressure (e.g. auto-brake) never engages reverse
      reversing = true;
      this._reversing = true;
      const revScale = clamp(1 + Math.min(this.vx, 0) / 9, 0, 1);
      driveForce = -br * this.spec.reverseForce * revScale;
    } else {
      this._reversing = false;
    }

    // brake force (N) — opposes motion (suppressed while reversing)
    let brakeForce = 0;
    if (br > 0 && !reversing) {
      brakeForce = br * this.spec.brakeForce;
    }
    this._brakeLight = br > 0.05 || hb > 0;

    /* ---------- weight transfer (longitudinal) ---------- */
    const g = 9.81;
    const staticFront = this.mass * g * (this.cgToRear / this.wheelbase);
    const staticRear  = this.mass * g * (this.cgToFront / this.wheelbase);

    // estimate longitudinal accel for transfer (use previous frame accel)
    const transferLong = -this.mass * this.accelX * this.cgHeight / this.wheelbase;
    let loadFront = staticFront + transferLong;
    let loadRear  = staticRear  - transferLong;

    // aerodynamic downforce adds load (split by cg position)
    const aeroLoad = this.downforce * this.vx * Math.abs(this.vx);
    loadFront += aeroLoad * (this.cgToRear / this.wheelbase);
    loadRear  += aeroLoad * (this.cgToFront / this.wheelbase);

    loadFront = Math.max(loadFront, this.mass * g * 0.05);
    loadRear  = Math.max(loadRear,  this.mass * g * 0.05);

    /* ---------- slip angles ---------- */
    const a = this.cgToFront, b = this.cgToRear;
    const minV = 0.5; // avoid div-by-zero at standstill
    const vAbs = Math.max(Math.abs(this.vx), minV);
    const dir = sign(this.vx) || 1;

    const slipFront = Math.atan2(this.vy + a * this.yawRate, vAbs) * dir - this.steer;
    const slipRear  = Math.atan2(this.vy - b * this.yawRate, vAbs) * dir;
    this.slipFront = slipFront; this.slipRear = slipRear;

    /* ---------- lateral tire forces (Pacejka) ---------- */
    const T = this.tire;
    const grip = surfaceGrip;
    // load-sensitive peak: D scales slightly sub-linearly with load
    const ls = T.loadSens;
    const Df = T.D * grip * Math.pow(loadFront / (this.mass * g * 0.5), ls);
    const Dr = T.D * grip * Math.pow(loadRear  / (this.mass * g * 0.5), ls);

    let FyF = pacejka(slipFront, loadFront, T.B, T.C, Df, T.E);
    let FyR = pacejka(slipRear,  loadRear,  T.B, T.C, Dr, T.E);

    // handbrake drastically reduces rear lateral grip → oversteer
    if (hb > 0) FyR *= this.spec.handbrakeGrip;

    /* ---------- longitudinal forces + friction circle ---------- */
    // split drive force between axles by driveBias
    const Fx_drive_front = driveForce * this.driveBias;
    const Fx_drive_rear  = driveForce * (1 - this.driveBias);

    // braking split (front-biased)
    const brakeSplit = this.spec.brakeBias;
    let Fx_brake_front = -sign(this.vx) * brakeForce * brakeSplit;
    let Fx_brake_rear  = -sign(this.vx) * brakeForce * (1 - brakeSplit);
    if (hb > 0) { // handbrake locks rears
      Fx_brake_rear = -sign(this.vx) * Math.min(brakeForce * 0.9 + this.spec.handbrakeForce, Math.abs(this.vx) * this.mass * 2);
    }

    // rolling resistance + aero drag (applied to whole body)
    const rollRes = -sign(this.vx) * this.spec.rollResist * this.mass * g;
    const aeroDrag = -this.dragCoef * this.vx * Math.abs(this.vx);

    // friction-circle limit per axle (combined slip)
    // peak force available at each axle = peak friction coeff × normal load
    const muF = Df; const muR = Dr;
    const maxFForce = muF * loadFront;
    const maxRForce = muR * loadRear;
    const combF = Math.hypot(Fx_drive_front + Fx_brake_front, FyF);
    if (combF > maxFForce && combF > 1e-3) {
      const s = maxFForce / combF;
      FyF *= s;
    }
    const combR = Math.hypot(Fx_drive_rear + Fx_brake_rear, FyR);
    if (combR > maxRForce && combR > 1e-3) {
      const s = maxRForce / combR;
      FyR *= s;
    }

    // clamp longitudinal by traction too (wheelspin / lockup)
    let Fx_front = Fx_drive_front + Fx_brake_front;
    let Fx_rear  = Fx_drive_rear  + Fx_brake_rear;
    Fx_front = clamp(Fx_front, -maxFForce, maxFForce);
    Fx_rear  = clamp(Fx_rear,  -maxRForce, maxRForce);

    /* ---------- total forces in body frame ---------- */
    const Fx_total = Fx_front + Fx_rear + rollRes + aeroDrag;
    const Fy_total = FyF + FyR;

    // yaw moment from lateral forces (+ front pushes left → yaw left)
    const Mz = a * FyF - b * FyR;
    // small aligning damping
    const yawDamp = -this.spec.yawDamping * this.yawRate;

    /* ---------- integrate ---------- */
    this.accelX = Fx_total / this.mass;
    this.accelY = Fy_total / this.mass;

    // rotate body-frame accel into velocity changes
    this.vx += this.accelX * dt;
    this.vy += this.accelY * dt;
    // centripetal coupling: body frame rotates with yawRate
    this.vx += this.yawRate * this.vy * dt;
    this.vy -= this.yawRate * this.vx * dt;

    this.yawRate += (Mz / this.inertia + yawDamp / this.inertia) * dt;
    // damp yaw slightly for stability
    this.yawRate *= Math.max(0, 1 - this.spec.yawFriction * dt);

    this.heading += this.yawRate * dt;

    // integrate world position from body velocity
    const cosH = Math.cos(this.heading), sinH = Math.sin(this.heading);
    const worldVx = this.vx * cosH - this.vy * sinH;
    const worldVz = this.vx * sinH + this.vy * cosH;
    this.x += worldVx * dt;
    this.z += worldVz * dt;

    // low-speed: bleed off lateral velocity so car doesn't slide at rest
    if (Math.abs(this.vx) < 0.6) {
      this.vy *= Math.max(0, 1 - 6 * dt);
      this.yawRate *= Math.max(0, 1 - 4 * dt);
    }

    /* ---------- drift detection & FX metrics ---------- */
    const slipMag = Math.abs(slipRear) + Math.abs(slipFront) * 0.5;
    this.driftAmount = clamp((slipMag - 0.12) * 3.0, 0, 1);
    this.drifting = this.driftAmount > 0.15 && Math.abs(this.vx) > 4;

    /* ---------- wheel spin for visuals ---------- */
    const driveSpin = (driveForce > 0 && combR > maxRForce * 0.98) ? wheelOmega * 1.6 : wheelOmega;
    this.wheelSpin += driveSpin * dt;

    this.speedKmh = Math.abs(this.vx) * 3.6;
    this.localGrip = grip;

    return this;
  }

  /* ---------- engine torque curve ---------- */
  _engineTorque(rpm) {
    const e = this.engine;
    const x = clamp(rpm / e.redline, 0, 1.05);
    // smooth curve: rises to a peak ~70% redline then falls
    const peakPos = 0.72;
    let t;
    if (x < peakPos) {
      const u = x / peakPos;
      t = 0.55 + 0.45 * Math.sin(u * Math.PI * 0.5);
    } else {
      const u = (x - peakPos) / (1.05 - peakPos);
      t = 1.0 - 0.35 * u * u;
    }
    return e.maxTorque * clamp(t, 0, 1.2);
  }

  /* ---------- automatic gearbox ---------- */
  _autoShift() {
    const up = this.engine.shiftUp;    // fraction of redline
    const down = this.engine.shiftDown;
    const frac = this.rpm / this.engine.redline;
    if (frac > up && this.gear < this.gears.length) {
      this.gear++;
      this.rpm *= 0.72; // drop after upshift
    } else if (frac < down && this.gear > 1) {
      this.gear--;
      this.rpm *= 1.25;
    }
  }

  /* world-space velocity (for collisions / AI) */
  worldVelocity() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: this.vx * c - this.vy * s, z: this.vx * s + this.vy * c };
  }
}

/* =====================================================================
 * Car specifications — three selectable cars with distinct characters
 * ===================================================================== */
const CAR_SPECS = {
  falcon: {
    name: "FALCON GT", cls: "BALANCED · RWD",
    color: 0xff3b30, accent: 0x1a1a1a,
    mass: 1450, inertia: 2350,
    wheelbase: 2.62, cgFront: 0.48, cgHeight: 0.52, trackWidth: 1.76, wheelRadius: 0.33,
    maxSteer: 0.70, steerRate: 3.6, steerSpeedFall: 0.015,
    tire: { B: 12.0, C: 1.40, D: 1.70, E: -0.35, loadSens: -0.14 },
    engine: { maxTorque: 560, redline: 7600, idle: 900, shiftUp: 0.95, shiftDown: 0.42 },
    gears: [3.6, 2.2, 1.55, 1.18, 0.95, 0.78], finalDrive: 3.45,
    driveBias: 0.0, drivetrainEff: 0.86,
    brakeForce: 26000, brakeBias: 0.62, reverseForce: 7500,
    dragCoef: 0.62, downforce: 2.4, rollResist: 0.012,
    handbrakeGrip: 0.35, handbrakeForce: 9000,
    yawDamping: 260, yawFriction: 0.50,
    nitroBoost: 1.55, nitroDrain: 0.30, nitroRegen: 0.05,
    stats: { speed: 0.82, accel: 0.80, grip: 0.78, nitro: 0.75 },
  },
  viper: {
    name: "VIPER X", cls: "TOP SPEED · AWD",
    color: 0x00d4ff, accent: 0x0a0a12,
    mass: 1620, inertia: 2700,
    wheelbase: 2.70, cgFront: 0.50, cgHeight: 0.50, trackWidth: 1.84, wheelRadius: 0.34,
    maxSteer: 0.65, steerRate: 3.3, steerSpeedFall: 0.016,
    tire: { B: 11.5, C: 1.42, D: 1.62, E: -0.35, loadSens: -0.13 },
    engine: { maxTorque: 640, redline: 8200, idle: 950, shiftUp: 0.96, shiftDown: 0.44 },
    gears: [3.3, 2.1, 1.5, 1.15, 0.92, 0.75, 0.62], finalDrive: 3.30,
    driveBias: 0.45, drivetrainEff: 0.84,
    brakeForce: 27500, brakeBias: 0.60, reverseForce: 7800,
    dragCoef: 0.58, downforce: 3.0, rollResist: 0.011,
    handbrakeGrip: 0.40, handbrakeForce: 8500,
    yawDamping: 300, yawFriction: 0.55,
    nitroBoost: 1.60, nitroDrain: 0.32, nitroRegen: 0.05,
    stats: { speed: 0.95, accel: 0.84, grip: 0.72, nitro: 0.85 },
  },
  kitsune: {
    name: "KITSUNE RS", cls: "HANDLING · RWD",
    color: 0xffb300, accent: 0x141414,
    mass: 1250, inertia: 1900,
    wheelbase: 2.48, cgFront: 0.46, cgHeight: 0.48, trackWidth: 1.72, wheelRadius: 0.32,
    maxSteer: 0.76, steerRate: 4.1, steerSpeedFall: 0.014,
    tire: { B: 12.5, C: 1.38, D: 1.80, E: -0.30, loadSens: -0.15 },
    engine: { maxTorque: 470, redline: 8600, idle: 1000, shiftUp: 0.95, shiftDown: 0.46 },
    gears: [3.7, 2.35, 1.65, 1.25, 1.0, 0.84], finalDrive: 3.70,
    driveBias: 0.0, drivetrainEff: 0.88,
    brakeForce: 24500, brakeBias: 0.64, reverseForce: 7200,
    dragCoef: 0.60, downforce: 2.6, rollResist: 0.012,
    handbrakeGrip: 0.30, handbrakeForce: 9500,
    yawDamping: 220, yawFriction: 0.44,
    nitroBoost: 1.50, nitroDrain: 0.28, nitroRegen: 0.06,
    stats: { speed: 0.70, accel: 0.76, grip: 0.95, nitro: 0.70 },
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CarPhysics, CAR_SPECS, pacejka, clamp, lerp };
}
