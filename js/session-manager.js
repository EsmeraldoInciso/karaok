import { BASE_URL } from "./config.js";
import { createSession, getSession, addParticipant, endSession } from "./firebase-client.js";

// Generate a 6-character session code (avoids ambiguous chars like 0/O, 1/I/L)
function generateSessionCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => chars[x % chars.length]).join("");
}

// Create a new karaoke session
async function createKaraokeSession(user) {
  let sessionCode;
  let attempts = 0;

  // Ensure unique code (retry if collision)
  do {
    sessionCode = generateSessionCode();
    const existing = await getSession(sessionCode);
    if (!existing) break;
    attempts++;
  } while (attempts < 5);

  if (attempts >= 5) {
    throw new Error("Failed to generate unique session code. Please try again.");
  }

  await createSession(sessionCode, user.uid);
  await addParticipant(sessionCode, user.uid, user.displayName || "Host", true);

  return sessionCode;
}

// Join an existing session
async function joinKaraokeSession(sessionCode, user) {
  const session = await getSession(sessionCode.toUpperCase());

  if (!session) {
    throw new Error("Session not found. Check the code and try again.");
  }

  if (!session.isActive) {
    throw new Error("This session has ended.");
  }

  await addParticipant(
    session.id,
    user.uid,
    user.displayName || "Guest",
    false
  );

  return session.id;
}

// End a session (host only)
async function endKaraokeSession(sessionCode) {
  await endSession(sessionCode);
}

// Get the join URL for a session
function getSessionJoinUrl(sessionCode) {
  return `${BASE_URL}/remote/?session=${sessionCode}`;
}

// Get session code from URL query params
function getSessionCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session");
}

export {
  createKaraokeSession,
  joinKaraokeSession,
  endKaraokeSession,
  getSessionJoinUrl,
  getSessionCodeFromUrl
};
