import { Universe } from "./universe.js";
import { AudioEngine } from "./audio.js";
import { BODY_TYPES, getSurface } from "./textures.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

const TRIALS = [
  {
    title: "First Light",
    desc: "Seed a new world into the Helios system.",
    hint: "Open WORLD and deploy any class",
    reward: 120,
    test: (e) => e.kind === "deploy",
  },
  {
    title: "Goldilocks",
    desc: "Place a terrestrial world inside the habitable ring.",
    hint: "A terrestrial orbit of 1.9–2.7 AU",
    reward: 180,
    test: (e) =>
      e.kind === "deploy" &&
      e.body.def.kind === "terrestrial" &&
      e.body.orbitRadius >= 15.8 &&
      e.body.orbitRadius <= 22.5,
  },
  {
    title: "Ring Bearer",
    desc: "Raise a ringed gas giant beyond the frost line.",
    hint: "Jovian class, orbit beyond 3.4 AU",
    reward: 260,
    test: (e) => e.kind === "deploy" && e.body.type === "gas" && e.body.orbitRadius > 27,
  },
  {
    title: "Lunar Tether",
    desc: "Bind a moon to one of your worlds.",
    hint: "Select a world, then tap ADD MOON",
    reward: 320,
    test: (e) => e.kind === "moon",
  },
  {
    title: "Collision Course",
    desc: "Drive a comet into a world and let gravity take it.",
    hint: "Select a target, then launch a comet",
    reward: 500,
    test: (e) => e.kind === "collision" && (e.a?.isComet || e.b?.isComet),
  },
];

const state = {
  score: 0,
  trialIndex: 0,
  completed: 0,
  transitioning: false,
  finished: false,
  forgeOpen: false,
  forgeType: "terra",
  forgeRadius: 22,
  selectedId: null,
  selectedInfo: null,
  lastSnapshot: null,
  lastTrialAt: -99999,
  lastHintAt: -99999,
  pauseBeforeModal: null,
  resetArmedUntil: 0,
  currentModal: null,
  hintTimer: null,
  pausedByModal: false,
};

const audio = new AudioEngine();

const universe = new Universe($("scene"), {
  onSelect: handleSelect,
  onEvent: handleUniverseEvent,
  onFrame: updateFrame,
  onCameraInteract: hideControlsHint,
  onFocus: (info) => {
    if (info) showToast("TARGET LOCKED", `Tracking ${info.name}. Pinch or scroll to adjust range.`, "", "◎");
  },
});

const labelLayer = $("labels");
const labelMap = new Map();
const bodyCards = Array.from(document.querySelectorAll(".body-card"));
const orbByType = {};
for (const card of bodyCards) {
  orbByType[card.dataset.type] = card.querySelector(".body-orb");
}

/* ── Initial chrome ─────────────────────────────────────── */

const dots = [];
for (let i = 0; i < TRIALS.length; i++) {
  const dot = document.createElement("i");
  $("mission-dots").appendChild(dot);
  dots.push(dot);
}

const signalBars = [];
for (let i = 0; i < 15; i++) {
  const bar = document.createElement("i");
  $("signal-bars").appendChild(bar);
  signalBars.push(bar);
}
const animateSignal = () => {
  signalBars.forEach((bar, i) => {
    const h = 18 + Math.abs(Math.sin(performance.now() * 0.0012 + i * 1.31)) * 72;
    bar.style.height = `${h}%`;
    bar.style.opacity = String(0.2 + h / 150);
  });
  setTimeout(animateSignal, 620);
};
animateSignal();

updateTrialUI();
updateScore();
initForge();
setupEvents();
document.documentElement.dataset.ready = "ready";
setTimeout(() => $("intro-veil")?.remove(), 1000);
setTimeout(prewarmPreviews, 350);
setTimeout(() => {
  if (!state.selectedId && !state.forgeOpen && !state.currentModal && !state.transitioning && window.innerWidth > 760) {
    const featured = universe.worlds.find((w) => w.name === "Pelagos") || universe.worlds[0];
    if (featured) universe.select(featured);
  }
}, 1500);
if (window.innerWidth <= 760) {
  $("controls-hint-text").textContent = "Drag to orbit · Pinch to zoom · Tap a world";
}

