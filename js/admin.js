import { db, requireAuth } from "./auth.js";
import { BASE_URL } from "./config.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  getCountFromServer,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// --- Admin Auth Guard ---

async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().isAdmin !== true) {
    window.location.href = `${BASE_URL}/dashboard/`;
    return null;
  }

  return user;
}

// --- Dashboard Stats ---

async function getAdminStats() {
  const [usersCount, sessionsCount, activeCount, songsToday] = await Promise.all([
    getCountFromServer(collection(db, "users")),
    getCountFromServer(collection(db, "sessions")),
    getCountFromServer(query(collection(db, "sessions"), where("isActive", "==", true))),
    getSongsQueuedToday()
  ]);

  return {
    totalUsers: usersCount.data().count,
    totalSessions: sessionsCount.data().count,
    activeSessions: activeCount.data().count,
    songsQueuedToday
  };
}

async function getSongsQueuedToday() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const q = query(
      collectionGroup(db, "queue"),
      where("addedAt", ">=", Timestamp.fromDate(todayStart))
    );
    const count = await getCountFromServer(q);
    return count.data().count;
  } catch {
    // Collection group index may not exist yet — return 0 gracefully
    return 0;
  }
}

// --- User Management ---

async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  users.sort((a, b) => {
    const aTime = a.lastActive?.toMillis?.() || 0;
    const bTime = b.lastActive?.toMillis?.() || 0;
    return bTime - aTime;
  });

  return users;
}

// --- Session Management ---

async function getAllSessions(filter) {
  let q;
  const sessionsRef = collection(db, "sessions");

  if (filter === "active") {
    q = query(sessionsRef, where("isActive", "==", true), orderBy("createdAt", "desc"));
  } else if (filter === "inactive") {
    q = query(sessionsRef, where("isActive", "==", false), orderBy("createdAt", "desc"));
  } else {
    q = query(sessionsRef, orderBy("createdAt", "desc"));
  }

  const snap = await getDocs(q);
  const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Fetch participant and queue counts for each session
  const enriched = await Promise.all(sessions.map(async (session) => {
    const [participantsSnap, queueSnap] = await Promise.all([
      getDocs(collection(db, "sessions", session.id, "participants")),
      getDocs(collection(db, "sessions", session.id, "queue"))
    ]);

    // Find host name from participants
    const hostParticipant = participantsSnap.docs.find((d) => d.data().isHost);

    return {
      ...session,
      participantCount: participantsSnap.size,
      queueCount: queueSnap.size,
      hostName: hostParticipant?.data().displayName || "Unknown"
    };
  }));

  return enriched;
}

async function getSessionDetails(sessionCode) {
  const sessionDoc = await getDoc(doc(db, "sessions", sessionCode));
  if (!sessionDoc.exists()) return null;

  const [participantsSnap, queueSnap] = await Promise.all([
    getDocs(collection(db, "sessions", sessionCode, "participants")),
    getDocs(query(
      collection(db, "sessions", sessionCode, "queue"),
      orderBy("order", "asc")
    ))
  ]);

  return {
    session: { id: sessionDoc.id, ...sessionDoc.data() },
    participants: participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    queue: queueSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
}

async function forceEndSession(sessionCode) {
  await updateDoc(doc(db, "sessions", sessionCode), { isActive: false });
}

async function deleteQueueItem(sessionCode, queueItemId) {
  await deleteDoc(doc(db, "sessions", sessionCode, "queue", queueItemId));
}

async function kickParticipant(sessionCode, userId) {
  await deleteDoc(doc(db, "sessions", sessionCode, "participants", userId));
}

export {
  requireAdmin,
  getAdminStats,
  getAllUsers,
  getAllSessions,
  getSessionDetails,
  forceEndSession,
  deleteQueueItem,
  kickParticipant
};
