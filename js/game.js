/* =====================================================================
 * game.js — Core game: rendering, race loop, cameras, collisions,
 * lap logic, HUD (speedometer, minimap, timers), game states.
 * ===================================================================== */
"use strict";

const TOTAL_LAPS = 3;
const AI_COUNT = 5;
const PHYS_DT = 1 / 120;

const clampG = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerpG = (a, b, t) => a + (b - a) * t;

const STATES = { MENU: 0, COUNTDOWN: 1, RACING: 2, PAUSED: 3, FINISHED: 4 };

class Game {
  constructor() {
    this.state = STATES.MENU;
    this.selectedCar = "falcon";
    this.autoBrake = false;
    // on-screen touch controls (set by main.js; merged into player input)
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false, handbrake: false };
    this.cameraMode = 0;
    this.racers = [];          // { car: CarPhysics, mesh, ai: AIDriver|null, isPlayer, name, color, distSamples, prevIdx, lapDone, finishTime, hintIdx }
    this.player = null;
    this.raceTime = 0;
    this.countdownT = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.lapStartTime = 0;
    this.driftScore = 0;
    this.driftFade = 0;
    this.wrongWayTimer = 0;
    this.shake = 0;
    this.finishShown = false;
    this._accum = 0;
    this._lastT = 0;
    this.keys = {};
    this.audio = new AudioEngine();
  }

  /* ================= setup ================= */
  init(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x2a3550, 180, 750);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);
    this.camera.position.set(0, 30, -30);

    this._buildLights();
    this._buildSky();

    this.track = new Track(this.scene);
    this.particles = new ParticleSystem(this.scene);

    this._buildMinimapPath();
    this._bindInput();

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.speedoCtx = document.getElementById("speedo").getContext("2d");
    this.minimapCtx = document.getElementById("minimap").getContext("2d");
    const radar = document.getElementById("radar");
    this.radarCtx = radar ? radar.getContext("2d") : null;

    requestAnimationFrame((t) => this._loop(t));
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x8fa8d8, 0x1a2028, 0.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffc07a, 1.35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _buildSky() {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#0a1130");
    grad.addColorStop(0.45, "#27407c");
    grad.addColorStop(0.72, "#c85a3a");
    grad.addColorStop(0.85, "#ff9d4d");
    grad.addColorStop(1.0, "#ffc880");
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    const skyGeo = new THREE.SphereGeometry(1600, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    // low sun glow sprite
    const sc = document.createElement("canvas");
    sc.width = sc.height = 128;
    const sg = sc.getContext("2d");
    const rg = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,230,180,1)");
    rg.addColorStop(0.3, "rgba(255,170,90,0.55)");
    rg.addColorStop(1, "rgba(255,150,60,0)");
    sg.fillStyle = rg;
    sg.fillRect(0, 0, 128, 128);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(sc), fog: false, depthWrite: false,
    }));
    sprite.scale.set(700, 700, 1);
    sprite.position.set(900, 120, 700);
    this.scene.add(sprite);
  }

  /* ================= race lifecycle ================= */
  startRace() {
    this._clearRacers();
    this.audio.init();
    this.audio.resume();

    const spec = CAR_SPECS[this.selectedCar];
    const N = this.track.samples.length;

    // grid: player starts at the back, NFS style
    const gridCount = AI_COUNT + 1;
    for (let i = 0; i < gridCount; i++) {
      const isPlayer = i === gridCount - 1;
      const back = 12 + i * 7;                       // meters behind start line
      const t = 1 - back / this.track.length;
      const lateral = (i % 2 === 0 ? -1 : 1) * 3.1;
      const p = this.track.pointAt(t, lateral);
      const heading = Math.atan2(p.tan.z, p.tan.x);

      let racer;
      if (isPlayer) {
        const car = new CarPhysics(spec);
        car.reset(p.x, p.z, heading);
        racer = { car, mesh: buildCarMesh(spec), ai: null, isPlayer: true, name: "YOU", color: spec.color };
        this.player = racer;
      } else {
        const keys = Object.keys(CAR_SPECS);
        const aiSpec = CAR_SPECS[keys[i % keys.length]];
        const car = new CarPhysics(aiSpec);
        car.reset(p.x, p.z, heading);
        const skill = 0.5 + (i / AI_COUNT) * 0.42;
        racer = {
          car, mesh: buildCarMesh(aiSpec), ai: new AIDriver(this.track, car, skill, i),
          isPlayer: false, name: AI_NAMES[i % AI_NAMES.length], color: aiSpec.color,
        };
      }
      racer.mesh.position.set(p.x, 0, p.z);
      racer.mesh.rotation.y = Math.PI / 2 - heading;
      this.scene.add(racer.mesh);

      racer.prevIdx = p.idx;
      racer.distSamples = p.idx - N;                 // negative until crossing the line
      racer.lapDone = 0;
      racer.finishTime = null;
      racer.hintIdx = p.idx;
      this.racers.push(racer);
    }

    this.raceTime = 0;
    this.lastLap = null; this.bestLap = null; this.lapStartTime = 0;
    this.driftScore = 0; this.driftFade = 0;
    this.wrongWayTimer = 0; this.shake = 0;
    this.finishShown = false;
    this.countdownT = 3.99;
    this.state = STATES.COUNTDOWN;
    this._lastCount = 4;

    this._showScreen(null);
    document.getElementById("hud").classList.remove("hidden");
    document.getElementById("countdown").classList.remove("hidden");
    document.getElementById("lap-total").textContent = TOTAL_LAPS;
    document.getElementById("pos-total").textContent = this.racers.length;
  }

  _clearRacers() {
    for (const r of this.racers) this.scene.remove(r.mesh);
    this.racers = [];
    this.player = null;
  }

  restart() { this.startRace(); }

  toMenu() {
    this._clearRacers();
    this.state = STATES.MENU;
    this.audio.updateEngine(0, 0, false, true);
    this.audio.updateScreech(0, 0);
    document.getElementById("hud").classList.add("hidden");
    this._showScreen("menu-main");
  }

  pause() {
    if (this.state === STATES.RACING || this.state === STATES.COUNTDOWN) {
      this._pausedFrom = this.state;
      this.state = STATES.PAUSED;
      this.audio.updateEngine(0, 0, false, true);
      this.audio.updateScreech(0, 0);
      this._showScreen("menu-pause");
    }
  }
  resume() {
    if (this.state === STATES.PAUSED) {
      this.state = this._pausedFrom || STATES.RACING;
      this._showScreen(null);
    }
  }

  _showScreen(id) {
    for (const s of ["menu-main", "menu-car", "menu-controls", "menu-pause", "menu-results"]) {
      document.getElementById(s).classList.toggle("hidden", s !== id);
    }
  }

  /* ================= input ================= */
  _bindInput() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === "KeyC" && this.player) this.cameraMode = (this.cameraMode + 1) % 3;
      if (e.code === "KeyB") {
        this.autoBrake = !this.autoBrake;
        const el = document.getElementById("autobrake-state");
        if (el) el.textContent = this.autoBrake ? "ON" : "OFF";
        const btn = document.getElementById("btn-autobrake");
        if (btn) btn.classList.toggle("on", this.autoBrake);
        this.audio.click();
      }
      if (e.code === "KeyR" && this.state === STATES.RACING && this.player) this._resetPlayerToTrack();
      if (e.code === "Escape") {
        if (this.state === STATES.PAUSED) this.resume();
        else this.pause();
      }
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    window.addEventListener("blur", () => { this.keys = {}; });
  }

  _playerInput() {
    const k = this.keys;
    const t = this.touch || {};
    const throttle = (k["KeyW"] || k["ArrowUp"] || t.gas) ? 1 : 0;
    let brake = (k["KeyS"] || k["ArrowDown"] || t.brake) ? 1 : 0;
    let steer = 0;
    if (k["KeyA"] || k["ArrowLeft"] || t.left) steer -= 1;
    if (k["KeyD"] || k["ArrowRight"] || t.right) steer += 1;
    // auto-brake: releasing the throttle applies the brakes (toggle with B)
    if (this.autoBrake && throttle === 0 && brake === 0 && this.player) {
      const vx = this.player.car.vx;
      if (vx > 1.2) brake = clampG((vx - 1.0) / 10, 0.15, 0.75);
    }
    return {
      throttle, brake, steer,
      handbrake: !!(k["Space"] || t.handbrake),
      nitro: !!(k["ShiftLeft"] || k["ShiftRight"] || t.nitro),
    };
  }

  _resetPlayerToTrack() {
    const car = this.player.car;
    const idx = this.track.nearestIndex(car.x, car.z, this.player.hintIdx);
    const s = this.track.samples[idx];
    car.reset(s.pos.x, s.pos.z, Math.atan2(s.tan.z, s.tan.x));
    this.shake = 0;
  }

  /* ================= main loop ================= */
  _loop(tMs) {
    requestAnimationFrame((t) => this._loop(t));
    const t = tMs / 1000;
    let dt = this._lastT ? t - this._lastT : 1 / 60;
    this._lastT = t;
    dt = Math.min(dt, 0.05);

    if (this.state === STATES.COUNTDOWN) this._updateCountdown(dt);
    if (this.state === STATES.RACING || this.state === STATES.COUNTDOWN || this.state === STATES.FINISHED) {
      this._updateRace(dt);
    }

    this.particles.update(dt);
    this._updateCamera(dt);
    this._updateSun();
    this.renderer.render(this.scene, this.camera);
  }

  _updateCountdown(dt) {
    this.countdownT -= dt;
    const el = document.getElementById("countdown");
    const n = Math.ceil(this.countdownT);
    if (n !== this._lastCount) {
      this._lastCount = n;
      if (n > 0 && n <= 3) {
        el.textContent = n;
        el.classList.remove("go");
        el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
        this.audio.beep(440, 0.18, 0.3);
      } else if (n <= 0) {
        el.textContent = "GO!";
        el.classList.add("go");
        el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
        this.audio.beep(880, 0.5, 0.35);
      }
    }
    if (this.countdownT <= -0.8) {
      el.classList.add("hidden");
      this.state = STATES.RACING;
      this.raceTime = 0;
      this.lapStartTime = 0;
    }
  }

  _updateRace(dt) {
    const racing = this.state === STATES.RACING || this.state === STATES.FINISHED;
    if (this.state === STATES.RACING) this.raceTime += dt;

    // fixed-step physics for stability
    this._accum = Math.min(this._accum + dt, PHYS_DT * 6);
    while (this._accum >= PHYS_DT) {
      this._accum -= PHYS_DT;
      this._stepAll(PHYS_DT, racing);
    }

    // per-frame: collisions, laps, FX, HUD
    this._handleCarCollisions();
    for (const r of this.racers) this._handleBarrier(r);
    for (const r of this.racers) this._updateLapProgress(r);
    this._updateEffects(dt);
    this._updateHUD(dt);
    this._updateAudio();

    if (this.state === STATES.FINISHED && !this.finishShown) {
      this._finishDelay = (this._finishDelay || 0) + dt;
      if (this._finishDelay > 2.0) {
        this.finishShown = true;
        this._showResults();
      }
    }
  }

  _stepAll(dt, racing) {
    for (const r of this.racers) {
      let input;
      if (r.isPlayer) {
        input = racing && this.state === STATES.RACING ? this._playerInput() : { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
        if (this.state === STATES.FINISHED) {
          // gentle auto-drive after finishing
          input = r.ai ? r.ai.drive(dt, [], true) : { throttle: 0.3, brake: 0, steer: 0, handbrake: false, nitro: false };
          if (!r.ai) r.ai = new AIDriver(this.track, r.car, 0.5, 99);
        }
      } else {
        // during countdown keep AI fully neutral (no steering), otherwise
        // stationary steered tires generate lateral force and the cars
        // vibrate / rotate on the grid
        input = racing
          ? r.ai.drive(dt, this.racers.map(x => x.car), this.state === STATES.RACING)
          : { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
      }
      r.car.step(dt, input, 1.0);
    }
  }

  /* ---------- car vs car ---------- */
  _handleCarCollisions() {
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const A = this.racers[i].car, B = this.racers[j].car;
        const dx = B.x - A.x, dz = B.z - A.z;
        const dist = Math.hypot(dx, dz);
        const minDist = 2.3;
        if (dist < minDist && dist > 1e-4) {
          const nx = dx / dist, nz = dz / dist;
          const overlap = minDist - dist;
          A.x -= nx * overlap * 0.5; A.z -= nz * overlap * 0.5;
          B.x += nx * overlap * 0.5; B.z += nz * overlap * 0.5;

          const va = A.worldVelocity(), vb = B.worldVelocity();
          const relN = (vb.x - va.x) * nx + (vb.z - va.z) * nz;
          if (relN < 0) {
            const e = 0.35;
            let jImp = -(1 + e) * relN / (1 / A.mass + 1 / B.mass);
            // safety cap so a squeezed/overlapping pair can never be launched
            const maxJ = 18 * Math.min(A.mass, B.mass);
            if (jImp > maxJ) jImp = maxJ;
            // n points A→B: push A backwards (-n) and B forwards (+n)
            this._applyWorldImpulse(A, -nx * jImp, -nz * jImp);
            this._applyWorldImpulse(B,  nx * jImp,  nz * jImp);
            const strength = Math.min(1, -relN / 12);
            if (strength > 0.12) {
              const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
              this.particles.sparks(mx, 0.5, mz, nx, nz, strength);
              if (this.racers[i].isPlayer || this.racers[j].isPlayer) {
                this.audio.impact(strength * 0.8);
                this.shake = Math.max(this.shake, strength * 0.5);
              }
            }
          }
        }
      }
    }
  }

  _applyWorldImpulse(car, jx, jz) {
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    car.vx += (jx * c + jz * s) / car.mass;
    car.vy += (-jx * s + jz * c) / car.mass;
    // small yaw kick proportional to impact strength (lateral component of impulse)
    const jLat = -jx * s + jz * c;
    const kick = clampG(jLat / car.mass, -0.6, 0.6) * 0.35;
    car.yawRate += kick;
  }

  /* ---------- car vs barriers ---------- */
  _handleBarrier(r) {
    const car = r.car;
    const res = this.track.collide(car.x, car.z, r.hintIdx);
    r.hintIdx = res.idx;
    if (res.hit) {
      car.x = res.x; car.z = res.z;
      const v = car.worldVelocity();
      const vN = v.x * res.nx + v.z * res.nz;
      if (vN < 0) {
        const e = 0.3;
        const jx = res.nx * (-vN * (1 + e)) * car.mass;
        const jz = res.nz * (-vN * (1 + e)) * car.mass;
        this._applyWorldImpulse(car, jx, jz);
        // scrape friction along wall
        car.vx *= 0.985;
        const strength = Math.min(1, -vN / 14);
        if (strength > 0.1) {
          this.particles.sparks(car.x + res.nx * -1, 0.4, car.z + res.nz * -1, res.nx, res.nz, strength);
          if (r.isPlayer) {
            this.audio.impact(strength);
            this.shake = Math.max(this.shake, strength * 0.7);
          }
        }
      }
    }
  }

  /* ---------- lap / progress ---------- */
  _updateLapProgress(r) {
    const N = this.track.samples.length;
    const idx = this.track.nearestIndex(r.car.x, r.car.z, r.hintIdx);
    let delta = idx - r.prevIdx;
    if (delta > N / 2) delta -= N;
    if (delta < -N / 2) delta += N;
    r.prevIdx = idx;
    r.distSamples += delta;

    const lapsDone = Math.floor(r.distSamples / N);
    if (lapsDone > r.lapDone) {
      r.lapDone = lapsDone;
      if (r.isPlayer && this.state === STATES.RACING) {
        const lapTime = this.raceTime - this.lapStartTime;
        this.lapStartTime = this.raceTime;
        this.lastLap = lapTime;
        if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
        if (lapsDone >= 1) this.audio.beep(660, 0.15, 0.25);
        if (r.lapDone >= TOTAL_LAPS) {
          r.finishTime = this.raceTime;
          this.state = STATES.FINISHED;
          this._finishDelay = 0;
        }
      } else if (!r.isPlayer && r.lapDone >= TOTAL_LAPS && r.finishTime === null) {
        r.finishTime = this.raceTime;
      }
    }
  }

  _playerPosition() {
    const sorted = [...this.racers].sort((a, b) => {
      const af = a.finishTime !== null, bf = b.finishTime !== null;
      if (af && bf) return a.finishTime - b.finishTime;
      if (af) return -1;
      if (bf) return 1;
      return b.distSamples - a.distSamples;
    });
    return sorted.findIndex(r => r.isPlayer) + 1;
  }

  /* ---------- visual effects ---------- */
  _updateEffects(dt) {
    for (const r of this.racers) {
      const car = r.car;
      // sync mesh
      r.mesh.position.set(car.x, 0, car.z);
      r.mesh.rotation.order = "YXZ";
      r.mesh.rotation.y = Math.PI / 2 - car.heading;
      r.mesh.rotation.x = -car.accelX * 0.004;
      r.mesh.rotation.z = car.accelY * 0.006;

      // wheels
      const wheels = r.mesh.userData.wheels;
      for (let i = 0; i < 4; i++) {
        wheels[i].children[0].rotation.x = car.wheelSpin;
        wheels[i].children[1].rotation.x = car.wheelSpin;
        if (i < 2) wheels[i].rotation.y = car.steer * 0.85;
      }

      // brake lights
      const braking = car._brakeLight;
      r.mesh.userData.tailMat.color.setHex(braking ? 0xff2010 : 0x550000);

      // drift smoke from rear wheels
      if (car.drifting && Math.abs(car.vx) > 4) {
        const c = Math.cos(car.heading), s = Math.sin(car.heading);
        for (const side of [-1, 1]) {
          const wx = car.x - c * car.cgToRear - (-s) * side * car.trackWidth / 2;
          const wz = car.z - s * car.cgToRear - c * side * car.trackWidth / 2;
          this.particles.smoke(wx, 0.15, wz, car.driftAmount);
        }
      }
      // nitro flames from exhaust
      if (car.nitroActive) {
        const c = Math.cos(car.heading), s = Math.sin(car.heading);
        const ex = car.x - c * 2.3, ez = car.z - s * 2.3;
        this.particles.nitroFlame(ex, 0.45, ez, -c, -s);
      }
    }

    // drift score UI bookkeeping
    const p = this.player;
    if (p && p.car.drifting) {
      this.driftScore += p.car.driftAmount * Math.abs(p.car.vx) * dt * 12;
      this.driftFade = 1.2;
    } else if (this.driftFade > 0) {
      this.driftFade -= dt;
      if (this.driftFade <= 0) this.driftScore = 0;
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  /* ---------- audio ---------- */
  _updateAudio() {
    const p = this.player;
    if (!p) return;
    const car = p.car;
    const rpmFrac = clampG((car.rpm - car.engine.idle) / (car.engine.redline - car.engine.idle), 0, 1);
    const input = this.state === STATES.RACING ? this._playerInput() : { throttle: 0 };
    const muted = this.state === STATES.PAUSED || this.state === STATES.MENU;
    this.audio.updateEngine(rpmFrac, input.throttle || 0, car.nitroActive, muted);
    const speedFrac = clampG(Math.abs(car.vx) / 55, 0, 1);
    this.audio.updateScreech(car.drifting ? car.driftAmount : 0, speedFrac);
  }

  /* ---------- camera ---------- */
  _updateCamera(dt) {
    const p = this.player;
    if (!p) {
      // menu orbit camera around track start
      const t = performance.now() / 1000;
      const s = this.track.samples[0];
      this.camera.position.set(s.pos.x + Math.cos(t * 0.1) * 60, 26, s.pos.z + Math.sin(t * 0.1) * 60);
      this.camera.lookAt(s.pos.x, 0, s.pos.z);
      this.sky.position.copy(this.camera.position);
      return;
    }
    const car = p.car;
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    let desired, look;

    if (this.cameraMode === 1) {
      // hood cam
      desired = new THREE.Vector3(car.x + c * 0.6, 1.15, car.z + s * 0.6);
      look = new THREE.Vector3(car.x + c * 30, 1.0, car.z + s * 30);
      this.camera.position.copy(desired);
    } else if (this.cameraMode === 2) {
      // far cinematic
      desired = new THREE.Vector3(car.x - c * 13, 5.5, car.z - s * 13);
      look = new THREE.Vector3(car.x + c * 8, 1, car.z + s * 8);
      const k = 1 - Math.exp(-dt * 3);
      this.camera.position.lerp(desired, k);
    } else {
      // chase cam (tight, NFS-style)
      const dist = 4.2 + Math.abs(car.vx) * 0.012;
      desired = new THREE.Vector3(car.x - c * dist, 1.75 + Math.abs(car.vx) * 0.005, car.z - s * dist);
      look = new THREE.Vector3(car.x + c * 6, 1.2, car.z + s * 6);
      const k = 1 - Math.exp(-dt * 6.5);
      this.camera.position.lerp(desired, k);
    }

    // collision shake
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.5;
    }
    this.camera.lookAt(look);

    // speed-sensitive FOV
    const targetFov = 62 + clampG(car.speedKmh, 0, 260) * 0.055 + (car.nitroActive ? 6 : 0);
    this.camera.fov = lerpG(this.camera.fov, targetFov, 1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();

    this.sky.position.copy(this.camera.position);
  }

  _updateSun() {
    const p = this.player;
    const cx = p ? p.car.x : 0, cz = p ? p.car.z : 0;
    this.sun.position.set(cx + 90, 130, cz + 50);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
  }

  /* ================= HUD ================= */
  _updateHUD(dt) {
    const p = this.player;
    if (!p) return;
    const car = p.car;

    document.getElementById("pos-current").textContent = this._playerPosition();
    document.getElementById("lap-current").textContent = clampG(Math.floor(p.distSamples / this.track.samples.length) + 1, 1, TOTAL_LAPS);
    document.getElementById("time-current").textContent = fmtTime(this.raceTime);
    document.getElementById("time-last").textContent = "LAST " + (this.lastLap ? fmtTime(this.lastLap) : "—");
    document.getElementById("time-best").textContent = "BEST " + (this.bestLap ? fmtTime(this.bestLap) : "—");
    document.getElementById("speed-value").textContent = Math.round(car.speedKmh);
    document.getElementById("gear-value").textContent = car.vx < -0.5 ? "R" : car.gear;
    document.getElementById("nitro-fill").style.width = (car.nitro * 100).toFixed(0) + "%";

    // drift score
    const driftEl = document.getElementById("drift-score");
    if (this.driftFade > 0 && this.driftScore > 20) {
      driftEl.classList.remove("hidden");
      document.getElementById("drift-value").textContent = Math.round(this.driftScore);
    } else {
      driftEl.classList.add("hidden");
    }

    // wrong way detection
    const idx = this.track.nearestIndex(car.x, car.z, p.hintIdx);
    const tan = this.track.samples[idx].tan;
    const v = car.worldVelocity();
    const dot = v.x * tan.x + v.z * tan.z;
    if (dot < -3 && this.state === STATES.RACING) this.wrongWayTimer += dt;
    else this.wrongWayTimer = 0;
    document.getElementById("wrong-way").classList.toggle("hidden", this.wrongWayTimer < 1.2);

    this._drawSpeedo(car);
    this._drawMinimap();
    this._drawRadar();
  }

  _drawSpeedo(car) {
    const ctx = this.speedoCtx;
    const W = 260, cx = W / 2, cy = W / 2, R = 112;
    ctx.clearRect(0, 0, W, W);

    // background
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.stroke();

    const maxKmh = 320;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;

    // redline zone
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0 + (a1 - a0) * (240 / maxKmh), a1);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(255,59,48,0.55)";
    ctx.stroke();

    // ticks
    ctx.lineWidth = 2;
    for (let kmh = 0; kmh <= maxKmh; kmh += 20) {
      const a = a0 + (a1 - a0) * (kmh / maxKmh);
      const major = kmh % 60 === 0;
      const r1 = R - (major ? 14 : 7);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.strokeStyle = major ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)";
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(kmh, cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26) + 3);
      }
    }

    // speed arc
    const frac = clampG(car.speedKmh / maxKmh, 0, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3, a0, a0 + (a1 - a0) * frac);
    ctx.lineWidth = 5;
    ctx.strokeStyle = car.nitroActive ? "#00d4ff" : "#ff3b30";
    ctx.stroke();

    // needle
    const na = a0 + (a1 - a0) * frac;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * 20, cy + Math.sin(na) * 20);
    ctx.lineTo(cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16));
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3b30";
    ctx.fill();
  }

  _buildMinimapPath() {
    // compute bounds & scale
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.track.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const W = 220, pad = 16;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (W - pad * 2) / (maxZ - minZ));
    this.mapScale = scale;
    this.mapOffX = pad - minX * scale + (W - pad * 2 - (maxX - minX) * scale) / 2;
    this.mapOffZ = pad - minZ * scale + (W - pad * 2 - (maxZ - minZ) * scale) / 2;
  }

  _mapX(x) { return this.mapOffX + x * this.mapScale; }
  _mapZ(z) { return this.mapOffZ + z * this.mapScale; }

  _drawMinimap() {
    const ctx = this.minimapCtx;
    const W = 220;
    ctx.clearRect(0, 0, W, W);

    // track path
    ctx.beginPath();
    for (let i = 0; i < this.track.samples.length; i += 6) {
      const s = this.track.samples[i];
      const x = this._mapX(s.pos.x), y = this._mapZ(s.pos.z);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.stroke();

    // start line
    const s0 = this.track.samples[0];
    ctx.fillStyle = "#fff";
    ctx.fillRect(this._mapX(s0.pos.x) - 3, this._mapZ(s0.pos.z) - 3, 6, 6);

    // cars
    for (const r of this.racers) {
      const x = this._mapX(r.car.x), y = this._mapZ(r.car.z);
      ctx.beginPath();
      ctx.arc(x, y, r.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#" + new THREE.Color(r.color).getHexString();
      ctx.fill();
      if (r.isPlayer) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
  }

  /* Rotating radar: local track view centered on the player, car-up
   * orientation (forward = up, matching the chase camera). */
  _drawRadar() {
    const ctx = this.radarCtx;
    if (!ctx || !this.player) return;
    const S = 190, C = S / 2;
    ctx.clearRect(0, 0, S, S);

    const car = this.player.car;
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const scale = 0.45;                       // px per meter (~210 m radius)
    const roadW = this.track.halfW * 2 * scale;

    // world → radar px; forward maps to up, screen-right stays right
    const toRadar = (wx, wz) => {
      const dx = wx - car.x, dz = wz - car.z;
      return {
        x: C + (-dx * s + dz * c) * scale,
        y: C - (dx * c + dz * s) * scale,
      };
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, 0, S, S);

    // track ribbon around the player (±samples along the spline)
    const N = this.track.samples.length;
    const idx = this.track.nearestIndex(car.x, car.z, this.player.hintIdx);
    const BEHIND = 28, AHEAD = 130;           // ~1.76 m per sample
    for (const pass of [[roadW + 5, "rgba(255,255,255,0.10)"], [roadW, "rgba(255,255,255,0.55)"]]) {
      ctx.beginPath();
      let first = true;
      for (let k = -BEHIND; k <= AHEAD; k += 2) {
        const sm = this.track.samples[(idx + k + N) % N];
        const pt = toRadar(sm.pos.x, sm.pos.z);
        if (first) { ctx.moveTo(pt.x, pt.y); first = false; } else ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineWidth = pass[0];
      ctx.strokeStyle = pass[1];
      ctx.stroke();
    }

    // start/finish tick when in range
    {
      const s0 = this.track.samples[0];
      const pt = toRadar(s0.pos.x, s0.pos.z);
      if ((pt.x - C) ** 2 + (pt.y - C) ** 2 < (C - 8) ** 2) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(pt.x - 2.5, pt.y - 2.5, 5, 5);
      }
    }

    // opponents
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const pt = toRadar(r.car.x, r.car.z);
      if ((pt.x - C) ** 2 + (pt.y - C) ** 2 > (C - 7) ** 2) continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#" + new THREE.Color(r.color).getHexString();
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.stroke();
    }
    ctx.restore();

    // fixed player arrow at center pointing up (travel direction)
    ctx.save();
    ctx.translate(C, C);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#" + new THREE.Color(this.player.color).getHexString();
    ctx.stroke();
    ctx.restore();

    // rim
    ctx.beginPath();
    ctx.arc(C, C, C - 3, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
  }

  /* ================= results ================= */
  _showResults() {
    const sorted = [...this.racers].sort((a, b) => {
      const af = a.finishTime !== null, bf = b.finishTime !== null;
      if (af && bf) return a.finishTime - b.finishTime;
      if (af) return -1;
      if (bf) return 1;
      return b.distSamples - a.distSamples;
    });
    const pos = sorted.findIndex(r => r.isPlayer) + 1;
    document.getElementById("results-title").textContent =
      pos === 1 ? "🏆 VICTORY!" : pos <= 3 ? `PODIUM — P${pos}` : `FINISHED — P${pos}`;

    const table = document.getElementById("results-table");
    table.innerHTML = "";
    sorted.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "result-row" + (r.isPlayer ? " player" : "");
      const time = r.finishTime !== null ? fmtTime(r.finishTime) : "DNF";
      row.innerHTML = `<span class="r-pos">${i + 1}</span><span class="r-name">${r.name}</span><span class="r-time">${time}</span>`;
      table.appendChild(row);
    });

    document.getElementById("hud").classList.add("hidden");
    this._showScreen("menu-results");
    this.audio.beep(pos === 1 ? 880 : 520, 0.4, 0.3);
  }
}

function fmtTime(t) {
  if (t === null || t === undefined) return "—";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
