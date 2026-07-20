// Shared helpers used across skill pages.

const COACH_KEY = "vbtryouts_coach";

function isScriptConfigured() {
  return (
    typeof CONFIG !== "undefined" &&
    CONFIG.SCRIPT_URL &&
    !CONFIG.SCRIPT_URL.startsWith("PASTE_")
  );
}

function getSavedCoach() {
  return localStorage.getItem(COACH_KEY) || "";
}

function saveCoach(name) {
  localStorage.setItem(COACH_KEY, name.trim());
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
