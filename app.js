// Shared helpers used across skill pages.

const COACH_KEY = "vbtryouts_coach";

function isScriptConfigured() {
  return (
    typeof CONFIG !== "undefined" &&
    CONFIG.SCRIPT_URL &&
    !CONFIG.SCRIPT_URL.startsWith("PASTE_")
  );
}

// Wrapped in try/catch: private-browsing modes can throw on localStorage
// access instead of just no-opping, which would otherwise take the whole
// page down.
function getSavedCoach() {
  try {
    return localStorage.getItem(COACH_KEY) || "";
  } catch (err) {
    return "";
  }
}

function saveCoach(name) {
  try {
    localStorage.setItem(COACH_KEY, name.trim());
  } catch (err) {
    // Ignore — nothing to persist to.
  }
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Ignore — nothing to persist to.
  }
}

async function fetchRoster() {
  const res = await fetch(`${CONFIG.SCRIPT_URL}?action=roster`);
  if (!res.ok) throw new Error(`Roster fetch failed (${res.status})`);
  const data = await res.json();
  return data.players || [];
}

async function fetchCoaches() {
  const res = await fetch(`${CONFIG.SCRIPT_URL}?action=coaches`);
  if (!res.ok) throw new Error(`Coach list fetch failed (${res.status})`);
  const data = await res.json();
  return data.coaches || [];
}

// Apps Script Web Apps don't send CORS headers for JSON content types,
// so we POST as text/plain (the default) to avoid a preflight request.
// doPost() on the server reads e.postData.contents and JSON.parses it.
async function postJSON(payload) {
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Request failed");
  return data;
}

async function postAttempt(payload) {
  return postJSON(payload);
}

async function postUndo(payload) {
  return postJSON({ ...payload, action: "undo" });
}
