const SKILL = "Blocking";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_blocking_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let sessionTallies = {}; // playerNumber -> { attempts, points } — points unused here, just attempts shown
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let seedStart = null; // the start number a rotation began at; where it loops back to at roster's end
let suppressJogSettle = false; // true while we're programmatically scrolling the jog wheel, so that scroll doesn't get misread as the user hunting for a player

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
  timeInput: document.getElementById("timeInput"),
  toast: document.getElementById("toast"),
};

const scoreButtons = [
  document.getElementById("btnRed"),
  document.getElementById("btnYellow"),
  document.getElementById("btnGreen"),
];

function activePlayer() {
  return activeIndex === null ? null : visiblePlayers[activeIndex];
}

function currentTime() {
  const seconds = parseFloat(els.timeInput.value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
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
  if (activePlayer()) scrollJogToPlayer(activePlayer().playerNumber);
}

function refreshUI() {
  const p = activePlayer();
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}`
    : (visiblePlayers.length ? "Tap a player" : "Load a group");

  const ready = !!p && isScriptConfigured();
  els.timeInput.disabled = !ready;
  const hasTime = ready && currentTime() !== null;
  scoreButtons.forEach((btn) => { btn.disabled = !hasTime; });

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
// skipJogCenter: true when this load was itself triggered by the jog wheel
// settling on a player — no need to re-center it on itself.
function loadGroup(preferredPlayerNumber, reseed, skipJogCenter) {
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
  if (!skipJogCenter && activePlayer()) scrollJogToPlayer(activePlayer().playerNumber);

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
  if (suppressJogSettle) return;
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
  loadGroup(playerNumber, true, true);
}

// Keeps the jog wheel following whichever player is active, so it's always
// close by rather than wherever it was last left — without this, going from
// player #1 (where the wheel happens to be) to #28 (the active player) meant
// scrolling through the whole roster to get back nearby. Suppresses the
// wheel's own scroll-settle detection for the single scroll event this
// triggers, so it doesn't fight with (or get mistaken for) the user
// manually scrolling it.
function scrollJogToPlayer(playerNumber) {
  const jog = els.playerJog;
  const item = [...jog.querySelectorAll(".player-jog-item")].find(
    (el) => String(el.dataset.playerNumber) === String(playerNumber)
  );
  if (!item) return;
  const target = item.offsetTop + item.offsetHeight / 2 - jog.clientHeight / 2;
  suppressJogSettle = true;
  jog.scrollTo({ top: target, behavior: "auto" });
  clearTimeout(jogSettleTimer);
  setTimeout(() => { suppressJogSettle = false; }, 200);
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
  els.timeInput.value = "";
  renderRows();
  refreshUI();
  setToast("Local data reset for this device.", false);
}

els.loadGroupBtn.addEventListener("click", () => loadGroup(undefined, true));
els.startNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGroup(undefined, true);
});

els.timeInput.addEventListener("input", refreshUI);

scoreButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    flashButton(btn);
    hapticTap();
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

// Tapping a quality button (Red/Yellow/Green) submits whatever's currently in
// the time field alongside it — that's the "confirm" action, no separate log
// step. Updates state and the screen right away, confirms with the server in
// the background, and rolls back only if the server explicitly rejects it
// (see app.js postJSON).
function submitAttempt(result) {
  const p = activePlayer();
  const time = currentTime();
  if (!p || time === null) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  adjustTally(p.playerNumber, 1, 0);
  advanceAfterScore();
  if (activePlayer()) scrollJogToPlayer(activePlayer().playerNumber);
  els.timeInput.value = "";
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — ${time}s ${result} (saving…)`, false);
  persistState();

  postAttempt({ coach, playerNumber: p.playerNumber, playerName: p.playerName, skill: SKILL, result, time })
    .then((response) => {
      pushUndoEntry({
        rowNumber: response.rowNumber,
        coach,
        playerNumber: p.playerNumber,
        playerName: p.playerName,
        points: response.points ?? time,
      });
      setToast(`✓ #${p.playerNumber} ${p.playerName} — ${time}s ${result}`, false);
      refreshUI();
      persistState();
    })
    .catch((err) => {
      if (err.confirmed) {
        adjustTally(p.playerNumber, -1, 0);
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

  adjustTally(undone.playerNumber, -1, 0);
  const idx = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(undone.playerNumber));
  if (idx !== -1) activeIndex = idx;
  renderRows();
  refreshUI();
  setToast(`↩ Undoing #${undone.playerNumber} ${undone.playerName}…`, false);
  persistState();

  postUndo({ coach: undone.coach, rowNumber: undone.rowNumber })
    .then(() => {
      setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName}`, false);
    })
    .catch((err) => {
      if (err.confirmed) {
        undoStack.unshift(undone);
        adjustTally(undone.playerNumber, 1, 0);
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
