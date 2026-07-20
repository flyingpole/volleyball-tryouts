const SKILL = "Serving";
const GROUP_SIZE = 10;
const BASE_POINTS = { under30: 1, "30to35": 2, over35: 3 };

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let pendingResult = null; // "under30" | "30to35" | "over35" | null — set by a velocity tap, cleared on submit
let isSubmitting = false; // guards against double-taps while a request is in flight
let lastLogged = null; // { rowNumber, coach, playerNumber, playerName, points } — one level of undo
const sessionTallies = {}; // playerNumber -> { attempts, points }

const els = {
  banner: document.getElementById("configBanner"),
  coachSelect: document.getElementById("coachSelect"),
  startNumberInput: document.getElementById("startNumberInput"),
  loadGroupBtn: document.getElementById("loadGroupBtn"),
  playerRows: document.getElementById("playerRows"),
  activePlayerLabel: document.getElementById("activePlayerLabel"),
  undoBtn: document.getElementById("undoBtn"),
  btnMissed: document.getElementById("btnMissed"),
  btnV1: document.getElementById("btnV1"),
  btnV2: document.getElementById("btnV2"),
  btnV3: document.getElementById("btnV3"),
  btnHitTarget: document.getElementById("btnHitTarget"),
  btnMissedTarget: document.getElementById("btnMissedTarget"),
  scoreNum: document.getElementById("scoreNum"),
  toast: document.getElementById("toast"),
};

const velocityButtons = [els.btnV1, els.btnV2, els.btnV3];
const targetButtons = [els.btnHitTarget, els.btnMissedTarget];

function activePlayer() {
  return activeIndex === null ? null : visiblePlayers[activeIndex];
}

function renderRows() {
  els.playerRows.innerHTML = "";
  visiblePlayers.forEach((p, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-btn" + (idx === activeIndex ? " active" : "");

    const label = document.createElement("span");
    label.textContent = `#${p.playerNumber} — ${p.playerName || "(unnamed)"}`;
    btn.appendChild(label);

    const tally = sessionTallies[p.playerNumber];
    const tallySpan = document.createElement("span");
    tallySpan.className = "tally";
    tallySpan.textContent = tally ? `${tally.attempts} att · ${tally.points} pts` : "";
    btn.appendChild(tallySpan);

    btn.addEventListener("click", () => selectPlayer(idx));
    els.playerRows.appendChild(btn);
  });
}

function selectPlayer(idx) {
  activeIndex = idx;
  pendingResult = null;
  renderRows();
  refreshUI();
}

function refreshUI() {
  const p = activePlayer();
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}`
    : (visiblePlayers.length ? "Tap a player" : "Load a group");

  velocityButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.result === pendingResult);
  });

  els.scoreNum.textContent = pendingResult ? String(BASE_POINTS[pendingResult]) : "–";

  const ready = !!p && !isSubmitting && isScriptConfigured();
  els.btnMissed.disabled = !ready;
  velocityButtons.forEach((btn) => { btn.disabled = !ready; });
  targetButtons.forEach((btn) => { btn.disabled = !ready || !pendingResult; });
  els.undoBtn.disabled = !lastLogged || isSubmitting || !isScriptConfigured();
}

function setToast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast " + (isError ? "error" : "success");
}

function loadGroup() {
  const start = parseInt(els.startNumberInput.value, 10);
  if (!Number.isFinite(start)) {
    setToast("Enter a starting player number.", true);
    return;
  }
  visiblePlayers = roster
    .filter((p) => {
      const n = Number(p.playerNumber);
      return n >= start && n < start + GROUP_SIZE;
    })
    .sort((a, b) => Number(a.playerNumber) - Number(b.playerNumber));

  activeIndex = visiblePlayers.length ? 0 : null;
  pendingResult = null;
  renderRows();
  refreshUI();

  if (!visiblePlayers.length) {
    setToast(`No roster players found from #${start} to #${start + GROUP_SIZE - 1}.`, true);
  } else {
    setToast("", false);
  }
}

async function init() {
  if (!isScriptConfigured()) {
    els.banner.hidden = false;
    refreshUI();
    return;
  }

  try {
    const [coaches, players] = await Promise.all([fetchCoaches(), fetchRoster()]);
    coaches.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.coachSelect.appendChild(opt);
    });
    const saved = getSavedCoach();
    if (saved && coaches.includes(saved)) els.coachSelect.value = saved;

    roster = players;
  } catch (err) {
    setToast(`Couldn't load setup data: ${err.message}`, true);
  }
  refreshUI();
}

els.coachSelect.addEventListener("change", () => {
  saveCoach(els.coachSelect.value);
});

els.loadGroupBtn.addEventListener("click", loadGroup);
els.startNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGroup();
});

els.btnMissed.addEventListener("click", () => {
  if (els.btnMissed.disabled) return;
  submitAttempt("missed", false);
});

velocityButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    pendingResult = pendingResult === btn.dataset.result ? null : btn.dataset.result;
    refreshUI();
  });
});

els.btnHitTarget.addEventListener("click", () => {
  if (els.btnHitTarget.disabled) return;
  submitAttempt(pendingResult, true);
});

els.btnMissedTarget.addEventListener("click", () => {
  if (els.btnMissedTarget.disabled) return;
  submitAttempt(pendingResult, false);
});

els.undoBtn.addEventListener("click", performUndo);

async function submitAttempt(result, hitTarget) {
  const p = activePlayer();
  if (!p || !result) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  isSubmitting = true;
  refreshUI();
  try {
    const response = await postAttempt({
      coach,
      playerNumber: p.playerNumber,
      playerName: p.playerName,
      skill: SKILL,
      result,
      hitTarget,
    });
    const pts = response.points;

    const prev = sessionTallies[p.playerNumber] || { attempts: 0, points: 0 };
    sessionTallies[p.playerNumber] = { attempts: prev.attempts + 1, points: prev.points + pts };

    lastLogged = {
      rowNumber: response.rowNumber,
      coach,
      playerNumber: p.playerNumber,
      playerName: p.playerName,
      points: pts,
    };

    setToast(`✓ #${p.playerNumber} ${p.playerName} — ${pts} pts`, false);

    // Players serve in numerical order, so move on to the next one automatically.
    if (visiblePlayers.length) {
      activeIndex = (activeIndex + 1) % visiblePlayers.length;
    }
    pendingResult = null;
    renderRows();
  } catch (err) {
    setToast(`Failed to log attempt: ${err.message}`, true);
  } finally {
    isSubmitting = false;
    refreshUI();
  }
}

async function performUndo() {
  if (!lastLogged) return;
  const undone = lastLogged;

  isSubmitting = true;
  refreshUI();
  try {
    await postUndo({ coach: undone.coach, rowNumber: undone.rowNumber });

    const prev = sessionTallies[undone.playerNumber];
    if (prev) {
      const attempts = prev.attempts - 1;
      if (attempts <= 0) delete sessionTallies[undone.playerNumber];
      else sessionTallies[undone.playerNumber] = { attempts, points: prev.points - undone.points };
    }

    // Jump back to the player whose attempt was undone so it can be redone.
    const idx = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(undone.playerNumber));
    if (idx !== -1) activeIndex = idx;
    pendingResult = null;
    lastLogged = null;

    setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName} — ${undone.points} pts`, false);
    renderRows();
  } catch (err) {
    setToast(`Couldn't undo: ${err.message}`, true);
  } finally {
    isSubmitting = false;
    refreshUI();
  }
}

init();
