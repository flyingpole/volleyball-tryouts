const SKILL = "Serving";

let roster = [];
let selectedPlayer = null; // { playerNumber, playerName }
let inZone = false;
let hitSpot = false;
let velocityTier = null; // "under30" | "30to35" | "over35" | null
const sessionLog = [];

const els = {
  banner: document.getElementById("configBanner"),
  coachName: document.getElementById("coachName"),
  saveCoachBtn: document.getElementById("saveCoachBtn"),
  playerInput: document.getElementById("playerInput"),
  playerList: document.getElementById("playerList"),
  playerInfo: document.getElementById("playerInfo"),
  btnIn: document.getElementById("btnIn"),
  btnSpot: document.getElementById("btnSpot"),
  btnV1: document.getElementById("btnV1"),
  btnV2: document.getElementById("btnV2"),
  btnV3: document.getElementById("btnV3"),
  scoreNum: document.getElementById("scoreNum"),
  logBtn: document.getElementById("logBtn"),
  toast: document.getElementById("toast"),
  sessionList: document.getElementById("sessionList"),
};

const velocityButtons = [els.btnV1, els.btnV2, els.btnV3];

function computeScore() {
  if (!inZone) return 0;
  let score = 1;
  if (hitSpot) score += 1;
  if (velocityTier === "under30") score += 1;
  else if (velocityTier === "30to35") score += 2;
  else if (velocityTier === "over35") score += 3;
  return score;
}

function refreshUI() {
  els.btnIn.classList.toggle("active", inZone);
  els.btnSpot.classList.toggle("active", hitSpot);
  els.btnSpot.disabled = !inZone;

  velocityButtons.forEach((btn) => {
    btn.disabled = !inZone;
    btn.classList.toggle("active", inZone && btn.dataset.tier === velocityTier);
  });

  els.scoreNum.textContent = computeScore();
  els.logBtn.disabled = !selectedPlayer || !isScriptConfigured();
}

function resetAttempt() {
  inZone = false;
  hitSpot = false;
  velocityTier = null;
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
    ? `Positions: ${(p.positions || []).join(", ") || "—"}`
    : "";
  refreshUI();
});

els.btnIn.addEventListener("click", () => {
  inZone = !inZone;
  if (!inZone) {
    hitSpot = false;
    velocityTier = null;
  }
  refreshUI();
});

els.btnSpot.addEventListener("click", () => {
  if (!inZone) return;
  hitSpot = !hitSpot;
  refreshUI();
});

velocityButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!inZone) return;
    velocityTier = velocityTier === btn.dataset.tier ? null : btn.dataset.tier;
    refreshUI();
  });
});

els.logBtn.addEventListener("click", async () => {
  if (!selectedPlayer) return;
  const coach = els.coachName.value.trim();
  if (!coach) {
    setToast("Enter your coach name first.", true);
    return;
  }
  saveCoach(coach);

  const payload = {
    coach,
    playerNumber: selectedPlayer.playerNumber,
    skill: SKILL,
    inZone,
    hitSpot,
    velocityTier,
  };

  els.logBtn.disabled = true;
  try {
    const result = await postAttempt(payload);
    const pts = result.points ?? computeScore();
    setToast(`✓ Logged: #${selectedPlayer.playerNumber} ${selectedPlayer.playerName} — ${pts} pts`, false);
    sessionLog.unshift({ ...selectedPlayer, points: pts, time: new Date().toLocaleTimeString() });
    renderSessionLog();
    resetAttempt();
  } catch (err) {
    setToast(`Failed to log attempt: ${err.message}`, true);
  } finally {
    els.logBtn.disabled = !selectedPlayer || !isScriptConfigured();
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
