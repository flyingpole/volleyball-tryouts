// Volleyball Tryouts — Apps Script backend.
// This file is version-controlled for reference; the copy that actually runs
// lives in the bound Google Sheet's Apps Script editor (Extensions > Apps Script).
// See README.md for deployment steps.

const SHEETS = {
  ROSTER: "Roster",
  LOG: "Log",
  MASTER: "Master",
  SERVING_RANKINGS: "Serving Rankings",
};
const RESERVED_SHEETS = Object.values(SHEETS);

const POSITIONS = ["OH", "OPP", "MB", "S", "D"];
const ROSTER_MAX_ROWS = 250; // headroom for players; raise if a tryout group is bigger

// "Needs more looks" thresholds for the rankings tab — tune freely.
const FLAG_MIN_ATTEMPTS = 3;
const FLAG_MIN_COACHES = 2;
const FLAG_SCORE_GAP = 0.3;

// ---------------------------------------------------------------------------
// One-time setup. Run this manually from the Apps Script editor after pasting
// this file in. Safe to re-run (it rebuilds the computed tabs from scratch).
// ---------------------------------------------------------------------------
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupRosterSheet(ss);
  setupLogSheet(ss);
  buildAggregateSheet(getOrCreateSheet(ss, SHEETS.MASTER), null);
  buildServingRankingsSheet(getOrCreateSheet(ss, SHEETS.SERVING_RANKINGS));
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupRosterSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.ROSTER);
  const headers = ["Player #", "Player Name", "OH", "OPP", "MB", "S", "D"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  const checkboxRange = sheet.getRange(2, 3, ROSTER_MAX_ROWS, POSITIONS.length);
  checkboxRange.insertCheckboxes();
}

function setupLogSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.LOG);
  const headers = [
    "Timestamp", "Coach", "Player #", "Player Name", "Skill",
    "In Zone", "Hit Spot", "Velocity Tier", "Points",
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

// Builds (or rebuilds) a per-player summary sheet: Master when coachFilter is
// null (aggregates every coach), or a single coach's tab when coachFilter is
// that coach's name. Every cell is a plain formula tied to a specific row, so
// the sheet stays live as the Log tab grows — no script recompute needed.
function buildAggregateSheet(sheet, coachFilter) {
  sheet.clear();
  const headers = coachFilter
    ? ["Player #", "Player Name", "Positions", "Serving Avg", "Serving Attempts"]
    : ["Player #", "Player Name", "Positions", "Serving Avg", "Serving Attempts", "Coaches Evaluated"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);

  const startRow = 2;
  const colA = [], colB = [], colC = [], colD = [], colE = [], colF = [];
  const coachCriteria = coachFilter
    ? `,Log!$B:$B,"${coachFilter.replace(/"/g, '""')}"`
    : "";

  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = startRow + i;
    colA.push([`=IF(Roster!A${r}="","",Roster!A${r})`]);
    colB.push([`=IF(Roster!A${r}="","",Roster!B${r})`]);
    colC.push([`=IF(Roster!A${r}="","",TRIM(IF(Roster!C${r},"OH ","")&IF(Roster!D${r},"OPP ","")&IF(Roster!E${r},"MB ","")&IF(Roster!F${r},"S ","")&IF(Roster!G${r},"D ","")))`]);
    colD.push([`=IF($A${r}="","",IFERROR(AVERAGEIFS(Log!$I:$I,Log!$C:$C,$A${r},Log!$E:$E,"Serving"${coachCriteria}),""))`]);
    colE.push([`=IF($A${r}="","",COUNTIFS(Log!$C:$C,$A${r},Log!$E:$E,"Serving"${coachCriteria}))`]);
    if (!coachFilter) {
      colF.push([`=IF($A${r}="","",IFERROR(COUNTA(UNIQUE(FILTER(Log!$B:$B,Log!$C:$C=$A${r},Log!$E:$E="Serving"))),0))`]);
    }
  }

  sheet.getRange(startRow, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(startRow, 2, ROSTER_MAX_ROWS, 1).setFormulas(colB);
  sheet.getRange(startRow, 3, ROSTER_MAX_ROWS, 1).setFormulas(colC);
  sheet.getRange(startRow, 4, ROSTER_MAX_ROWS, 1).setFormulas(colD);
  sheet.getRange(startRow, 5, ROSTER_MAX_ROWS, 1).setFormulas(colE);
  if (!coachFilter) {
    sheet.getRange(startRow, 6, ROSTER_MAX_ROWS, 1).setFormulas(colF);
  }
}

function buildServingRankingsSheet(sheet) {
  sheet.clear();
  sheet.getRange("A1").setValue("Position filter:").setFontWeight("bold");
  sheet.getRange("B1").setValue("All");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["All"].concat(POSITIONS), true)
    .build();
  sheet.getRange("B1").setDataValidation(rule);

  const headers = ["Rank", "Player #", "Player Name", "Positions", "Serving Avg", "Attempts", "Coaches", "Flag"];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(3);

  const lastRow = 1 + ROSTER_MAX_ROWS;
  sheet.getRange("B4").setFormula(
    `=IFERROR(QUERY(Master!$A$2:$F$${lastRow}, IF($B$1="All", "select A,B,C,D,E,F where A is not null order by D desc", "select A,B,C,D,E,F where A is not null and C contains '"&$B$1&"' order by D desc"), 0), "")`
  );

  const colA = [], colH = [];
  for (let i = 0; i < ROSTER_MAX_ROWS; i++) {
    const r = 4 + i;
    colA.push([`=IF(B${r}="","",ROW()-3)`]);
    colH.push([`=IF(B${r}="","",IFERROR(IF(OR(F${r}<${FLAG_MIN_ATTEMPTS},G${r}<${FLAG_MIN_COACHES},ABS(E${r}-E${r + 1})<${FLAG_SCORE_GAP}),"⚠ Needs more looks",""),""))`]);
  }
  sheet.getRange(4, 1, ROSTER_MAX_ROWS, 1).setFormulas(colA);
  sheet.getRange(4, 8, ROSTER_MAX_ROWS, 1).setFormulas(colH);
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------
function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === "roster") return jsonResponse({ players: readRoster(ss) });
  if (action === "coaches") return jsonResponse({ coaches: listCoachSheets(ss) });
  return jsonResponse({ status: "ok" });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const coach = String(body.coach || "").trim();
    const skill = String(body.skill || "").trim();
    const playerNumber = String(body.playerNumber || "").trim();
    if (!coach || !skill || !playerNumber) {
      throw new Error("Missing coach, skill, or playerNumber");
    }
    if (RESERVED_SHEETS.indexOf(coach) !== -1) {
      throw new Error(`Coach name "${coach}" conflicts with a reserved sheet name`);
    }

    const inZone = !!body.inZone;
    const hitSpot = !!body.hitSpot;
    const velocityTier = body.velocityTier || "";
    const points = computeServingScore(inZone, hitSpot, velocityTier);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const playerName = ensureRosterRow(ss, playerNumber, body.playerName || "");

    ss.getSheetByName(SHEETS.LOG).appendRow([
      new Date(), coach, playerNumber, playerName, skill,
      inZone, hitSpot, velocityTier, points,
    ]);

    ensureCoachSheet(ss, coach);

    return jsonResponse({ success: true, points });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function computeServingScore(inZone, hitSpot, velocityTier) {
  if (!inZone) return 0;
  let score = 1;
  if (hitSpot) score += 1;
  if (velocityTier === "under30") score += 1;
  else if (velocityTier === "30to35") score += 2;
  else if (velocityTier === "over35") score += 3;
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
  const values = sheet.getRange(2, 1, ROSTER_MAX_ROWS, 2 + POSITIONS.length).getValues();
  const players = [];
  values.forEach((row) => {
    const [playerNumber, playerName, ...flags] = row;
    if (playerNumber === "" || playerNumber === null) return;
    const positions = POSITIONS.filter((_, idx) => flags[idx] === true);
    players.push({ playerNumber, playerName, positions });
  });
  return players;
}

function listCoachSheets(ss) {
  return ss.getSheets()
    .map((s) => s.getName())
    .filter((name) => RESERVED_SHEETS.indexOf(name) === -1);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
