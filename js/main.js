/* =====================================================================
 * main.js — Bootstrapping + menu UI wiring
 * ===================================================================== */
"use strict";

const game = new Game();

function $(id) { return document.getElementById(id); }

let carPreview = null;

function ensureCarPreview() {
  if (!carPreview) {
    const cv = $("car-preview");
    if (!cv) return null;
    try { carPreview = new CarPreview(cv); } catch (_) { return null; }
  }
  return carPreview;
}

function updateCarPreview() {
  const cp = ensureCarPreview();
  if (cp) cp.setSpec(CAR_SPECS[game.selectedCar]);
}

function buildCarSelect() {
  const grid = $("car-grid");
  grid.innerHTML = "";
  for (const key of Object.keys(CAR_SPECS)) {
    const spec = CAR_SPECS[key];
    const card = document.createElement("div");
    card.className = "car-card" + (key === game.selectedCar ? " selected" : "");
    card.dataset.key = key;
    const statBar = (label, v) =>
      `<div class="stat-row"><span class="stat-label">${label}</span><div class="stat-bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    card.innerHTML = `
      <div class="car-name">${spec.name}</div>
      <div class="car-class">${spec.cls}</div>
      ${statBar("SPEED", spec.stats.speed)}
      ${statBar("ACCEL", spec.stats.accel)}
      ${statBar("GRIP", spec.stats.grip)}
      ${statBar("NITRO", spec.stats.nitro)}
    `;
    card.addEventListener("click", () => {
      game.selectedCar = key;
      game.audio.init();
      game.audio.click();
      buildCarSelect();
      updateMenuFooter();
      updateCarPreview();
    });
    grid.appendChild(card);
  }
}

function updateMenuFooter() {
  $("menu-car-name").textContent = CAR_SPECS[game.selectedCar].name + " · " + CAR_SPECS[game.selectedCar].cls;
  const t = TRACKS[game.trackKey] || TRACKS.downtown;
  $("menu-track-name").textContent = t.name + " · " + t.meta.length + " · " + t.meta.elev;
}

function buildTrackSelect() {
  const grid = $("track-grid");
  grid.innerHTML = "";
  for (const key of Object.keys(TRACKS)) {
    const def = TRACKS[key];
    const card = document.createElement("div");
    card.className = "car-card" + (key === game.trackKey ? " selected" : "");
    card.dataset.key = key;
    card.innerHTML = `
      <div class="car-name">${def.name}</div>
      <div class="car-class">${def.desc}</div>
      <div class="track-meta">
        <span>${def.meta.length}</span>
        <span>elevation ${def.meta.elev}</span>
        <span>${def.meta.style}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      game.trackKey = key;
      // rebuild the world immediately so the menu orbit shows the new track
      game._buildTrack(key);
      game.audio.init();
      game.audio.click();
      buildTrackSelect();
      updateMenuFooter();
    });
    grid.appendChild(card);
  }
}

function wireButtons() {
  $("btn-start").addEventListener("click", () => { game.audio.init(); game.audio.click(); game.startRace(); });
  $("btn-car").addEventListener("click", () => {
    game.audio.init(); game.audio.click();
    buildCarSelect();
    game._showScreen("menu-car");
    updateCarPreview();
    const cp = ensureCarPreview();
    if (cp) cp.show();
  });
  $("btn-car-back").addEventListener("click", () => { game.audio.click(); if (carPreview) carPreview.hide(); game._showScreen("menu-main"); });
  $("btn-car-confirm").addEventListener("click", () => { game.audio.click(); if (carPreview) carPreview.hide(); game._showScreen("menu-main"); });
  $("btn-controls").addEventListener("click", () => { game.audio.init(); game.audio.click(); game._showScreen("menu-controls"); });

  $("btn-track").addEventListener("click", () => { game.audio.init(); game.audio.click(); buildTrackSelect(); game._showScreen("menu-track"); });
  $("btn-track-back").addEventListener("click", () => { game.audio.click(); game._showScreen("menu-main"); });
  $("btn-track-confirm").addEventListener("click", () => { game.audio.click(); game._showScreen("menu-main"); });
  $("btn-controls-back").addEventListener("click", () => { game.audio.click(); game._showScreen("menu-main"); });

  // auto-brake toggle (button mirrors the B hotkey)
  const abBtn = $("btn-autobrake");
  abBtn.addEventListener("click", () => {
    game.autoBrake = !game.autoBrake;
    $("autobrake-state").textContent = game.autoBrake ? "ON" : "OFF";
    abBtn.classList.toggle("on", game.autoBrake);
    game.audio.init();
    game.audio.click();
  });

  $("btn-resume").addEventListener("click", () => { game.audio.click(); game.resume(); });
  $("btn-restart").addEventListener("click", () => { game.audio.click(); game.restart(); });
  $("btn-quit").addEventListener("click", () => { game.audio.click(); game.toMenu(); });

  $("btn-again").addEventListener("click", () => { game.audio.click(); game.restart(); });
  $("btn-results-menu").addEventListener("click", () => { game.audio.click(); game.toMenu(); });
}

function setupTouch() {
  const ui = $("touch-ui");
  if (!ui) return;
  const isTouch = ("ontouchstart" in window) || ((typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0) > 0;
  if (!isTouch) return;

  ui.classList.remove("hidden");

  // multi-touch-safe press/release: each pointer is tracked by id
  const FLAGS = [
    ["tc-gas", "gas"], ["tc-brake", "brake"],
    ["tc-left-btn", "left"], ["tc-right-btn", "right"],
    ["tc-nitro", "nitro"], ["tc-handbrake", "handbrake"],
  ];
  const activePointers = new Map();   // pointerId -> flag
  for (const [id, flag] of FLAGS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      activePointers.set(e.pointerId, flag);
      game.touch[flag] = true;
      el.classList.add("pressed");
      game.audio.init();
    });
    const release = (e) => {
      if (activePointers.get(e.pointerId) !== flag) return;
      activePointers.delete(e.pointerId);
      game.touch[flag] = false;
      el.classList.remove("pressed");
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // chips: pause / reset-to-track
  $("tc-pause").addEventListener("click", () => {
    game.audio.click();
    if (game.state === STATES.PAUSED) game.resume(); else game.pause();
  });
  $("tc-reset").addEventListener("click", () => { game.audio.click(); game._resetPlayerToTrack(); });

  // block iOS pinch-zoom during play
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

window.addEventListener("DOMContentLoaded", () => {
  updateMenuFooter();
  wireButtons();
  setupTouch();
  game.init($("game-canvas"));
});
