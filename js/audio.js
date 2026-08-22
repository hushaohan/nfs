/* =====================================================================
 * audio.js — Procedural WebAudio sound engine (no asset files)
 *   • Engine: layered oscillators pitched by RPM + load
 *   • Tire screech: filtered noise when drifting
 *   • Impacts, nitro hiss, UI clicks, countdown beeps
 * ===================================================================== */
"use strict";

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineNodes = null;
    this.screechNodes = null;
    this.enabled = true;
    this._started = false;
  }

  /* must be called from a user gesture */
  init() {
    if (this._started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this._buildEngine();
    this._buildScreech();
    this._started = true;
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  /* ---------- engine sound ---------- */
  _buildEngine() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 1.2;
    gain.connect(lp); lp.connect(this.master);

    // saw = exhaust growl, square = intake, sub sine = low rumble
    const osc1 = ctx.createOscillator(); osc1.type = "sawtooth";
    const osc2 = ctx.createOscillator(); osc2.type = "square";
    const osc3 = ctx.createOscillator(); osc3.type = "sine";
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g3 = ctx.createGain(); g3.gain.value = 0.6;
    osc1.connect(g1); g1.connect(gain);
    osc2.connect(g2); g2.connect(gain);
    osc3.connect(g3); g3.connect(gain);
    osc1.start(); osc2.start(); osc3.start();

    this.engineNodes = { gain, lp, osc1, osc2, osc3 };
  }

  /* rpm 0..1, load 0..1, nitro bool */
  updateEngine(rpmFrac, load, nitro, muted) {
    if (!this._started || !this.enabled) return;
    const n = this.engineNodes;
    const t = this.ctx.currentTime;
    const base = 42 + rpmFrac * 190; // Hz
    n.osc1.frequency.setTargetAtTime(base, t, 0.03);
    n.osc2.frequency.setTargetAtTime(base * 2.02, t, 0.03);
    n.osc3.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    const vol = muted ? 0 : (0.05 + load * 0.16 + rpmFrac * 0.10 + (nitro ? 0.05 : 0));
    n.gain.gain.setTargetAtTime(vol, t, 0.05);
    n.lp.frequency.setTargetAtTime(500 + rpmFrac * 2600 + load * 900, t, 0.05);
  }

  /* ---------- tire screech ---------- */
  _buildScreech() {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 3.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(bp); bp.connect(gain); gain.connect(this.master);
    src.start();
    this.screechNodes = { src, bp, gain };
  }

  updateScreech(amount, speedFrac) {
    if (!this._started || !this.enabled) return;
    const s = this.screechNodes;
    const t = this.ctx.currentTime;
    const vol = clamp01(amount) * 0.16 * (0.3 + speedFrac);
    s.gain.gain.setTargetAtTime(vol, t, 0.06);
    s.bp.frequency.setTargetAtTime(1800 + speedFrac * 1600 + Math.sin(t * 30) * 200, t, 0.05);
  }

  /* ---------- one-shots ---------- */
  impact(strength) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(clamp01(strength) * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.25);

    // noise burst
    const len = ctx.sampleRate * 0.12;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const ng = ctx.createGain(); ng.gain.value = clamp01(strength) * 0.3;
    src.connect(ng); ng.connect(this.master);
    src.start(t);
  }

  beep(freq, dur, vol = 0.3) {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square"; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  click() { this.beep(700, 0.06, 0.12); }

  nitroBurst() {
    if (!this._started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.value = 0.22;
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
