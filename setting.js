const SKILL = "Setting";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_setting_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let currentStart = null; // lowest player number in the current 10-player window
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let suppressJogSettle = false; // true while we're programmatically scrolling the jog wheel, so that scroll doesn't get misread as the user hunting for a player

function persistState() {
  saveJSON(STATE_KEY, {
    start: currentStart,
    activePlayerNumber: activePlayer() ? activePlayer().playerNumber : undefined,
    tallies: sessionTallies,
    undoStack,
    frontBalls: els.frontBallsSelect.value,
    backBalls: els.backBallsSelect.value,
  });
}

const els = {
  banner: document.getElementById("configBanner"),
  coachSelect: document.getElementById("coachSelect"),
  playerRows: document.getElementById("playerRows"),
  playerJog: document.getElementById("playerJog"),
  activePlayerLabel: document.getElementById("activePlayerLabel"),
  undoBtn: document.getElementById("undoBtn"),
  toast: document.getElementById("toast"),
  frontBallsSelect: document.getElementById("frontBallsSelect"),
  frontMadeSelect: document.getElementById("frontMadeSelect"),
  btnFrontSubmit: document.getElementById("btnFrontSubmit"),
  backBallsSelect: document.getElementById("backBallsSelect"),
  backMadeSelect: document.getElementById("backMadeSelect"),
  btnBackSubmit: document.getElementById("btnBackSubmit"),
};

// Fills the "made" dropdown with 0..balls, keeping the current selection if
// it's still in range (e.g. switching balls from 15 to 20 with "8" made
// selected keeps "8"), otherwise resetting to 0.
function populateMadeOptions(ballsSelect, madeSelect) {
  const balls = parseInt(ballsSelect.value, 10);
  const prev = madeSelect.value;
  madeSelect.innerHTML = "";
  for (let made = 0; made <= balls; made++) {
    const opt = document.createElement("option");
    opt.value = String(made);
    opt.textContent = String(made);
    madeSelect.appendChild(opt);
  }
  madeSelect.value = (prev !== "" && Number(prev) <= balls) ? prev : "0";
}

els.frontBallsSelect.addEventListener("change", () => {
  populateMadeOptions(els.frontBallsSelect, els.frontMadeSelect);
  persistState();
});
els.backBallsSelect.addEventListener("change", () => {
  populateMadeOptions(els.backBallsSelect, els.backMadeSelect);
  persistState();
});
populateMadeOptions(els.frontBallsSelect, els.frontMadeSelect);
populateMadeOptions(els.backBallsSelect, els.backMadeSelect);

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
  if (activePlayer()) scrollJogToPlayer(activePlayer().playerNumber);
}

