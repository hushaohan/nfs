/* =====================================================================
 * audio.js — Procedural WebAudio sound engine (no asset files)
 *   • Engine: detuned saw pair + intake square + sub sine + exhaust
 *     noise, all through a load-driven waveshaper grit and RPM-tracked
 *     lowpass; idle lope wobble; automatic upshift blips
 *   • Tire screech: dual-band squeal + low-speed grind, wobbling,
 *     gently panning; plus wind/road rush scaling with speed
 *   • Impacts with metallic clang, nitro sweep, soft UI ticks,
 *     blended beeps — all glued by a master compressor
 * ===================================================================== */
"use strict";

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineNodes = null;
    this.screechNodes = null;
    this.windNodes = null;
    this.enabled = true;
    this._started = false;
    this._lastRpm = 0;
    this._noiseBuf = null;
  }

  /* must be called from a user gesture */
  init() {
    if (this._started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();

    // master bus -> compressor (glues layers, tames stacked peaks)
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // shared looping white-noise buffer (screech / wind / exhaust / bursts)
    const len = Math.floor(this.ctx.sampleRate * 1.5);
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildScreech();
    this._buildWind();
    this._started = true;
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    return src;
  }

  /* ---------- engine sound ---------- */
  _buildEngine() {
    const ctx = this.ctx;

    // pre-dist drive -> soft-clip waveshaper -> tone -> level
    const drive = ctx.createGain(); drive.gain.value = 0.9;
    const shaper = ctx.createWaveShaper();
    {
      const n = 256, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(2.6 * x);
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
    }
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 1.1;
    const out = ctx.createGain(); out.gain.value = 0;
    drive.connect(shaper); shaper.connect(lp); lp.connect(out); out.connect(this.master);

    // saw pair, slightly detuned -> thick beating core
    const mkSaw = (detune) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth"; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = 0.34;
      o.connect(g); g.connect(drive); o.start();
      return o;
    };
    const osc1 = mkSaw(-5);
    const osc1b = mkSaw(7);
    // intake honk
    const osc2 = ctx.createOscillator(); osc2.type = "square";
    const g2 = ctx.createGain(); g2.gain.value = 0.13;
    osc2.connect(g2); g2.connect(drive); osc2.start();
    // sub rumble (kept clean, outside the shaper)
    const osc3 = ctx.createOscillator(); osc3.type = "sine";
    const g3 = ctx.createGain(); g3.gain.value = 0.42;
    osc3.connect(g3); g3.connect(out); osc3.start();
    // exhaust rasp: bandpassed noise following rpm
    const rNoise = this._noiseSource();
    const rBp = ctx.createBiquadFilter();
    rBp.type = "bandpass"; rBp.frequency.value = 800; rBp.Q.value = 0.9;
    const rGain = ctx.createGain(); rGain.gain.value = 0.05;
    rNoise.connect(rBp); rBp.connect(rGain); rGain.connect(drive); rNoise.start();
    // idle lope: slow wobble on the primary saw's detune
    const lfo = ctx.createOscillator(); lfo.frequency.value = 10.5;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 8;   // cents
    lfo.connect(lfoAmt); lfoAmt.connect(osc1.detune); lfo.start();

    this.engineNodes = { out, lp, drive, osc1, osc1b, osc2, osc3, rBp, rGain };
  }

  /* rpm 0..1, load 0..1, nitro bool */
  updateEngine(rpmFrac, load, nitro, muted) {
    if (!this._started || !this.enabled) return;
    const n = this.engineNodes;
    const t = this.ctx.currentTime;

    // automatic upshift blip: rpm was near redline and just fell hard
    if (this._lastRpm > 0.66 && this._lastRpm - rpmFrac > 0.26 && !muted) {
      this._shiftBlip();
    }
    this._lastRpm = rpmFrac;

    const base = 40 + rpmFrac * 196;          // Hz
    n.osc1.frequency.setTargetAtTime(base, t, 0.03);
    n.osc1b.frequency.setTargetAtTime(base, t, 0.03);
    n.osc2.frequency.setTargetAtTime(base * 2.02, t, 0.03);
    n.osc3.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    n.rBp.frequency.setTargetAtTime(420 + rpmFrac * 1500, t, 0.05);
    n.rGain.gain.setTargetAtTime(0.03 + rpmFrac * 0.05 + load * 0.05, t, 0.06);

    // throttle opens the grit and brightens the tone
    n.drive.gain.setTargetAtTime(0.75 + load * 1.5 + (nitro ? 0.5 : 0), t, 0.06);
    n.lp.frequency.setTargetAtTime(430 + rpmFrac * 2700 + load * 1000 + (nitro ? 600 : 0), t, 0.05);

    const vol = muted ? 0 : (0.05 + load * 0.14 + rpmFrac * 0.09 + (nitro ? 0.05 : 0));
    n.out.gain.setTargetAtTime(vol, t, 0.05);
  }

  /* short exhaust pop on upshifts */
  _shiftBlip() {
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dd = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1600;
    const g = ctx.createGain(); g.gain.value = 0.10;
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t);
  }

  /* ---------- tire screech + wind ---------- */
  _buildScreech() {
    const ctx = this.ctx;
    const squeal = this._noiseSource();
    const bp1 = ctx.createBiquadFilter();
    bp1.type = "bandpass"; bp1.frequency.value = 2300; bp1.Q.value = 4.5;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = "bandpass"; bp2.frequency.value = 3100; bp2.Q.value = 6;
    const sMix = ctx.createGain(); sMix.gain.value = 0;
    squeal.connect(bp1); bp1.connect(sMix);
    squeal.connect(bp2); bp2.connect(sMix);
    // slow pan drift so it moves around your head
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { sMix.connect(pan); pan.connect(this.master); }
    else sMix.connect(this.master);
    // frequency wobble = rubber flexing
    const lfo = ctx.createOscillator(); lfo.frequency.value = 3.1;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 240;
    lfo.connect(lfoAmt); lfoAmt.connect(bp1.frequency); lfo.start();
    squeal.start();

    // under-layer: low grind when sliding at lower speeds
    const grind = this._noiseSource();
    const glp = ctx.createBiquadFilter();
    glp.type = "lowpass"; glp.frequency.value = 360;
    const gGain = ctx.createGain(); gGain.gain.value = 0;
    grind.connect(glp); glp.connect(gGain); gGain.connect(this.master);
    grind.start();

    this.screechNodes = { bp1, sMix, pan, gGain };
  }

  _buildWind() {
    const ctx = this.ctx;
    const wind = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.4;
    const gain = ctx.createGain(); gain.gain.value = 0;
    wind.connect(lp); lp.connect(gain); gain.connect(this.master);
    wind.start();
    this.windNodes = { lp, gain };
  }

  updateScreech(amount, speedFrac) {
    if (!this._started || !this.enabled) return;
    const s = this.screechNodes;
    const w = this.windNodes;
    const t = this.ctx.currentTime;
    const a = clamp01(amount);

    const vol = a * 0.17 * (0.25 + speedFrac);
    s.sMix.gain.setTargetAtTime(vol, t, 0.055);
    s.bp1.frequency.setTargetAtTime(1900 + speedFrac * 1500, t, 0.06);
    if (s.pan) s.pan.pan.setTargetAtTime(Math.sin(t * 0.7) * 0.3, t, 0.2);
    s.gGain.gain.setTargetAtTime(a * 0.09 * (1.1 - speedFrac * 0.6), t, 0.07);

    // wind/road rush builds with the square of speed
    w.gain.gain.setTargetAtTime(speedFrac * speedFrac * 0.13, t, 0.12);
    w.lp.frequency.setTargetAtTime(320 + speedFrac * 720, t, 0.15);
  }

  /* ---------- one-shots ---------- */
  impact(strength) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = clamp01(strength);

    // body thud: pitched-down triangle
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(k * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.25);

    // metallic clang ring
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.setValueAtTime(720 + Math.random() * 240, t);
    o2.frequency.exponentialRampToValueAtTime(480, t + 0.1);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(k * 0.16, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o2.connect(g2); g2.connect(this.master);
    o2.start(t); o2.stop(t + 0.15);

    // crunch burst
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const ng = ctx.createGain(); ng.gain.value = k * 0.3;
    src.connect(ng); ng.connect(this.master);
    src.start(t);
  }

  beep(freq, dur, vol = 0.3) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // triangle body + sine octave = rounder, less harsh than raw square
    const o = ctx.createOscillator();
    o.type = "triangle"; o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "sine"; o2.frequency.value = freq * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    o2.start(t); o2.stop(t + dur + 0.02);
  }

  click() {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square"; o.frequency.value = 1350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.05);
    const o2 = ctx.createOscillator();
    o2.type = "sine"; o2.frequency.value = 880;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.05, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o2.connect(g2); g2.connect(this.master);
    o2.start(t); o2.stop(t + 0.08);
  }

  nitroBurst() {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // pressurized hiss sweeping upward
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2900, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.5);
    // low thrust whoosh
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(820, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.09, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.35);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
