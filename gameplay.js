const SKILL = "Game Play";
const MAX_PER_SIDE = 12;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_gameplay_state";
const BASE_POINTS = {
  "Service Ace": 1, "Serve Error": -1,
  "Serve Receive": 1, "Serve Receive Error": -1,
  "Attack Kill": 1, "Attack Error": -1,
  "Dig Error": -1,
  "Block": 1, "Block Error": -1,
};
const SIDE_LABELS = { side1: "Side 1", side2: "Side 2" };

let roster = [];
// Unlike every other skill page, Game Play doesn't work through the roster
// in numerical order — a scrimmage only has a handful of players on the
// court at once, picked by the coach rather than loaded as a numeric range.
let onCourt = { side1: [], side2: [] }; // player objects, sorted ascending by playerNumber, capped at MAX_PER_SIDE each
let activePlayerNumber = null; // whichever on-court player is currently selected for scoring
let jogSelectedPlayerNumber = null; // whichever roster player is centered/tapped in "Find player" — the add candidate
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;

function persistState() {
  saveJSON(STATE_KEY, {
    side1: onCourt.side1.map((p) => p.playerNumber),
    side2: onCourt.side2.map((p) => p.playerNumber),
    activePlayerNumber,
    tallies: sessionTallies,
    undoStack,
  });
}

const els = {
  banner: document.getElementById("configBanner"),
  coachSelect: document.getElementById("coachSelect"),
  side1Rows: document.getElementById("side1Rows"),
  side2Rows: document.getElementById("side2Rows"),
  playerJog: document.getElementById("playerJog"),
  addSide1Btn: document.getElementById("addSide1Btn"),
  addSide2Btn: document.getElementById("addSide2Btn"),
  activePlayerLabel: document.getElementById("activePlayerLabel"),
  undoBtn: document.getElementById("undoBtn"),
  removeBtn: document.getElementById("removeBtn"),
  toast: document.getElementById("toast"),
};

const scoreButtons = Array.from(document.querySelectorAll(".gp-grid button"));

function activePlayer() {
  if (activePlayerNumber === null) return null;
  return onCourt.side1.find((p) => String(p.playerNumber) === String(activePlayerNumber))
    || onCourt.side2.find((p) => String(p.playerNumber) === String(activePlayerNumber))
    || null;
}

function findOnCourtSide(playerNumber) {
  if (onCourt.side1.some((p) => String(p.playerNumber) === String(playerNumber))) return "side1";
  if (onCourt.side2.some((p) => String(p.playerNumber) === String(playerNumber))) return "side2";
  return null;
}

function sortAscending(list) {
  list.sort((a, b) => Number(a.playerNumber) - Number(b.playerNumber));
}

function renderCourtSide(container, list) {
  container.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "court-rows-empty";
    empty.textContent = "empty";
    container.appendChild(empty);
    return;
  }
  list.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "court-row" + (String(p.playerNumber) === String(activePlayerNumber) ? " active" : "");

    const label = document.createElement("span");
    label.textContent = `#${p.playerNumber}`;
    btn.appendChild(label);

    // Game Play's score is a running total, not an attempt count — same
    // reasoning as the row list this replaces.
    const tally = sessionTallies[p.playerNumber];
    const tallySpan = document.createElement("span");
    tallySpan.className = "tally";
    tallySpan.textContent = tally ? `${tally.points > 0 ? "+" : ""}${tally.points}` : "";
    btn.appendChild(tallySpan);

    btn.addEventListener("click", () => selectActivePlayer(p.playerNumber));
    container.appendChild(btn);
  });
}

function renderCourt() {
  renderCourtSide(els.side1Rows, onCourt.side1);
  renderCourtSide(els.side2Rows, onCourt.side2);
}

function selectActivePlayer(playerNumber) {
  activePlayerNumber = playerNumber;
  renderCourt();
  refreshUI();
  persistState();
}

