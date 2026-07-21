// Volleyball Tryouts — Apps Script backend.
// This file is version-controlled for reference; the copy that actually runs
// lives in the bound Google Sheet's Apps Script editor (Extensions > Apps Script).
// See README.md for deployment steps.

const SHEETS = {
  ROSTER: "Roster",
  LOG: "Log",
  SUMMARY: "Summary Sheet",
  SERVING_RANKINGS: "Serving Rankings",
};

// Fixed list of coaches/evaluators — each gets their own tab, and the app's
// coach picker is a dropdown built from this list (no free-text typing).
// Add or rename names here, then re-run setupSheet() to build/rebuild tabs.
const COACHES = [
  "Darin", "Karen", "Morgan", "Tahya", "David",
  "Evaluator 1", "Evaluator 2", "Evaluator 3",
];

const RESERVED_SHEETS = Object.values(SHEETS);

// Skill columns on Summary Sheet / each coach tab, in sheet order (E-I).
// Add an entry here (and a matching *Rankings sheet) when a new skill's
// scoring UI ships — Summary Sheet/coach tab formulas pick it up automatically.
const SKILLS = [
  { name: "Serving", col: "E" },
  { name: "Passing", col: "F" },
  { name: "Attacking Pin", col: "G" },
  { name: "Attacking MB", col: "H" },
  { name: "Blocking", col: "I" },
];

// Dropdown choices for the position filter on ranking sheets. Positions is a
// free-text field on Roster (e.g. "OH, MB"), so this list is just for the
// filter UI — edit it (or the data validation on each Rankings sheet) if
// your team uses different position codes.
const POSITION_FILTER_OPTIONS = ["OH", "OPP", "MB", "S", "D"];

const ROSTER_MAX_ROWS = 250; // headroom for players; raise if a tryout group is bigger

// "Needs more looks" thresholds for the rankings tabs — tune freely.
const FLAG_MIN_ATTEMPTS = 3;
const FLAG_MIN_COACHES = 2;
const FLAG_SCORE_GAP = 0.3;

