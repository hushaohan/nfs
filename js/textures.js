/* textures.js — procedural canvas texture foundry.
 * Every surface in the game gets its look here; no external assets.
 * Each factory returns a fresh THREE.CanvasTexture ready to assign.    */
"use strict";

const TEX = (() => {

  function cv(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function finish(c, rx = 1, ry = 1) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }

  /* random speckle layer */
  function speckle(g, w, h, n, colors, sMax = 2.4, aMin = 0.25, aMax = 0.8) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = aMin + Math.random() * (aMax - aMin);
      g.fillStyle = colors[Math.random() * colors.length | 0];
      const s = 1 + Math.random() * sMax;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    g.globalAlpha = 1;
  }

  /* soft irregular blotches (patches of wear / vegetation / moisture) */
  function blotches(g, w, h, n, colors, rMin = 8, rMax = 42, alpha = 0.10) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = alpha * (0.5 + Math.random() * 0.8);
      g.fillStyle = colors[Math.random() * colors.length | 0];
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h,
        rMin + Math.random() * (rMax - rMin),
        rMin + Math.random() * (rMax - rMin),
        Math.random() * 3.14, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* thin dark crack polylines */
  function cracks(g, w, h, n, color = "rgba(20,20,22,0.5)") {
    g.strokeStyle = color;
    g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      const segs = 4 + Math.random() * 5 | 0;
      for (let s = 0; s < segs; s++) {
        x += (Math.random() - 0.5) * 34;
        y += (Math.random() - 0.5) * 34;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  const GROUNDS = {
    grass() {
      const c = cv(256, 256), g = c.getContext("2d");
      g.fillStyle = "#4d7a35"; g.fillRect(0, 0, 256, 256);
      blotches(g, 256, 256, 46, ["#3e6a2c", "#578a3d", "#61944a", "#446f2f"], 14, 52, 0.16);
      // grass blade strokes
      for (let i = 0; i < 2400; i++) {
        g.globalAlpha = 0.2 + Math.random() * 0.4;
        g.fillStyle = ["#5d9040", "#3c682b", "#699a49", "#49763a"][Math.random() * 4 | 0];
        g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1 + Math.random() * 2.5);
      }
      g.globalAlpha = 1;
      speckle(g, 256, 256, 500, ["#79a854", "#33591f"], 1.6, 0.15, 0.4);
      // rare tiny wildflowers
      for (let i = 0; i < 26; i++) {
        g.globalAlpha = 0.55;
        g.fillStyle = Math.random() < 0.5 ? "#e8e57a" : "#d9d9ef";
        g.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
      }
      g.globalAlpha = 1;
      return c;
    },

    rock() {
      const c = cv(256, 256), g = c.getContext("2d");
      g.fillStyle = "#7b7468"; g.fillRect(0, 0, 256, 256);
      blotches(g, 256, 256, 60, ["#6a6357", "#8b8478", "#5c564c", "#969082"], 10, 46, 0.14);
      cracks(g, 256, 256, 30, "rgba(40,38,34,0.4)");
      speckle(g, 256, 256, 900, ["#8f887a", "#57524a", "#a29a8a"], 2.2, 0.15, 0.5);
      return c;
    },

    sand() {
      const c = cv(256, 256), g = c.getContext("2d");
      g.fillStyle = "#cf9d61"; g.fillRect(0, 0, 256, 256);
      // wind ripples
      for (let y = 0; y < 256; y += 7) {
        g.globalAlpha = 0.10 + Math.random() * 0.08;
        g.fillStyle = y % 14 === 0 ? "#b9854e" : "#e0b276";
        g.fillRect(0, y + Math.random() * 3, 256, 2.5);
      }
      g.globalAlpha = 1;
      blotches(g, 256, 256, 26, ["#c08e50", "#dbab6e", "#b37f45"], 16, 50, 0.10);
      speckle(g, 256, 256, 800, ["#e3ba80", "#a9763f", "#8f6236"], 2, 0.2, 0.55);
      // sparse pebbles
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = 0.5;
        g.fillStyle = "#7c5a34";
        g.beginPath();
        g.arc(Math.random() * 256, Math.random() * 256, 0.8 + Math.random() * 1.6, 0, 6.28);
        g.fill();
      }
      g.globalAlpha = 1;
      return c;
    },

    snow() {
      const c = cv(256, 256), g = c.getContext("2d");
      g.fillStyle = "#e9eff7"; g.fillRect(0, 0, 256, 256);
      blotches(g, 256, 256, 40, ["#dbe5f2", "#f4f9ff", "#ccd9ea"], 18, 58, 0.20);
      // wind-carved micro dunes
      for (let y = 0; y < 256; y += 11) {
        g.globalAlpha = 0.07;
        g.fillStyle = "#c4d2e4";
        g.fillRect(0, y + Math.sin(y) * 4, 256, 3);
      }
      g.globalAlpha = 1;
      // sparkle
      for (let i = 0; i < 700; i++) {
        g.globalAlpha = 0.3 + Math.random() * 0.5;
        g.fillStyle = "#ffffff";
        g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
      }
      g.globalAlpha = 1;
      return c;
    },

    concrete() {
      const c = cv(256, 256), g = c.getContext("2d");
      g.fillStyle = "#676c73"; g.fillRect(0, 0, 256, 256);
      blotches(g, 256, 256, 34, ["#5d6269", "#71767e", "#585d64"], 12, 44, 0.13);
      // expansion joints
      g.strokeStyle = "rgba(30,32,36,0.55)";
      g.lineWidth = 2;
      for (let p = 0; p <= 256; p += 64) {
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.10)";
      g.lineWidth = 1;
      for (let p = 1; p <= 256; p += 64) {
        g.beginPath(); g.moveTo(p + 2, 0); g.lineTo(p + 2, 256); g.stroke();
      }
      cracks(g, 256, 256, 12, "rgba(25,27,30,0.4)");
      speckle(g, 256, 256, 600, ["#7c828a", "#4e5258"], 1.8, 0.15, 0.45);
      // oil stains
      blotches(g, 256, 256, 8, ["rgba(20,22,26,0.5)"], 6, 18, 0.35);
      return c;
    },
  };

  function ground(kind) {
    const gen = GROUNDS[kind] || GROUNDS.grass;
    return finish(gen());
  }

  /* asphalt grain only — lane markings are separate decal geometry so the
   * texture can tile across the road width without smearing */
  function asphalt() {
    const c = cv(256, 256), g = c.getContext("2d");
    g.fillStyle = "#26282c"; g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 3200, ["#33363b", "#1c1e21", "#3d4046", "#151619"], 2.2, 0.2, 0.7);
    // aggregate glints
    speckle(g, 256, 256, 260, ["#565b63", "#6a707a"], 1.2, 0.25, 0.5);
    // patch repairs
    blotches(g, 256, 256, 6, ["rgba(16,17,19,0.5)", "rgba(52,55,60,0.4)"], 8, 22, 0.5);
    cracks(g, 256, 256, 9, "rgba(12,13,15,0.55)");
    return finish(c);
  }

  /* jersey-wall concrete (barriers) */
  function wall() {
    const c = cv(128, 128), g = c.getContext("2d");
    g.fillStyle = "#8d939b"; g.fillRect(0, 0, 128, 128);
    blotches(g, 128, 128, 22, ["#7e848c", "#999fa8", "#71767e"], 6, 26, 0.16);
    speckle(g, 128, 128, 380, ["#a4aab2", "#5f646b"], 1.6, 0.15, 0.5);
    // scuff marks at traffic height
    g.globalAlpha = 0.25;
    g.fillStyle = "#3c3f44";
    g.fillRect(0, 74, 128, 14);
    g.globalAlpha = 1;
    cracks(g, 128, 128, 6, "rgba(40,42,46,0.45)");
    return finish(c, 2, 1);
  }

  /* building facade: doubles as diffuse + emissive (lit windows glow) */
  function facade(variant = 0) {
    const c = cv(128, 256), g = c.getContext("2d");
    const bases = ["#171b22", "#1a1620", "#121820"];
    g.fillStyle = bases[variant % 3]; g.fillRect(0, 0, 128, 256);
    const cols = 6, rows = 16;
    const cw = 128 / cols, rh = 256 / rows;
    const warm = ["#ffd9a0", "#fff3c8", "#ffc98a"];
    const cool = ["#9fd8ff", "#b0c8ff", "#8ef0e0"];
    for (let r = 0; r < rows; r++) {
      // occasional fully-dark service floor
      if ((r === 5 || r === 11) && Math.random() < 0.5) continue;
      for (let q = 0; q < cols; q++) {
        const wx = q * cw + 3, wy = r * rh + 3;
        const ww = cw - 6, wh = rh - 6;
        // glass base (slight sky reflection)
        g.fillStyle = variant === 2 ? "#202c3a" : "#242a33";
        g.fillRect(wx, wy, ww, wh);
        const roll = Math.random();
        if (roll < 0.34) {
          const pal = Math.random() < 0.6 ? warm : cool;
          g.fillStyle = pal[Math.random() * pal.length | 0];
          g.globalAlpha = 0.55 + Math.random() * 0.45;
          g.fillRect(wx, wy, ww, wh);
          g.globalAlpha = 1;
        } else if (roll < 0.42) {
          // half-lit room
          g.fillStyle = warm[0];
          g.globalAlpha = 0.35;
          g.fillRect(wx, wy, ww, wh / 2);
          g.globalAlpha = 1;
        }
        // curtain divider
        g.fillStyle = "rgba(0,0,0,0.5)";
        g.fillRect(wx + ww / 2 - 0.5, wy, 1, wh);
      }
    }
    // structural mullions
    g.fillStyle = "rgba(0,0,0,0.55)";
    for (let q = 0; q <= cols; q++) g.fillRect(q * cw - 1, 0, 2, 256);
    // ground-floor storefront band
    g.fillStyle = "#232a35";
    g.fillRect(0, 256 - rh * 1.4, 128, rh * 1.4);
    for (let q = 0; q < 4; q++) {
      g.fillStyle = Math.random() < 0.6 ? "#ffd9a0" : "#9fd8ff";
      g.globalAlpha = 0.8;
      g.fillRect(q * 32 + 6, 256 - rh + 4, 20, rh - 10);
      g.globalAlpha = 1;
    }
    return finish(c);
  }

  /* glowing billboard sign */
  function billboard(text, bg, fg) {
    const c = cv(256, 128), g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = fg; g.lineWidth = 5;
    g.strokeRect(7, 7, 242, 114);
    g.font = "italic 900 44px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = fg; g.shadowBlur = 18;
    g.fillStyle = fg;
    g.fillText(text, 128, 66);
    g.fillText(text, 128, 66);   // double-pass = stronger glow
    g.shadowBlur = 0;
    return finish(c);
  }

  /* corner chevron sign; dir +1 arrows point right, -1 left */
  function chevron(dir) {
    const c = cv(128, 128), g = c.getContext("2d");
    g.fillStyle = "#101216"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#e8e8e0"; g.lineWidth = 4;
    g.strokeRect(4, 4, 120, 120);
    g.strokeStyle = "#ffd21e";
    g.lineWidth = 13;
    g.lineJoin = "round"; g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const x0 = 26 + i * 34;
      g.beginPath();
      if (dir > 0) { g.moveTo(x0, 28); g.lineTo(x0 + 20, 64); g.lineTo(x0, 100); }
      else { g.moveTo(128 - x0, 28); g.lineTo(128 - x0 - 20, 64); g.lineTo(128 - x0, 100); }
      g.stroke();
    }
    return finish(c);
  }

  /* soft cloud blob sprite */
  function cloud() {
    const c = cv(128, 128), g = c.getContext("2d");
    for (let i = 0; i < 9; i++) {
      const x = 30 + Math.random() * 68, y = 44 + Math.random() * 40;
      const r = 16 + Math.random() * 26;
      const grd = g.createRadialGradient(x, y, 1, x, y, r);
      grd.addColorStop(0, "rgba(255,255,255,0.30)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  /* radial glow dot (lamp halos, beacons) */
  function glow() {
    const c = cv(64, 64), g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.28)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /* tree bark */
  function bark() {
    const c = cv(64, 128), g = c.getContext("2d");
    g.fillStyle = "#6b5138"; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = 0.15 + Math.random() * 0.2;
      g.fillStyle = Math.random() < 0.5 ? "#543e2a" : "#7d6045";
      const x = Math.random() * 64;
      g.fillRect(x, 0, 1 + Math.random() * 2.5, 128);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 8; i++) {
      g.globalAlpha = 0.4;
      g.fillStyle = "#4a3624";
      g.beginPath();
      g.arc(Math.random() * 64, Math.random() * 128, 1.5 + Math.random() * 2, 0, 6.28);
      g.fill();
    }
    g.globalAlpha = 1;
    return finish(c, 1, 2);
  }

  return { ground, asphalt, wall, facade, billboard, chevron, cloud, glow, bark };
})();
