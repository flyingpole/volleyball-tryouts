const SKILL = "Passing";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_passing_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let seedStart = null; // the start number a rotation began at; where it loops back to at roster's end

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
  toast: document.getElementById("toast"),
};

const scoreButtons = [
  document.getElementById("btn0"),
  document.getElementById("btn1"),
  document.getElementById("btn2"),
  document.getElementById("btn3"),
];

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
  renderRows();
  refreshUI();
  persistState();
}

function refreshUI() {
  const p = activePlayer();
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}`
    : (visiblePlayers.length ? "Tap a player" : "Load a group");

  const ready = !!p && isScriptConfigured();
  scoreButtons.forEach((btn) => { btn.disabled = !ready; });

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

scoreButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    submitAttempt(btn.dataset.result);
  });
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

// Every button IS the score (0-3), so unlike Serving there's no pending
// selection step — tapping a button logs immediately. Updates state and the
// screen right away, confirms with the server in the background, and rolls
// back only if the server explicitly rejects it (see app.js postJSON).
function submitAttempt(result) {
  const p = activePlayer();
  if (!p) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const pts = Number(result.charAt(0));

  adjustTally(p.playerNumber, 1, pts);
  advanceAfterScore();
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — ${result} (saving…)`, false);
  persistState();

  postAttempt({ coach, playerNumber: p.playerNumber, playerName: p.playerName, skill: SKILL, result })
    .then((response) => {
      pushUndoEntry({
        rowNumber: response.rowNumber,
        coach,
        playerNumber: p.playerNumber,
        playerName: p.playerName,
        points: response.points ?? pts,
      });
      setToast(`✓ #${p.playerNumber} ${p.playerName} — ${result}`, false);
      refreshUI();
      persistState();
    })
    .catch((err) => {
      if (err.confirmed) {
        adjustTally(p.playerNumber, -1, -pts);
        renderRows();
        setToast(`⚠ #${p.playerNumber} ${p.playerName} failed to save: ${err.message}`, true);
      } else {
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
        undoStack.unshift(undone);
        adjustTally(undone.playerNumber, 1, undone.points);
        renderRows();
        refreshUI();
        setToast(`Couldn't undo: ${err.message}`, true);
      } else {
        setToast(`Couldn't confirm undo (${err.message}). Check the Log sheet.`, true);
      }
      persistState();
    });
}

init();