const welcomeTimer = setTimeout(() => hideControlsHint(), 9000);
window.addEventListener("beforeunload", () => clearTimeout(welcomeTimer));

/* ── UI events ──────────────────────────────────────────── */

function setupEvents() {
  $("add-btn").addEventListener("click", () => openForge());
  $("forge-close").addEventListener("click", closeForge);
  $("deploy-btn").addEventListener("click", deployFromForge);
  $("orbit-slider").addEventListener("input", () => {
    state.forgeRadius = parseFloat($("orbit-slider").value);
    updateOrbitUI();
    universe.setGhost(state.forgeType, state.forgeRadius);
  });
  bodyCards.forEach((card) => {
    card.addEventListener("click", () => {
      state.forgeType = card.dataset.type;
      bodyCards.forEach((c) => c.classList.toggle("selected", c === card));
      updateOrbitUI();
      universe.setGhost(state.forgeType, state.forgeRadius);
      audio.select();
    });
  });

  $("comet-btn").addEventListener("click", launchComet);
  $("moon-btn").addEventListener("click", addMoon);
  $("focus-btn").addEventListener("click", focusSelected);
  $("focus-body-btn").addEventListener("click", focusSelected);
  $("add-moon-btn").addEventListener("click", addMoon);
  $("boost-btn").addEventListener("click", boostSelected);
  $("delete-body-btn").addEventListener("click", deleteSelected);
  $("selected-close").addEventListener("click", () => universe.deselect());
  $("home-btn").addEventListener("click", () => {
    universe.exitFocus();
    hideControlsHint();
    audio.blip(520, 0.07, "sine", 0.025);
  });
  $("hint-close").addEventListener("click", hideControlsHint);

  $("pause-btn").addEventListener("click", togglePause);
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTimeScale(parseFloat(btn.dataset.speed)));
  });

  $("sound-btn").addEventListener("click", () => {
    audio.init();
    audio.setEnabled(!audio.enabled);
    $("sound-btn").classList.toggle("muted", !audio.enabled);
    $("sound-btn").setAttribute("aria-label", audio.enabled ? "Mute sound" : "Enable sound");
    audio.blip(660, 0.06, "sine", 0.03);
  });

  $("help-btn").addEventListener("click", () => openModal($("help-modal")));
  $("help-close").addEventListener("click", closeModal);
  $("help-got-it").addEventListener("click", closeModal);
  $("keep-exploring-btn").addEventListener("click", closeModal);
  $("new-system-btn").addEventListener("click", () => resetSystem());
  $("reset-btn").addEventListener("click", armReset);

  document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", () => audio.init(), { once: true, passive: true });

  window.addEventListener("resize", () => {
    if (window.innerWidth <= 760) {
      $("controls-hint-text").textContent = "Drag to orbit · Pinch to zoom · Tap a world";
    } else {
      $("controls-hint-text").textContent = "Drag to orbit · Scroll to zoom · Tap a world";
    }
  });

  // Surface click on canvas hides the hint once the player is exploring.
  $("scene").addEventListener("pointerdown", () => hideControlsHint(1200), { passive: true });
  document.querySelectorAll(".tool, .icon-btn, .action-btn").forEach((el) => {
    el.addEventListener("pointerenter", () => audio.blip(1100, 0.025, "sine", 0.008));
  });
}

function onKeyDown(e) {
  if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key === "Escape") {
    if (state.currentModal) closeModal();
    else if (state.forgeOpen) closeForge();
    else universe.deselect();
    return;
  }
  if (state.currentModal) return;
  const key = e.key.toLowerCase();
  if (key === "w") { e.preventDefault(); openForge(); }
  else if (key === "c") launchComet();
  else if (key === "m") addMoon();
  else if (key === "f") focusSelected();
  else if (key === "r") armReset();
  else if (key === "h") openModal($("help-modal"));
  else if (e.code === "Space") { e.preventDefault(); togglePause(); }
  else if (e.key === "1") setTimeScale(1);
  else if (e.key === "2") setTimeScale(2);
  else if (e.key === "3" || e.key === "4") setTimeScale(4);
}

