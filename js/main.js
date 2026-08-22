/* =====================================================================
 * main.js — Bootstrapping + menu UI wiring
 * ===================================================================== */
"use strict";

const game = new Game();

function $(id) { return document.getElementById(id); }

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
    });
    grid.appendChild(card);
  }
}

function updateMenuFooter() {
  $("menu-car-name").textContent = CAR_SPECS[game.selectedCar].name + " · " + CAR_SPECS[game.selectedCar].cls;
}

function wireButtons() {
  $("btn-start").addEventListener("click", () => { game.audio.init(); game.audio.click(); game.startRace(); });
  $("btn-car").addEventListener("click", () => { game.audio.init(); game.audio.click(); buildCarSelect(); game._showScreen("menu-car"); });
  $("btn-controls").addEventListener("click", () => { game.audio.init(); game.audio.click(); game._showScreen("menu-controls"); });
  $("btn-car-back").addEventListener("click", () => { game.audio.click(); game._showScreen("menu-main"); });
  $("btn-car-confirm").addEventListener("click", () => { game.audio.click(); game._showScreen("menu-main"); });
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

window.addEventListener("DOMContentLoaded", () => {
  updateMenuFooter();
  wireButtons();
  game.init($("game-canvas"));
});
