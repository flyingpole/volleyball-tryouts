const SKILL = "Serving";
const GROUP_SIZE = 10;

let roster = [];
let visiblePlayers = []; // up to 10 roster entries in the loaded number range, ascending
let activeIndex = null; // index into visiblePlayers
let result = null; // "missed" | "under30" | "30to35" | "over35" | null
let hitTarget = false;
const sessionTallies = {}; // playerNumber -> { attempts, points }
const sessionLog = [];

const els = {
  banner: document.getElementById("configBanner"),
  coachSelect: document.getElementById("coachSelect"),
  startNumberInput: document.getElementById("startNumberInput"),
  loadGroupBtn: document.getElementById("loadGroupBtn"),
  playerRows: document.getElementById("playerRows"),
  activePlayerLabel: document.getElementById("activePlayerLabel"),
  btnMissed: document.getElementById("btnMissed"),
  btnV1: document.getElementById("btnV1"),
  btnV2: document.getElementById("btnV2"),
  btnV3: document.getElementById("btnV3"),
  btnHitTarget: document.getElementById("btnHitTarget"),
  scoreNum: document.getElementById("scoreNum"),
  logBtn: document.getElementById("logBtn"),
  toast: document.getElementById("toast"),
  sessionList: document.getElementById("sessionList"),
};

const resultButtons = [els.btnMissed, els.btnV1, els.btnV2, els.btnV3];
const BASE_POINTS = { missed: 0, under30: 1, "30to35": 2, over35: 3 };

function computeScore() {
  if (!result || result === "missed") return 0;
  return BASE_POINTS[result] + (hitTarget ? 1 : 0);
}

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
  result = null;
  hitTarget = false;
  renderRows();
  refreshUI();
}

function refreshUI() {
  const p = activePlayer();
  els.activePlayerLabel.textContent = p
    ? `Scoring #${p.playerNumber} — ${p.playerName || "(unnamed)"}`
    : (visiblePlayers.length ? "Tap a player above" : "Load a player group above");

  resultButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.result === result);
  });

  const madeIt = result && result !== "missed";
  els.btnHitTarget.disabled = !madeIt;
  els.btnHitTarget.classList.toggle("active", madeIt && hitTarget);

  els.scoreNum.textContent = computeScore();
  els.logBtn.disabled = !p || !result || !isScriptConfigured();
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
  result = null;
  hitTarget = false;
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

resultButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!activePlayer()) return;
    result = result === btn.dataset.result ? null : btn.dataset.result;
    if (!result || result === "missed") hitTarget = false;
    refreshUI();
  });
});

els.btnHitTarget.addEventListener("click", () => {
  if (els.btnHitTarget.disabled) return;
  hitTarget = !hitTarget;
  refreshUI();
});

els.logBtn.addEventListener("click", async () => {
  const p = activePlayer();
  if (!p || !result) return;
  const coach = els.coachSelect.value;
  if (!coach) {
    setToast("Select your coach name first.", true);
    return;
  }

  const payload = {
    coach,
    playerNumber: p.playerNumber,
    playerName: p.playerName,
    skill: SKILL,
    result,
    hitTarget,
  };

  els.logBtn.disabled = true;
  try {
    const response = await postAttempt(payload);
    const pts = response.points ?? computeScore();

    const prev = sessionTallies[p.playerNumber] || { attempts: 0, points: 0 };
    sessionTallies[p.playerNumber] = { attempts: prev.attempts + 1, points: prev.points + pts };

    sessionLog.unshift({ ...p, points: pts, time: new Date().toLocaleTimeString() });
    renderSessionLog();
    setToast(`✓ Logged: #${p.playerNumber} ${p.playerName} — ${pts} pts`, false);

    // Players serve in numerical order, so move on to the next one automatically.
    if (visiblePlayers.length) {
      activeIndex = (activeIndex + 1) % visiblePlayers.length;
    }
    result = null;
    hitTarget = false;
    renderRows();
    refreshUI();
  } catch (err) {
    setToast(`Failed to log attempt: ${err.message}`, true);
    refreshUI();
  }
});

function renderSessionLog() {
  els.sessionList.innerHTML = "";
  sessionLog.slice(0, 20).forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.time} — #${entry.playerNumber} ${entry.playerName}: ${entry.points} pts`;
    els.sessionList.appendChild(li);
  });
}

init();