/* ── Trials ─────────────────────────────────────────────── */

function updateTrialUI(animate = false) {
  if (state.trialIndex >= TRIALS.length) {
    $("trial-number").textContent = "05";
    $("trial-title").textContent = "The Orrery Lives";
    $("trial-desc").textContent = "The system is online. Keep shaping worlds, smashing comets, and watching gravity write new stories.";
    $("trial-hint").textContent = "Free sandbox";
    $("trial-reward").textContent = "ONLINE";
    $("mission-progress").style.width = "100%";
    dots.forEach((d) => { d.className = "done"; });
    $("mission-panel").classList.add("completed");
    return;
  }
  const trial = TRIALS[state.trialIndex];
  if (animate) {
    const title = $("trial-title");
    title.classList.remove("changing");
    void title.offsetWidth;
    title.classList.add("changing");
  }
  $("trial-number").textContent = String(state.trialIndex + 1).padStart(2, "0");
  $("trial-title").textContent = trial.title;
  $("trial-desc").textContent = trial.desc;
  $("trial-hint").textContent = trial.hint;
  $("trial-reward").textContent = `+${trial.reward}`;
  $("mission-progress").style.width = `${(state.trialIndex / TRIALS.length) * 88 + 8}%`;
  dots.forEach((d, i) => {
    d.className = i < state.trialIndex ? "done" : i === state.trialIndex ? "current" : "";
  });
}

function checkTrial(event) {
  if (state.transitioning || state.trialIndex >= TRIALS.length) return false;
  const trial = TRIALS[state.trialIndex];
  if (trial.test(event)) {
    completeTrial();
    return true;
  }
  if (event.kind === "deploy" && performance.now() - state.lastHintAt > 7000) {
    state.lastHintAt = performance.now();
    setTimeout(() => {
      if (state.trialIndex < TRIALS.length && !state.transitioning) {
        showToast("TRIAL HINT", trial.hint, "warn", "✦");
      }
    }, 600);
  }
  return false;
}

function completeTrial() {
  if (state.transitioning) return;
  const trial = TRIALS[state.trialIndex];
  state.transitioning = true;
  state.score += trial.reward;
  state.completed++;
  state.lastTrialAt = performance.now();
  updateScore(true);
  audio.complete();
  $("mission-panel").classList.add("completed");
  showToast(
    `TRIAL ${String(state.trialIndex + 1).padStart(2, "0")} COMPLETE`,
    `${trial.title} · +${trial.reward} stardust`,
    "success",
    "✓",
    4200
  );
  burstAtCameraEdge();
  setTimeout(() => {
    $("mission-panel").classList.remove("completed");
    state.trialIndex++;
    state.transitioning = false;
    if (state.trialIndex >= TRIALS.length) {
      updateTrialUI();
      setTimeout(showCompletion, 900);
    } else {
      updateTrialUI(true);
      if (state.trialIndex === 1) state.forgeRadius = 21;
      if (state.trialIndex === 2) { state.forgeType = "gas"; state.forgeRadius = 35; }
    }
  }, 1200);
}

function showCompletion() {
  state.finished = true;
  $("final-score").textContent = state.score.toLocaleString("en-US");
  $("final-worlds").textContent = String(universe.worlds.length).padStart(2, "0");
  openModal($("completion-modal"), true);
  audio.complete();
}

/* ── Universe events ────────────────────────────────────── */

