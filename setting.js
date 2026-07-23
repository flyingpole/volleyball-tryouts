const SKILL = "Setting";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_setting_state";

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let suppressJogSettle = false; // true while we're programmatically scrolling the jog wheel, so that scroll doesn't get misread as the user hunting for a player

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
  playerJog: document.getElementById("playerJog"),
  activePlayerLabel: document.getElementById("activePlayerLabel"),
  undoBtn: document.getElementById("undoBtn"),
  toast: document.getElementById("toast"),
};

const scoreButtons = [
  document.getElementById("btnFrontHit"),
  document.getElementById("btnFrontMiss"),
  document.getElementById("btnBackHit"),
  document.getElementById("btnBackMiss"),
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
  if (activePlayer()) scrollJogToPlayer(activePlayer().playerNumber);
}

function refreshUI() {
  const p = activePlayer();
  const tally = p ? sessionTallies[p.playerNumber] : null;
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}${tally ? ` — ${tally.attempts} att` : ""}`
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

// preferredPlayerNumber: used when restoring a saved session or jumping to a
// specific player (via the jog wheel), so that player stays selected instead
// of defaulting to the first in the group. skipJogCenter: true when this load
// was itself triggered by the jog wheel settling on a player — no need to
// re-center it on itself.
function loadGroup(preferredPlayerNumber, skipJogCenter) {
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
  loadGroup(playerNumber, true);
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
  els.startNumberInput.value = "";
  renderRows();
  refreshUI();
  setToast("Local data reset for this device.", false);
}

els.loadGroupBtn.addEventListener("click", () => loadGroup());
els.startNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGroup();
});

scoreButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    flashButton(btn);
    hapticTap();
    submitAttempt(btn.dataset.result, btn.dataset.hit === "true");
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

// Every button IS the score (Hit = 1, Miss = 0), so there's no pending
// selection step — tapping a button logs immediately. Unlike the other skill
// pages, the active player does NOT auto-advance: players run several reps
// in a row here, so the coach stays on the same player until they tap a
// different row themselves. Updates state and the screen right away,
// confirms with the server in the background, and rolls back only if the
// server explicitly rejects it (see app.js postJSON).
function submitAttempt(result, hitTarget) {
  const p = activePlayer();
  if (!p) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const pts = hitTarget ? 1 : 0;
  const label = `${result} Set ${hitTarget ? "Hit" : "Miss"}`;

  adjustTally(p.playerNumber, 1, pts);
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — ${label} (saving…)`, false);
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
      setToast(`✓ #${p.playerNumber} ${p.playerName} — ${label}`, false);
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
      setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName}`, false);
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