function refreshUI() {
  const p = activePlayer();
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber}`
    : (onCourt.side1.length || onCourt.side2.length ? "Tap a player" : "Add players to the court");

  const ready = !!p && isScriptConfigured();
  scoreButtons.forEach((btn) => { btn.disabled = !ready; });
  els.removeBtn.disabled = !p;

  els.undoBtn.disabled = !undoStack.length || !isScriptConfigured();
  els.undoBtn.textContent = undoStack.length ? `UNDO (${undoStack.length})` : "UNDO";
}

function setToast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast " + (isError ? "error" : "success");
}

// Full-roster scrub list — the only way to find a player on this page, since
// there's no numeric Start#/Load range here. Tapping an item directly, or
// letting scroll-snap settle one under the highlight band, both mark that
// player as the "add candidate" the two side buttons act on.
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
      item.addEventListener("click", () => { jogSelectedPlayerNumber = p.playerNumber; });
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
  if (closest) jogSelectedPlayerNumber = Number(closest.dataset.playerNumber);
}

// Adds the current "Find player" candidate to a side, capped at
// MAX_PER_SIDE. If they're already on the OTHER side, moves them instead of
// blocking — a coach fixing a mis-tap shouldn't have to remove-then-re-add.
function addToSide(sideKey) {
  if (jogSelectedPlayerNumber === null) {
    setToast("Scroll to or tap a player in the list first.", true);
    return;
  }
  const player = roster.find((p) => String(p.playerNumber) === String(jogSelectedPlayerNumber));
  if (!player) return;

  const existingSide = findOnCourtSide(player.playerNumber);
  if (existingSide === sideKey) {
    setToast(`#${player.playerNumber} is already on ${SIDE_LABELS[sideKey]}.`, true);
    return;
  }
  if (onCourt[sideKey].length >= MAX_PER_SIDE) {
    setToast(`${SIDE_LABELS[sideKey]} is full (${MAX_PER_SIDE} players) — remove someone first.`, true);
    return;
  }
  if (existingSide) {
    onCourt[existingSide] = onCourt[existingSide].filter((p) => String(p.playerNumber) !== String(player.playerNumber));
  }

  onCourt[sideKey].push(player);
  sortAscending(onCourt[sideKey]);
  activePlayerNumber = player.playerNumber;
  renderCourt();
  refreshUI();
  persistState();
  setToast(`✓ Added #${player.playerNumber} to ${SIDE_LABELS[sideKey]}`, false);
}

// Subs the active player off the court entirely. Their tally/undo history
// stays intact (keyed by player number, not court membership) — subbing
// them back in later picks up right where they left off.
function removeActivePlayer() {
  const p = activePlayer();
  if (!p) return;
  const side = findOnCourtSide(p.playerNumber);
  if (side) onCourt[side] = onCourt[side].filter((x) => String(x.playerNumber) !== String(p.playerNumber));
  activePlayerNumber = null;
  renderCourt();
  refreshUI();
  persistState();
  setToast(`Removed #${p.playerNumber} from the court`, false);
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
    if (savedState) {
      const byNumber = (num) => roster.find((p) => String(p.playerNumber) === String(num));
      onCourt.side1 = (savedState.side1 || []).map(byNumber).filter(Boolean);
      onCourt.side2 = (savedState.side2 || []).map(byNumber).filter(Boolean);
      sortAscending(onCourt.side1);
      sortAscending(onCourt.side2);
      activePlayerNumber = savedState.activePlayerNumber ?? null;
    }
    renderCourt();
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

// Clears this device's local state only (undo stack, tallies, on-court
// roster) — never touches the Google Sheet. See the Reset button in the
// header menu.
function resetPageState() {
  localStorage.removeItem(STATE_KEY);
  onCourt = { side1: [], side2: [] };
  activePlayerNumber = null;
  jogSelectedPlayerNumber = null;
  sessionTallies = {};
  undoStack = [];
  renderCourt();
  refreshUI();
  setToast("Local data reset for this device.", false);
}

els.addSide1Btn.addEventListener("click", () => addToSide("side1"));
els.addSide2Btn.addEventListener("click", () => addToSide("side2"));
els.removeBtn.addEventListener("click", removeActivePlayer);

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

// Every button IS the score, so there's no pending selection step — tapping
// one logs immediately. Updates state and the screen right away, confirms
// with the server in the background, and rolls back only if the server
// explicitly rejects it (see app.js postJSON).
function submitAttempt(result) {
  const p = activePlayer();
  if (!p) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const pts = BASE_POINTS[result];
  const sign = pts > 0 ? "+1" : "−1";

  adjustTally(p.playerNumber, 1, pts);
  renderCourt();
  refreshUI();
  setToast(`✓ #${p.playerNumber} — ${result} (${sign}) (saving…)`, false);
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
      setToast(`✓ #${p.playerNumber} — ${result} (${sign})`, false);
      refreshUI();
      persistState();
    })
    .catch((err) => {
      if (err.confirmed) {
        adjustTally(p.playerNumber, -1, -pts);
        renderCourt();
        setToast(`⚠ #${p.playerNumber} failed to save: ${err.message}`, true);
      } else {
        setToast(`⚠ #${p.playerNumber}: couldn't confirm save (${err.message}). Check the Log sheet before re-scoring.`, true);
      }
      persistState();
    });
}

function performUndo() {
  if (!undoStack.length) return;
  const undone = undoStack.shift();

  adjustTally(undone.playerNumber, -1, -undone.points);
  if (findOnCourtSide(undone.playerNumber)) activePlayerNumber = undone.playerNumber;
  renderCourt();
  refreshUI();
  setToast(`↩ Undoing #${undone.playerNumber}…`, false);
  persistState();

  postUndo({ coach: undone.coach, rowNumber: undone.rowNumber })
    .then(() => {
      setToast(`↩ Undid #${undone.playerNumber}`, false);
    })
    .catch((err) => {
      if (err.confirmed) {
        undoStack.unshift(undone);
        adjustTally(undone.playerNumber, 1, undone.points);
        renderCourt();
        refreshUI();
        setToast(`Couldn't undo: ${err.message}`, true);
      } else {
        setToast(`Couldn't confirm undo (${err.message}). Check the Log sheet.`, true);
      }
      persistState();
    });
}

init();