function handleUniverseEvent(event) {
  if (event.kind === "deploy") {
    const body = event.body;
    if (performance.now() - state.lastTrialAt > 260) {
      showToast("WORLD DEPLOYED", `${body.name} entered a stable orbit. Follow it, perturb it, or use it as a moon anchor.`, "", "◉");
    }
    checkTrial(event);
  } else if (event.kind === "moon") {
    showToast("MOON BOUND", `${event.body.name} is now orbiting ${event.parent.name}.`, "", "☾");
    checkTrial(event);
  } else if (event.kind === "comet") {
    const targetText = event.target ? `Target locked: ${event.target.name}.` : "Trajectory: outer system.";
    showToast("COMET INBOUND", `${event.body.name} is falling toward the light. ${targetText}`, "", "☄", 4500);
    audio.whoosh();
  } else if (event.kind === "collision") {
    const names = [event.a?.name, event.b?.name].filter(Boolean).join(" × ");
    showToast("IMPACT DETECTED", `${names} merged in a flash of heat and debris.`, "warn", "✹", 4200);
    audio.impact();
    checkTrial(event);
  } else if (event.kind === "star") {
    showToast("STELLAR CONSUMPTION", `${event.body.name} crossed the photosphere and became part of Helios.`, "warn", "☀", 4200);
    audio.impact();
  } else if (event.kind === "boost") {
    audio.blip(430, 0.12, "triangle", 0.03);
  } else if (event.kind === "remove" && !event.silent && performance.now() - state.lastTrialAt > 250) {
    showToast("WORLD REMOVED", `${event.body.name} has been erased from the simulation.`, "", "×");
  }
}

/* ── Frame updates ──────────────────────────────────────── */

function updateFrame(snap) {
  state.lastSnapshot = snap;
  const clock = formatClock(snap.simTime);
  if ($("sim-clock").textContent !== clock) $("sim-clock").textContent = clock;

  const worlds = String(snap.worlds).padStart(2, "0");
  if ($("world-count").textContent !== worlds) $("world-count").textContent = worlds;
  const moons = String(snap.moons).padStart(2, "0");
  if ($("moon-count").textContent !== moons) $("moon-count").textContent = moons;
  const stability = snap.stability;
  const stabilityEl = $("stability");
  if (stabilityEl.dataset.value !== String(stability)) {
    stabilityEl.dataset.value = String(stability);
    stabilityEl.innerHTML = `${stability}<span>%</span>`;
  }

  updateLabels(snap);
  updateSelectedReadout(snap);
  updateHabitableTag(snap);
}

function formatClock(seconds) {
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600) % 100;
  const m = Math.floor(t / 60) % 60;
  const s = t % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function updateLabels(snap) {
  const active = new Set();
  for (const body of snap.bodies) {
    if (body.isMoon && body.id !== state.selectedId) continue;
    active.add(body.id);
    let el = labelMap.get(body.id);
    if (!el) {
      el = document.createElement("div");
      el.className = `body-label${body.isStar ? " star-label" : ""}`;
      const dot = document.createElement("span");
      dot.className = "label-dot";
      const name = document.createElement("span");
      name.className = "label-name";
      name.textContent = body.name.toUpperCase();
      const type = document.createElement("span");
      type.className = "label-type";
      type.textContent = body.isStar ? "STAR" : body.isMoon ? "MOON" : body.isComet ? "COMET" : body.className;
      el.append(dot, name, type);
      labelLayer.appendChild(el);
      labelMap.set(body.id, el);
    }
    if (!body.screen.visible) {
      el.style.display = "none";
      continue;
    }
    const x = body.screen.x;
    const y = body.screen.y;
    const margin = 50;
    if (x < -margin || x > window.innerWidth + margin || y < -40 || y > window.innerHeight + margin) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "flex";
    const baseOffset = body.isStar ? 56 : body.isMoon ? 11 : Math.min(48, 10 + body.radius * 8);
    el.style.transform = `translate3d(${x}px, ${y - baseOffset}px, 0) translate(-50%, -100%)`;
    el.classList.toggle("selected", body.id === state.selectedId);
  }
  for (const [id, el] of labelMap) {
    if (!active.has(id)) {
      el.remove();
      labelMap.delete(id);
    }
  }
}

function updateSelectedReadout(snap) {
  const card = $("selected-card");
  if (card.classList.contains("hidden")) return;
  const info = snap.selected;
  if (!info) return;
  setText("selected-orbit", info.orbit);
  setText("selected-mass", info.mass);
  setText("selected-velocity", info.velocity);
  setText("selected-period", info.period);
}