// ---------------------------------------------------------------------------
// One-time setup. Run this manually from the Apps Script editor after pasting
// this file in. Safe to re-run (it rebuilds every computed tab from scratch —
// only Roster's player data is left alone).
// ---------------------------------------------------------------------------
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupRosterSheet(ss);
  setupLogSheet(ss);
  buildAggregateSheet(getOrCreateSheet(ss, SHEETS.SUMMARY), null);
  COACHES.forEach((coach) => {
    buildAggregateSheet(getOrCreateSheet(ss, coach), coach);
  });
  buildSkillRankingsSheet(getOrCreateSheet(ss, SHEETS.SERVING_RANKINGS), "Serving", "E");
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupRosterSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.ROSTER);
  if (sheet.getRange(1, 1).getValue() !== "") return; // don't clobber existing roster data
  const headers = ["Player #", "Name", "Positions", "Grade"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function setupLogSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.LOG);
  const headers = [
    "Timestamp", "Coach", "Player #", "Player Name", "Skill",
    "Result", "Hit Target", "Points", "Deleted",
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

// Builds (or rebuilds) a per-player summary sheet: the Summary Sheet when
// coachFilter is null (aggregates every coach), or a single coach's tab when
// coachFilter is that coach's name. Every cell is a plain formula tied to a
// specific row, so the sheet stays live as the Log tab grows — no script
// recompute needed. Columns: Player #, Name, Positions, Grade, then one
// avg-score column per skill in SKILLS.
function buildAggregateSheet(sheet, coachFilter) {
  sheet.clear();
  const headers = ["Player #", "Name", "Positions", "Grade"].concat(SKILLS.map((s) => s.name));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);

  const startRow = 2;
  const coachCriteria = coachFilter
    ? `,Log!$B:$B,"${coachFilter.replace(/"/g, '""')}"`
    : "";

  const baseCols = [[], [], [], []]; // Player #, Name, Positions, Grade
  const skillCols = SKILLS.map(() => []);

  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = startRow + i;
    baseCols[0].push([`=IF(Roster!A${r}="","",Roster!A${r})`]);
    baseCols[1].push([`=IF(Roster!A${r}="","",Roster!B${r})`]);
    baseCols[2].push([`=IF(Roster!A${r}="","",Roster!C${r})`]);
    baseCols[3].push([`=IF(Roster!A${r}="","",Roster!D${r})`]);
    SKILLS.forEach((skill, idx) => {
      skillCols[idx].push([`=IF($A${r}="","",IFERROR(AVERAGEIFS(Log!$H:$H,Log!$C:$C,$A${r},Log!$E:$E,"${skill.name}",Log!$I:$I,"<>TRUE"${coachCriteria}),""))`]);
    });
  }

  baseCols.forEach((col, idx) => {
    sheet.getRange(startRow, idx + 1, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
  skillCols.forEach((col, idx) => {
    sheet.getRange(startRow, 5 + idx, ROSTER_MAX_ROWS, 1).setFormulas(col);
  });
}

// Builds a ranking/triage sheet for one skill: sorted by that skill's avg
// score (optionally filtered by position), with attempt/coach counts and a
// "needs more looks" flag. Call this again with a new skill name + Summary
// Sheet column letter (see SKILLS) when a new skill's evaluation UI ships.
function buildSkillRankingsSheet(sheet, skillName, summaryColLetter) {
  sheet.clear();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITION_FILTER_OPTIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Name", "Positions", "Grade", `${skillName} Avg`, "Attempts", "Coaches", "Flag"];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  const select = `A,B,C,D,${summaryColLetter}`;
  sheet.getRange("B4").setFormula(
    `=IFERROR(QUERY('${SHEETS.SUMMARY}'!$A$2:$I$${lastRow}, IF($B$1="All", "select ${select} where A is not null order by ${summaryColLetter} desc", "select ${select} where A is not null and C contains '"&$B$1&"' order by ${summaryColLetter} desc"), 0), "")`
  );

  const colA = [], colG = [], colH = [], colI = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colG.push([`=IF(B${r}="","",COUNTIFS(Log!$C:$C,B${r},Log!$E:$E,"${skillName}",Log!$I:$I,"<>TRUE"))`]);
    colH.push([`=IF(B${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=B${r},Log!$E:$E="${skillName}",Log!$I:$I<>true))),0))`]);
    colI.push([`=IF(B${r}="","",IFERROR(IF(OR(G${r}<${FLAG_MIN_ATTEMPTS},H${r}<${FLAG_MIN_COACHES},ABS(F${r}-F${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 7, ROSTER_MAX_ROWS, 1).setFormulas(colG);
  sheet.getRange(4, 8, ROSTER_MAX_ROWS, 1).setFormulas(colH);
  sheet.getRange(4, 9, ROSTER_MAX_ROWS, 1).setFormulas(colI);
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------
function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === "roster") return jsonResponse({ players: readRoster(ss) });
  if (action === "coaches") return jsonResponse({ coaches: COACHES });
  return jsonResponse({ status: "ok" });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === "undo") return handleUndo(ss, body);
    return handleLogAttempt(ss, body);
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function handleLogAttempt(ss, body) {
  const coach = String(body.coach || "").trim();
  const skill = String(body.skill || "").trim();
  const playerNumber = String(body.playerNumber || "").trim();
  const result = String(body.result || "").trim(); // "Missed" | "Slow" | "Average" | "Fast"
  if (!coach || !skill || !playerNumber || !result) {
    throw new Error("Missing coach, skill, playerNumber, or result");
  }
  if (RESERVED_SHEETS.indexOf(coach) !== -1) {
    throw new Error(`Coach name "${coach}" conflicts with a reserved sheet name`);
  }

  const hitTarget = !!body.hitTarget;
  const points = computeServingScore(result, hitTarget);

  // Multiple coaches submit concurrently during tryouts, so the append +
  // "which row did I just write" read has to be atomic across requests.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let playerName, rowNumber;
  try {
    playerName = ensureRosterRow(ss, playerNumber, body.playerName || "");
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    logSheet.appendRow([
      new Date(), coach, playerNumber, playerName, skill,
      result, hitTarget, points, false,
    ]);
    rowNumber = logSheet.getLastRow();
  } finally {
    lock.releaseLock();
  }

  try {
    // Coaches normally already have a tab from setupSheet(); this is just a
    // safety net if a name outside the COACHES list ever posts an attempt.
    ensureCoachSheet(ss, coach);
  } catch (err) {
    // Non-fatal — the attempt above is already safely logged. A concurrent
    // request may have just created this same tab.
  }

  return jsonResponse({ success: true, points, rowNumber });
}

// Marks one Log row as Deleted by its exact row number, only if it still
// belongs to the requesting coach and hasn't already been undone. This is a
// soft delete (flag a column, never shift rows) on purpose: coaches submit
// concurrently, and an actual deleteRow() would shift every row below it,
// silently invalidating any row numbers other in-flight requests are holding
// onto for their own undo. Summary Sheet / coach tabs / Rankings formulas all
// exclude Deleted=TRUE rows, so this recomputes automatically.
function handleUndo(ss, body) {
  const coach = String(body.coach || "").trim();
  const rowNumber = parseInt(body.rowNumber, 10);
  if (!coach || !Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Missing coach or rowNumber for undo");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const logSheet = ss.getSheetByName(SHEETS.LOG);
    if (rowNumber > logSheet.getLastRow()) {
      throw new Error("That attempt is no longer there to undo");
    }
    const row = logSheet.getRange(rowNumber, 1, 1, 9).getValues()[0];
    const [, rowCoach, playerNumber, playerName, , , , points, deleted] = row;
    if (String(rowCoach) !== coach) {
      throw new Error("That attempt no longer matches — can't undo");
    }
    if (deleted === true) {
      throw new Error("That attempt was already undone");
    }
    logSheet.getRange(rowNumber, 9).setValue(true);
    return jsonResponse({ success: true, playerNumber, playerName, points });
  } finally {
    lock.releaseLock();
  }
}

// Missed: 0 points (still logged as an attempt for stats).
// Otherwise: velocity tier (Slow <30mph, Average 30-35mph, Fast >35mph) sets
// the base score, +1 more if the target was hit.
function computeServingScore(result, hitTarget) {
  if (result === "Missed") return 0;
  let score;
  if (result === "Slow") score = 1;
  else if (result === "Average") score = 2;
  else if (result === "Fast") score = 3;
  else throw new Error(`Unknown result "${result}"`);
  if (hitTarget) score += 1;
  return score;
}

function ensureCoachSheet(ss, coach) {
  if (ss.getSheetByName(coach)) return;
  buildAggregateSheet(ss.insertSheet(coach), coach);
}

// Returns the player's name, adding a bare roster row first if this player
// number hasn't been seen yet (e.g. a walk-on not pre-loaded by the admin).
function ensureRosterRow(ss, playerNumber, fallbackName) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const numbers = sheet.getRange(2, 1, ROSTER_MAX_ROWS, 1).getValues();
  for (let i = 0; i < numbers.length; i++) {
    const cell = numbers[i][0];
    if (String(cell) === playerNumber) {
      const name = sheet.getRange(2 + i, 2).getValue();
      return name || fallbackName;
    }
    if (cell === "" || cell === null) {
      sheet.getRange(2 + i, 1, 1, 2).setValues([[playerNumber, fallbackName]]);
      return fallbackName;
    }
  }
  // Roster range is full (more than ROSTER_MAX_ROWS players) — append past it.
  // Raise ROSTER_MAX_ROWS and re-run setupSheet() if this happens.
  sheet.appendRow([playerNumber, fallbackName]);
  return fallbackName;
}

function readRoster(ss) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const values = sheet.getRange(2, 1, ROSTER_MAX_ROWS, 4).getValues();
  const players = [];
  values.forEach(([playerNumber, playerName, positions, grade]) => {
    if (playerNumber === "" || playerNumber === null) return;
    players.push({ playerNumber, playerName, positions: positions || "", grade: grade || "" });
  });
  return players;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
