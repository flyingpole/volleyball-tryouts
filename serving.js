const SKILL = "Serving";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const BASE_POINTS = { Slow: 1, Average: 2, Fast: 3 };
const STATE_KEY = "vbtryouts_serving_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let pendingResult = null; // "Slow" | "Average" | "Fast" | null — set by a velocity tap, cleared on submit
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let seedStart = null; // the start number a rotation began at; where it loops back to at roster's end

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
    seedStart,
  });
}

const els = {
  banner: document.getElementById("configBanner"),
  coachSelect: document.getElementById("coachSelect"),
  startNumberInput: document.getElementById("startNumberInput"),
  loadGroupBtn: document.getElementById("loadGroupBtn"),
  playerRows: document.getElementById("playerRows"),
  playerJog: document.getElementById("playerJog"),
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
    tallySpan.textContent = tally ? `${tally.attempts} att` : "";
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

// preferredPlayerNumber: used when restoring a saved session or sliding to a
// specific player, so that player stays selected instead of defaulting to the
// first in the group. reseed: true when this is a deliberate new starting
// point (manual Load, jog wheel) rather than an automatic slide-forward —
// only deliberate seeds get remembered as the rotation's loop-back point.
function loadGroup(preferredPlayerNumber, reseed) {
  const start = parseInt(els.startNumberInput.value, 10);
  if (!Number.isFinite(start)) {
    setToast("Enter a starting player number.", true);
    return;
  }
  if (reseed) seedStart = start;
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

// Full-roster scrub list for finding a player who's out of the loaded
// group's numeric range. Scroll-snap does the "jog wheel" feel natively;
// whichever item settles under the center highlight becomes the new focus.
function renderPlayerJog() {
  const jog = els.playerJog;
  jog.innerHTML = "";

  const spacer = () => {
    const div = document.createElement("div");
    div.style.height = `${JOG_ITEM_HEIGHT}px`;
    return div;
  };
  jog.appendChild(spacer());

  [...roster]
    .sort((a, b) => Number(a.playerNumber) - Number(b.playerNumber))
    .forEach((p) => {
      const item = document.createElement("div");
      item.className = "player-jog-item";
      item.textContent = `#${p.playerNumber} ${p.playerName || ""}`;
      item.dataset.playerNumber = p.playerNumber;
      jog.appendChild(item);
    });

  jog.appendChild(spacer());
}

els.playerJog.addEventListener("scroll", () => {
  clearTimeout(jogSettleTimer);
  jogSettleTimer = setTimeout(onJogSettled, 120);
});

function onJogSettled() {
  const jog = els.playerJog;
  const centerY = jog.scrollTop + jog.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  jog.querySelectorAll(".player-jog-item").forEach((item) => {
    const itemCenter = item.offsetTop + item.offsetHeight / 2;
    const dist = Math.abs(itemCenter - centerY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  });
  if (closest) jumpToPlayer(Number(closest.dataset.playerNumber));
}

// Re-centers the main 10-player group so the found player lands near the
// middle, with players above/below shown by their normal numeric sequence.
function jumpToPlayer(playerNumber) {
  els.startNumberInput.value = String(playerNumber - 4);
  loadGroup(playerNumber, true);
}

// Moves to the next player after a score. Within the visible 10, that's just
// the next row. At the bottom of the 10, instead of wrapping back to the top
// of the same group, the whole window slides forward one player number —
// there's no need to keep re-picking a starting point as you work through
// the roster. If sliding forward would run past the last player on the
// roster, loop back to wherever this rotation was originally seeded from.
function advanceAfterScore() {
  if (!visiblePlayers.length) return;
  if (activeIndex < visiblePlayers.length - 1) {
    activeIndex += 1;
    return;
  }

  const lastNum = Number(visiblePlayers[visiblePlayers.length - 1].playerNumber);
  const hasMoreAhead = roster.some((p) => Number(p.playerNumber) > lastNum);

  if (hasMoreAhead) {
    const start = parseInt(els.startNumberInput.value, 10);
    els.startNumberInput.value = String((Number.isFinite(start) ? start : lastNum - GROUP_SIZE + 1) + 1);
    loadGroup(lastNum + 1);
  } else if (seedStart !== null) {
    els.startNumberInput.value = String(seedStart);
    loadGroup();
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
    updateHeaderCoach(els.coachSelect.value);

    roster = players;
    renderPlayerJog();

    const savedState = loadJSON(STATE_KEY, null);
    if (savedState && savedState.tallies) sessionTallies = savedState.tallies;
    if (savedState && Array.isArray(savedState.undoStack)) undoStack = savedState.undoStack;
    if (savedState && savedState.startNumber) {
      seedStart = Number.isFinite(savedState.seedStart)
        ? savedState.seedStart
        : parseInt(savedState.startNumber, 10);
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
  updateHeaderCoach(els.coachSelect.value);
});

initHeaderMenu(resetPageState);

// Clears this device's local state only (undo stack, tallies, saved group) —
// never touches the Google Sheet. See the Reset button in the header menu.
function resetPageState() {
  localStorage.removeItem(STATE_KEY);
  visiblePlayers = [];
  activeIndex = null;
  pendingResult = null;
  sessionTallies = {};
  undoStack = [];
  seedStart = null;
  els.startNumberInput.value = "";
  renderRows();
  refreshUI();
  setToast("Local data reset for this device.", false);
}

els.loadGroupBtn.addEventListener("click", () => loadGroup(undefined, true));
els.startNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGroup(undefined, true);
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
  advanceAfterScore();
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
      if (err.confirmed) {
        // The server explicitly rejected it — nothing was written, safe to roll back.
        adjustTally(p.playerNumber, -1, -pts);
        renderRows();
        setToast(`⚠ #${p.playerNumber} ${p.playerName} failed to save: ${err.message}`, true);
      } else {
        // Couldn't confirm either way (network/CORS hiccup) — Apps Script may
        // well have written the row despite the request looking like it
        // failed here. Leave the tally as-is rather than risk a double-submit
        // from re-scoring something that actually saved.
        setToast(`⚠ #${p.playerNumber} ${p.playerName}: couldn't confirm save (${err.message}). Check the Log sheet before re-scoring.`, true);
      }
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
      if (err.confirmed) {
        // Server explicitly rejected the undo — it definitely didn't happen,
        // safe to put the entry back and restore the tally.
        undoStack.unshift(undone);
        adjustTally(undone.playerNumber, 1, undone.points);
        renderRows();
        refreshUI();
        setToast(`Couldn't undo: ${err.message}`, true);
      } else {
        // Couldn't confirm either way — it may have gone through despite the
        // request looking failed here, so don't restore it optimistically.
        setToast(`Couldn't confirm undo (${err.message}). Check the Log sheet.`, true);
      }
      persistState();
    });
}

init();