function updateHabitableTag(snap) {
  const tag = $("habitable-tag");
  if (!state.forgeOpen) {
    tag.classList.add("hidden");
    return;
  }
  const p = snap.habitable;
  if (!p.visible) {
    tag.classList.add("hidden");
    return;
  }
  tag.classList.remove("hidden");
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y}px`;
}

function setText(id, value) {
  const el = $(id);
  if (el && el.textContent !== value) el.textContent = value;
}

/* ── Selection ──────────────────────────────────────────── */

function handleSelect(info) {
  state.selectedInfo = info;
  state.selectedId = info?.id || null;
  const card = $("selected-card");
  if (!info) {
    card.classList.add("hidden");
    updateToolStates();
    return;
  }
  card.classList.remove("hidden");
  hideControlsHint();
  $("selected-kind").textContent = info.isStar
    ? "SYSTEM STAR"
    : info.isMoon
      ? "SELECTED MOON"
      : info.isComet
        ? "INBOUND COMET"
        : "SELECTED WORLD";
  $("selected-name").textContent = info.name;
  $("selected-class").textContent = info.isStar ? "G2V" : info.className;
  $("selected-class").style.color = info.color || "var(--mint)";
  $("selected-class").style.borderColor = info.color ? hexA(info.color, 0.34) : "";
  $("selected-orbit").textContent = info.orbit;
  $("selected-mass").textContent = info.mass;
  $("selected-velocity").textContent = info.velocity;
  $("selected-period").textContent = info.period;
  $("selected-actions").style.display = info.isStar ? "none" : "flex";
  $("add-moon-btn").style.display = info.isStar || info.isMoon || info.isComet ? "none" : "flex";
  updateToolStates();
  if (performance.now() - state.lastTrialAt > 200) audio.select();
}

function updateToolStates() {
  const info = state.selectedInfo;
  const canBeParent = !!info && !info.isStar && !info.isMoon && !info.isComet;
  const hasSelection = !!info;
  $("moon-btn").disabled = !canBeParent;
  $("focus-btn").disabled = !hasSelection;
  $("focus-body-btn").disabled = !hasSelection;
  $("add-moon-btn").disabled = !canBeParent;
  $("boost-btn").disabled = !hasSelection || info?.isStar;
  $("delete-body-btn").disabled = !hasSelection || info?.isStar;
}

/* ── Forge ──────────────────────────────────────────────── */

function initForge() {
  $("orbit-slider").value = String(state.forgeRadius);
  updateForgeCardSelection();
  updateOrbitUI();
}

function openForge() {
  if (state.forgeOpen) return;
  if (state.currentModal) closeModal();
  if (state.trialIndex === 1 && !state.transitioning) {
    state.forgeRadius = 21;
    if (!["terra", "ocean", "desert", "ice"].includes(state.forgeType)) state.forgeType = "terra";
  }
  if (state.trialIndex === 2) {
    state.forgeType = "gas";
    state.forgeRadius = 35;
  }
  state.forgeOpen = true;
  document.body.classList.add("forge-open");
  $("forge-sheet").classList.add("open");
  $("forge-sheet").setAttribute("aria-hidden", "false");
  $("orbit-slider").value = String(state.forgeRadius);
  updateForgeCardSelection();
  updateOrbitUI();
  universe.setGhost(state.forgeType, state.forgeRadius);
  hideControlsHint();
  audio.blip(290, 0.12, "sine", 0.035);
}

function closeForge() {
  if (!state.forgeOpen) return;
  state.forgeOpen = false;
  document.body.classList.remove("forge-open");
  $("forge-sheet").classList.remove("open");
  $("forge-sheet").setAttribute("aria-hidden", "true");
  universe.hideGhost();
  $("habitable-tag").classList.add("hidden");
  audio.blip(240, 0.07, "sine", 0.02);
}

function updateForgeCardSelection() {
  bodyCards.forEach((card) => card.classList.toggle("selected", card.dataset.type === state.forgeType));
}

function updateOrbitUI() {
  const r = state.forgeRadius;
  const au = (r / 8.2).toFixed(2);
  $("orbit-value").textContent = `${au} AU`;
  const def = BODY_TYPES[state.forgeType];
  $("forge-mass").textContent = `${(def.mass * 0.68).toFixed(1)} M⊕`;
  const badge = $("zone-badge");
  const note = $("orbit-note");
  badge.classList.remove("hot", "cold");
  if (r < 15.8) {
    badge.textContent = "SCORCHED";
    badge.classList.add("hot");
    note.textContent = "Too close. The star's heat strips atmospheres and boils oceans.";
  } else if (r <= 22.5) {
    badge.textContent = "GOLDILOCKS";
    note.textContent = "A temperate orbit. Liquid water is possible here.";
  } else {
    badge.textContent = "FROST LINE";
    badge.classList.add("cold");
    note.textContent = "Cold and distant. Ice worlds and gas giants thrive out here.";
  }
  const typeNote = def.kind === "gas"
    ? " A gas giant will form a broad ring system."
    : def.kind === "terrestrial"
      ? " A solid world with a stable, circular insertion."
      : "";
  note.textContent += typeNote;
}

function deployFromForge() {
  const body = universe.addWorld(state.forgeType, state.forgeRadius);
  closeForge();
  universe.select(body);
  audio.deploy();
  if (performance.now() - state.lastTrialAt > 260) {
    showToast("WORLD DEPLOYED", `${body.name} entered a stable orbit at ${(state.forgeRadius / 8.2).toFixed(2)} AU.`, "", "◉");
  }
}

/* ── Body actions ───────────────────────────────────────── */

function addMoon() {
  const parent = state.selectedInfo;
  if (!parent || parent.isStar || parent.isMoon || parent.isComet) {
    showToast("NO ANCHOR", "Select a world first, then add a moon to it.", "warn", "☾");
    return;
  }
  const moon = universe.addMoonToSelected();
  if (moon) audio.blip(560, 0.1, "sine", 0.035);
}

function launchComet() {
  if (state.currentModal) return;
  const comet = universe.launchComet();
  if (comet) {
    hideControlsHint();
    if (!state.selectedInfo) {
      showToast("COMET RELEASED", "No target locked. Select a world first for an intercept trajectory.", "", "☄", 4000);
    }
  }
}

function focusSelected() {
  if (!state.selectedInfo) {
    showToast("NO TARGET", "Tap a world to select it, then focus your view.", "warn", "◎");
    return;
  }
  universe.focusBody(state.selectedInfo.id);
  hideControlsHint();
}

function boostSelected() {
  if (!state.selectedInfo) {
    showToast("NO TARGET", "Select a world before firing a prograde burn.", "warn", "⟳");
    return;
  }
  const body = universe.boostSelected(1);
  if (body) {
    showToast("PROGRADE BURN", `${body.name}'s orbit has been nudged. Watch the new trajectory unfold.`, "", "⟳", 3200);
  }
}

