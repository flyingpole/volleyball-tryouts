const SKILL = "Serving";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const BASE_POINTS = { Slow: 1, Average: 2, Fast: 3 };
const STATE_KEY = "vbtryouts_serving_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let pendingResult = null; // "Slow" | "Average" | "Fast" | null — set by a velocity tap, cleared on submit
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO

function computeScore(result, hitTarget) {
  if (result === "Missed") return 0;
  return BASE_POINTS[result] + (hitTarget ? 1 : 0);
}

function persistState() {
  saveJSON(STATE_KEY, {
    startNumber: els.startNumberInput.value,
    activePlayerNumber: activePlayer() ? activePlayer().playerNumber : undefined,
    tallies: sessionTallies,
    undoStack,
  });
}

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
  persistState();
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

  const ready = !!p && isScriptConfigured();
  els.btnMissed.disabled = !ready;
  velocityButtons.forEach((btn) => { btn.disabled = !ready; });
  targetButtons.forEach((btn) => { btn.disabled = !ready || !pendingResult; });

  els.undoBtn.disabled = !undoStack.length || !isScriptConfigured();
  els.undoBtn.textContent = undoStack.length ? `UNDO (${undoStack.length})` : "UNDO";
}

function setToast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast " + (isError ? "error" : "success");
}

// preferredPlayerNumber: used only when restoring a saved session, so the
// previously-active player stays selected instead of resetting to the first
// player in the group.
function loadGroup(preferredPlayerNumber) {
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

  let idx = 0;
  if (preferredPlayerNumber !== undefined) {
    const found = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(preferredPlayerNumber));
    if (found !== -1) idx = found;
  }
  activeIndex = visiblePlayers.length ? idx : null;
  pendingResult = null;
  renderRows();
  refreshUI();
  persistState();

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
    const savedCoach = getSavedCoach();
    if (savedCoach && coaches.includes(savedCoach)) els.coachSelect.value = savedCoach;

    roster = players;

    const savedState = loadJSON(STATE_KEY, null);
    if (savedState && savedState.tallies) sessionTallies = savedState.tallies;
    if (savedState && Array.isArray(savedState.undoStack)) undoStack = savedState.undoStack;
    if (savedState && savedState.startNumber) {
      els.startNumberInput.value = savedState.startNumber;
      loadGroup(savedState.activePlayerNumber);
    }
  } catch (err) {
    setToast(`Couldn't load setup data: ${err.message}`, true);
  }
  refreshUI();
}

els.coachSelect.addEventListener("change", () => {
  saveCoach(els.coachSelect.value);
});

els.loadGroupBtn.addEventListener("click", () => loadGroup());
els.startNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGroup();
});

els.btnMissed.addEventListener("click", () => {
  if (els.btnMissed.disabled) return;
  submitAttempt("Missed", false);
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

function adjustTally(playerNumber, attemptsDelta, pointsDelta) {
  const prev = sessionTallies[playerNumber] || { attempts: 0, points: 0 };
  const attempts = prev.attempts + attemptsDelta;
  if (attempts <= 0) {
    delete sessionTallies[playerNumber];
  } else {
    sessionTallies[playerNumber] = { attempts, points: prev.points + pointsDelta };
  }
}

function pushUndoEntry(entry) {
  undoStack.unshift(entry);
  if (undoStack.length > MAX_UNDO) undoStack.length = MAX_UNDO;
}

// Updates state and the screen immediately, then confirms with the server in
// the background — Apps Script round-trips can take a couple of seconds, and
// waiting on that before advancing made rapid-fire scoring feel sluggish.
// Rolls back if the request ultimately fails.
function submitAttempt(result, hitTarget) {
  const p = activePlayer();
  if (!p || !result) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const pts = computeScore(result, hitTarget);

  adjustTally(p.playerNumber, 1, pts);
  if (visiblePlayers.length) activeIndex = (activeIndex + 1) % visiblePlayers.length;
  pendingResult = null;
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — ${pts} pts (saving…)`, false);
  persistState();

  postAttempt({ coach, playerNumber: p.playerNumber, playerName: p.playerName, skill: SKILL, result, hitTarget })
    .then((response) => {
      pushUndoEntry({
        rowNumber: response.rowNumber,
        coach,
        playerNumber: p.playerNumber,
        playerName: p.playerName,
        points: response.points ?? pts,
      });
      setToast(`✓ #${p.playerNumber} ${p.playerName} — ${response.points ?? pts} pts`, false);
      refreshUI();
      persistState();
    })
    .catch((err) => {
      adjustTally(p.playerNumber, -1, -pts);
      renderRows();
      setToast(`⚠ #${p.playerNumber} ${p.playerName} failed to save: ${err.message}`, true);
      persistState();
    });
}

function performUndo() {
  if (!undoStack.length) return;
  const undone = undoStack.shift();

  adjustTally(undone.playerNumber, -1, -undone.points);
  const idx = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(undone.playerNumber));
  if (idx !== -1) activeIndex = idx;
  pendingResult = null;
  renderRows();
  refreshUI();
  setToast(`↩ Undoing #${undone.playerNumber} ${undone.playerName}…`, false);
  persistState();

  postUndo({ coach: undone.coach, rowNumber: undone.rowNumber })
    .then(() => {
      setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName} — ${undone.points} pts`, false);
    })
    .catch((err) => {
      // Server rejected it — put it back and restore the tally.
      undoStack.unshift(undone);
      adjustTally(undone.playerNumber, 1, undone.points);
      renderRows();
      refreshUI();
      setToast(`Couldn't undo: ${err.message}`, true);
      persistState();
    });
}

init();
