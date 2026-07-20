const SKILL = "Serving";

let roster = [];
let selectedPlayer = null; // { playerNumber, playerName }
let result = null; // "missed" | "under30" | "30to35" | "over35" | null
let hitTarget = false;
const sessionLog = [];

const els = {
  banner: document.getElementById("configBanner"),
  coachName: document.getElementById("coachName"),
  saveCoachBtn: document.getElementById("saveCoachBtn"),
  playerInput: document.getElementById("playerInput"),
  playerList: document.getElementById("playerList"),
  playerInfo: document.getElementById("playerInfo"),
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

function refreshUI() {
  resultButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.result === result);
  });

  const madeIt = result && result !== "missed";
  els.btnHitTarget.disabled = !madeIt;
  els.btnHitTarget.classList.toggle("active", madeIt && hitTarget);

  els.scoreNum.textContent = computeScore();
  els.logBtn.disabled = !selectedPlayer || !result || !isScriptConfigured();
}

function resetAttempt() {
  result = null;
  hitTarget = false;
  refreshUI();
}

function setToast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast " + (isError ? "error" : "success");
}

function findPlayerFromInputValue(value) {
  const match = value.match(/^(\d+)\s/);
  if (!match) return null;
  const num = match[1];
  return roster.find((p) => String(p.playerNumber) === num) || null;
}

function populatePlayerList() {
  els.playerList.innerHTML = "";
  roster.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = `${p.playerNumber} — ${p.playerName}`;
    els.playerList.appendChild(opt);
  });
}

async function init() {
  els.coachName.value = getSavedCoach();

  if (!isScriptConfigured()) {
    els.banner.hidden = false;
    refreshUI();
    return;
  }

  try {
    roster = await fetchRoster();
    populatePlayerList();
  } catch (err) {
    setToast(`Couldn't load roster: ${err.message}`, true);
  }
  refreshUI();
}

els.saveCoachBtn.addEventListener("click", () => {
  saveCoach(els.coachName.value);
  setToast("Coach name saved.", false);
});

els.playerInput.addEventListener("input", () => {
  const p = findPlayerFromInputValue(els.playerInput.value);
  selectedPlayer = p;
  els.playerInfo.textContent = p
    ? `Grade ${p.grade || "—"} · Positions: ${p.positions || "—"}`
    : "";
  refreshUI();
});

resultButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
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
  if (!selectedPlayer || !result) return;
  const coach = els.coachName.value.trim();
  if (!coach) {
    setToast("Enter your coach name first.", true);
    return;
  }
  saveCoach(coach);

  const payload = {
    coach,
    playerNumber: selectedPlayer.playerNumber,
    playerName: selectedPlayer.playerName,
    skill: SKILL,
    result,
    hitTarget,
  };

  els.logBtn.disabled = true;
  try {
    const response = await postAttempt(payload);
    const pts = response.points ?? computeScore();
    setToast(`✓ Logged: #${selectedPlayer.playerNumber} ${selectedPlayer.playerName} — ${pts} pts`, false);
    sessionLog.unshift({ ...selectedPlayer, points: pts, time: new Date().toLocaleTimeString() });
    renderSessionLog();
    resetAttempt();
  } catch (err) {
    setToast(`Failed to log attempt: ${err.message}`, true);
  } finally {
    els.logBtn.disabled = !selectedPlayer || !result || !isScriptConfigured();
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