function deleteSelected() {
  const info = state.selectedInfo;
  if (!info || info.isStar) return;
  const removed = universe.deleteSelected();
  if (removed) {
    audio.blip(170, 0.16, "triangle", 0.025);
  }
}

/* ── Time / camera ──────────────────────────────────────── */

function togglePause() {
  const paused = !universe.paused;
  universe.setPaused(paused);
  updatePauseUI();
  audio.blip(paused ? 260 : 520, 0.06, "sine", 0.025);
}

function setTimeScale(scale) {
  universe.setTimeScale(scale);
  updatePauseUI();
  audio.blip(360 + scale * 40, 0.05, "sine", 0.022);
}

function updatePauseUI() {
  const paused = universe.paused;
  $("pause-btn").classList.toggle("paused", paused);
  const status = $("sim-status");
  status.classList.toggle("paused", paused);
  const label = status.querySelector("span:nth-child(2)");
  if (label) label.textContent = paused ? "SIMULATION PAUSED" : "SIMULATION LIVE";
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.classList.toggle("active", !paused && parseFloat(btn.dataset.speed) === universe.timeScale);
  });
}

/* ── Reset / modals ─────────────────────────────────────── */

function armReset() {
  const now = performance.now();
  if (now < state.resetArmedUntil) {
    audio.reset();
    document.body.classList.add("reset-fade");
    setTimeout(() => window.location.reload(), 380);
    return;
  }
  state.resetArmedUntil = now + 4000;
  showToast("RESET ARMED", "Tap reset again within four seconds to rebuild the Helios system.", "warn", "↺", 4200);
}

