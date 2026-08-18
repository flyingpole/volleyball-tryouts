const SKILL = "Attacking";
const GROUP_SIZE = 10;
const MAX_UNDO = 5;
const JOG_ITEM_HEIGHT = 36;
const STATE_KEY = "vbtryouts_attacking_state";
const BASE_POINTS = { "+": 1, ".": 0, "-": -1 };

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let currentStart = null; // lowest player number in the current 10-player window
let sessionTallies = {}; // playerNumber -> { attempts, points }
let undoStack = []; // most-recent-first, confirmed (server-acknowledged) attempts only, capped at MAX_UNDO
let jogSettleTimer = null;
let suppressJogSettle = false; // true while we're programmatically scrolling the jog wheel, so that scroll doesn't get misread as the user hunting for a player
const SKILL_STATUS_POLL_MS = 45000;
let skillStatus = {}; // playerNumber -> { attempts } — live, all-coaches count from the server (see fetchSkillStatus in app.js), so a different coach's already-logged attempts show up here too

function persistState() {
  saveJSON(STATE_KEY, {
    start: currentStart,
    activePlayerNumber: activePlayer() ? activePlayer().playerNumber : undefined,
    tallies: sessionTallies,
    undoStack,
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
};

const scoreButtons = [
  document.getElementById("btnKill"),
  document.getElementById("btnAttempt"),
  document.getElementById("btnError"),
];

function activePlayer() {
  return activeIndex === null ? null : visiblePlayers[activeIndex];
}

// Prefers the live, all-coaches count (skillStatus) over this device's own
// local tally — the local one only exists to show an instant number right
// after this device's own tap, before the next server poll/refresh
// reconciles it (see submitAttempt/performUndo).
function liveAttempts(playerNumber) {
  const live = skillStatus[playerNumber];
  if (live) return live.attempts;
  const local = sessionTallies[playerNumber];
  return local ? local.attempts : null;
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

    const attempts = liveAttempts(p.playerNumber);
    const tallySpan = document.createElement("span");
    tallySpan.className = "tally";
    tallySpan.textContent = attempts ? `${attempts} att` : "";
    btn.appendChild(tallySpan);

    btn.addEventListener("click", () => selectPlayer(idx));
    els.playerRows.appendChild(btn);
  });
}

// Polls the server for a live, all-coaches attempt count per player, so a
// different coach's submission (from a different device) shows up here
// without a manual reload.
async function refreshSkillStatus() {
  try {
    skillStatus = await fetchSkillStatus(SKILL);
  } catch (err) {
    return; // transient failure — keep showing whatever we last had
  }
  renderRows();
  refreshUI();
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
  const attempts = p ? liveAttempts(p.playerNumber) : null;
  els.activePlayerLabel.textContent = p
    ? `#${p.playerNumber} ${p.playerName || "(unnamed)"}${attempts ? ` — ${attempts} att` : ""}`
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

  resumeQueue(); // drain anything left over from a previous page load, independent of roster/coach data below

  try {
    const [coaches, players, status] = await Promise.all([
      fetchCoaches(), fetchRoster(), fetchSkillStatus(SKILL).catch(() => ({})),
    ]);
    coaches.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.coachSelect.appendChild(opt);
    });
    const savedCoach = getSavedCoach();
    if (savedCoach && coaches.includes(savedCoach)) els.coachSelect.value = savedCoach;
    updateHeaderCoach(els.coachSelect.value);

    skillStatus = status;
    setInterval(refreshSkillStatus, SKILL_STATUS_POLL_MS);

    roster = players;
    renderPlayerJog();

    const savedState = loadJSON(STATE_KEY, null);
    if (savedState && savedState.tallies) sessionTallies = savedState.tallies;
    if (savedState && Array.isArray(savedState.undoStack)) undoStack = savedState.undoStack;

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

// Optimistically adjusts the live (all-coaches) count so this device's own
// tap/undo shows up instantly, ahead of the next refreshSkillStatus() call
// reconciling it with the server's actual value.
function bumpLiveAttempts(playerNumber, delta) {
  const current = skillStatus[playerNumber] ? skillStatus[playerNumber].attempts : 0;
  skillStatus[playerNumber] = { attempts: Math.max(0, current + delta) };
}

// Every button IS the score (Kill +1, Attempt 0, Error -1), so there's no
// pending selection step — tapping a button logs immediately. Updates state
// and the screen right away, confirms with the server in the background, and
// rolls back only if the server explicitly rejects it (see app.js postJSON).
// The active player does NOT auto-advance: hitters take several reps in a
// row here, so the coach stays on the same player until they tap a
// different row themselves.
function submitAttempt(result) {
  const p = activePlayer();
  if (!p) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const pts = BASE_POINTS[result];

  adjustTally(p.playerNumber, 1, pts);
  bumpLiveAttempts(p.playerNumber, 1);
  renderRows();
  refreshUI();
  setToast(`✓ #${p.playerNumber} ${p.playerName} — "${result}" (saving…)`, false);
  persistState();

  enqueueAttempt({ coach, playerNumber: p.playerNumber, playerName: p.playerName, skill: SKILL, result }, {
    onConfirmed: (response) => {
      pushUndoEntry({
        rowNumber: response.rowNumber,
        coach,
        playerNumber: p.playerNumber,
        playerName: p.playerName,
        points: response.points ?? pts,
      });
      setToast(`✓ #${p.playerNumber} ${p.playerName} — "${result}"`, false);
      refreshUI();
      persistState();
      refreshSkillStatus(); // reconcile with the server's actual count — another coach may have logged this same player concurrently
    },
    onRejected: (err) => {
      adjustTally(p.playerNumber, -1, -pts);
      bumpLiveAttempts(p.playerNumber, -1);
      renderRows();
      setToast(`⚠ #${p.playerNumber} ${p.playerName} failed to save: ${err.message}`, true);
      persistState();
    },
  });
}

function performUndo() {
  if (!undoStack.length) return;
  const undone = undoStack.shift();

  adjustTally(undone.playerNumber, -1, -undone.points);
  bumpLiveAttempts(undone.playerNumber, -1);
  const idx = visiblePlayers.findIndex((p) => String(p.playerNumber) === String(undone.playerNumber));
  if (idx !== -1) activeIndex = idx;
  renderRows();
  refreshUI();
  setToast(`↩ Undoing #${undone.playerNumber} ${undone.playerName}…`, false);
  persistState();

  enqueueUndo({ coach: undone.coach, rowNumber: undone.rowNumber }, {
    onConfirmed: () => {
      setToast(`↩ Undid #${undone.playerNumber} ${undone.playerName} — ${undone.points} pts`, false);
      refreshSkillStatus();
    },
    onRejected: (err) => {
      undoStack.unshift(undone);
      adjustTally(undone.playerNumber, 1, undone.points);
      bumpLiveAttempts(undone.playerNumber, 1);
      renderRows();
      refreshUI();
      setToast(`Couldn't undo: ${err.message}`, true);
      persistState();
    },
  });
}

init();