function refreshUI() {
  const p = activePlayer();
  const tally = p ? sessionTallies[p.playerNumber] : null;
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}${tally ? ` — ${tally.attempts} att` : ""}`
    : (visiblePlayers.length ? "Tap a player" : "Load a group");

  const ready = !!p && isScriptConfigured();
  els.frontBallsSelect.disabled = !ready;
  els.frontMadeSelect.disabled = !ready;
  els.btnFrontSubmit.disabled = !ready;
  els.backBallsSelect.disabled = !ready;
  els.backMadeSelect.disabled = !ready;
  els.btnBackSubmit.disabled = !ready;

  els.undoBtn.disabled = !undoStack.length || !isScriptConfigured();
  els.undoBtn.textContent = undoStack.length ? `UNDO (${undoStack.length})` : "UNDO";
}

function setToast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast " + (isError ? "error" : "success");
}

// start: the lowest player number to show in the 10-player window.
// preferredPlayerNumber: used when restoring a saved session or jumping to a
// specific player (via the jog wheel), so that player stays selected instead
// of defaulting to the first in the group. skipJogCenter: true when this load
// was itself triggered by the jog wheel settling on a player — no need to
// re-center it on itself.
function loadGroup(start, preferredPlayerNumber, skipJogCenter) {
  currentStart = start;
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
  loadGroup(playerNumber - 4, playerNumber, true);
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
    if (savedState && savedState.frontBalls) els.frontBallsSelect.value = savedState.frontBalls;
    if (savedState && savedState.backBalls) els.backBallsSelect.value = savedState.backBalls;
    populateMadeOptions(els.frontBallsSelect, els.frontMadeSelect);
    populateMadeOptions(els.backBallsSelect, els.backMadeSelect);

    if (roster.length) {
      // No saved starting point yet (first-ever visit) — default to the
      // lowest player number on the roster instead of requiring a manual
      // Start#/Load step.
      const lowest = Math.min(...roster.map((p) => Number(p.playerNumber)));
      const start = savedState && Number.isFinite(savedState.start) ? savedState.start : lowest;
      loadGroup(start, savedState ? savedState.activePlayerNumber : undefined);
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
// Re-loads the group at the roster's lowest number, same as a fresh visit,
// since there's no more manual Start#/Load step to fall back on.
function resetPageState() {
  localStorage.removeItem(STATE_KEY);
  sessionTallies = {};
  undoStack = [];
  els.frontBallsSelect.value = "10";
  els.backBallsSelect.value = "10";
  populateMadeOptions(els.frontBallsSelect, els.frontMadeSelect);
  populateMadeOptions(els.backBallsSelect, els.backMadeSelect);
  if (roster.length) {
    loadGroup(Math.min(...roster.map((p) => Number(p.playerNumber))));
  } else {
    visiblePlayers = [];
    activeIndex = null;
    renderRows();
    refreshUI();
  }
  setToast("Local data reset for this device.", false);
}

els.btnFrontSubmit.addEventListener("click", () => {
  if (els.btnFrontSubmit.disabled) return;
  flashButton(els.btnFrontSubmit);
  hapticTap();
  submitBatch("Front");
});
els.btnBackSubmit.addEventListener("click", () => {
  if (els.btnBackSubmit.disabled) return;
  flashButton(els.btnBackSubmit);
  hapticTap();
  submitBatch("Back");
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

// Logs a whole drill set at once — the fixed ball count and how many hit the
// target for one side — instead of tapping each rep. No pending selection
// step; tapping "Log Front"/"Log Back" submits immediately using whatever
// the two dropdowns are currently set to. Unlike most other skill pages, the
// active player does NOT auto-advance: a coach typically logs both Front and
// Back for the same player before moving on, so auto-advancing after the
// first submission would get in the way. Updates state and the screen right
// away, confirms with the server in the background, and rolls back only if
// the server explicitly rejects it (see app.js postJSON).
function submitBatch(side) {
  const p = activePlayer();
  if (!p) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const ballsSelect = side === "Front" ? els.frontBallsSelect : els.backBallsSelect;
  const madeSelect = side === "Front" ? els.frontMadeSelect : els.backMadeSelect;
  const balls = parseInt(ballsSelect.value, 10);
  const made = parseInt(madeSelect.value, 10);
  const label = `${side} ${made}/${balls}`;

  adjustTally(p.playerNumber, balls, made);
  madeSelect.value = "0";
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — ${label} (saving…)`, false);
  persistState();

  postSettingBatch({ coach, playerNumber: p.playerNumber, playerName: p.playerName, side, balls, made })
    .then((response) => {
      pushUndoEntry({
        startRow: response.startRow,
        rowCount: response.rowCount,
        coach,
        playerNumber: p.playerNumber,
        playerName: p.playerName,
        side,
        made: response.made,
      });
      setToast(`✓ #${p.playerNumber} ${p.playerName} — ${label}`, false);
      refreshUI();
      persistState();
    })
    .catch((err) => {
      if (err.confirmed) {
        adjustTally(p.playerNumber, -balls, -made);
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

  adjustTally(undone.playerNumber, -undone.rowCount, -undone.made);
  const idx = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(undone.playerNumber));
  if (idx !== -1) activeIndex = idx;
  renderRows();
  refreshUI();
  setToast(`↩ Undoing #${undone.playerNumber} ${undone.playerName}'s ${undone.side} batch…`, false);
  persistState();

  postUndoBatch({ coach: undone.coach, startRow: undone.startRow, rowCount: undone.rowCount })
    .then(() => {
      setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName}'s ${undone.side} ${undone.made}/${undone.rowCount}`, false);
    })
    .catch((err) => {
      if (err.confirmed) {
        undoStack.unshift(undone);
        adjustTally(undone.playerNumber, undone.rowCount, undone.made);
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