function resetSystem() {
  document.body.classList.add("reset-fade");
  setTimeout(() => window.location.reload(), 350);
}

function openModal(el, pause = false) {
  if (!el) return;
  if (state.currentModal) closeModal(true);
  state.currentModal = el;
  state.pauseBeforeModal = universe.paused;
  if (pause) {
    universe.setPaused(true);
    state.pausedByModal = true;
  }
  $("modal-layer").classList.remove("hidden");
  document.body.classList.add("modal-open");
  el.setAttribute("aria-hidden", "false");
  document.querySelectorAll(".modal-card").forEach((card) => {
    card.style.display = card === el ? "block" : "none";
  });
}

function closeModal(keepBodyClass = false) {
  if (!state.currentModal) return;
  state.currentModal = null;
  $("modal-layer").classList.add("hidden");
  if (!keepBodyClass) document.body.classList.remove("modal-open");
  document.querySelectorAll(".modal-card").forEach((card) => {
    card.setAttribute("aria-hidden", "true");
    card.style.display = "";
  });
  if (state.pausedByModal) {
    universe.setPaused(state.pauseBeforeModal || false);
    state.pausedByModal = false;
    updatePauseUI();
  }
}

/* ── Utilities / chrome ─────────────────────────────────── */

function showToast(title, message, variant = "", icon = "✦", duration = 3800) {
  const stack = $("toast-stack");
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  const iconEl = document.createElement("span");
  iconEl.className = "toast-icon";
  iconEl.textContent = icon;
  const copy = document.createElement("div");
  copy.className = "toast-copy";
  const b = document.createElement("b");
  b.textContent = title.toUpperCase();
  const span = document.createElement("span");
  span.textContent = message;
  copy.append(b, span);
  toast.append(iconEl, copy);
  stack.appendChild(toast);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 360);
  }, duration);
}

function hideControlsHint(delay = 0) {
  if (state.hintTimer) clearTimeout(state.hintTimer);
  if (delay > 0) {
    state.hintTimer = setTimeout(() => $("controls-hint").classList.add("is-hidden"), delay);
  } else {
    $("controls-hint").classList.add("is-hidden");
  }
}

function updateScore(pulse = false) {
  const el = $("stardust");
  el.textContent = state.score.toLocaleString("en-US");
  if (pulse) {
    el.animate(
      [
        { transform: "scale(1)", color: "#78dcc2" },
        { transform: "scale(1.22)", color: "#ffdaa0" },
        { transform: "scale(1)", color: "#78dcc2" },
      ],
      { duration: 620, easing: "cubic-bezier(.16,1,.3,1)" }
    );
  }
}

function burstAtCameraEdge() {
  const el = $("scene");
  el.animate(
    [{ filter: "brightness(1)" }, { filter: "brightness(1.18)" }, { filter: "brightness(1)" }],
    { duration: 420, easing: "ease-out" }
  );
}

function prewarmPreviews() {
  for (const type of ["terra", "ocean", "desert", "ice", "gas"]) {
    try {
      const surface = getSurface(type);
      const orb = orbByType[type];
      if (orb && surface.preview) orb.style.backgroundImage = `url("${surface.preview}")`;
    } catch (error) {
      console.warn("Preview unavailable", type, error);
    }
  }
}

function hexA(hex, alpha) {
  if (!hex || hex[0] !== "#") return `rgba(120,220,194,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Exposed for lightweight automated smoke checks and for players who like to poke at the simulation.
window.orbitalis = {
  universe,
  state,
  trials: TRIALS,
  select: (id) => universe.select(id),
  deploy: (type, radius) => universe.addWorld(type, radius),
  comet: () => universe.launchComet(),
  moon: () => universe.addMoonToSelected(),
  setTimeScale,
  togglePause,
};
