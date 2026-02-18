import { db } from "./auth.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// --- Session Operations ---

async function createSession(sessionCode, hostUserId) {
  const sessionRef = doc(db, "sessions", sessionCode);
  await setDoc(sessionRef, {
    hostUserId,
    createdAt: serverTimestamp(),
    isActive: true,
    currentSongIndex: 0
  });
}

async function getSession(sessionCode) {
  const sessionRef = doc(db, "sessions", sessionCode);
  const snap = await getDoc(sessionRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function endSession(sessionCode) {
  const sessionRef = doc(db, "sessions", sessionCode);
  await updateDoc(sessionRef, { isActive: false });
}

// --- Participant Operations ---

async function addParticipant(sessionCode, userId, displayName, isHost = false) {
  const participantRef = doc(db, "sessions", sessionCode, "participants", userId);
  await setDoc(participantRef, {
    displayName,
    joinedAt: serverTimestamp(),
    isHost
  });
}

async function removeParticipant(sessionCode, userId) {
  const participantRef = doc(db, "sessions", sessionCode, "participants", userId);
  await deleteDoc(participantRef);
}

function onParticipantsChanged(sessionCode, callback) {
  const participantsRef = collection(db, "sessions", sessionCode, "participants");
  return onSnapshot(participantsRef, (snapshot) => {
    const participants = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(participants);
  });
}

// --- Queue Operations ---

async function addToQueue(sessionCode, songData) {
  const queueRef = collection(db, "sessions", sessionCode, "queue");

  // Get current max order
  const q = query(queueRef, orderBy("order", "desc"));
  const snap = await getDocs(q);
  const maxOrder = snap.empty ? 0 : snap.docs[0].data().order;

  const newItemRef = doc(queueRef);
  await setDoc(newItemRef, {
    ...songData,
    order: maxOrder + 1,
    status: "queued",
    addedAt: serverTimestamp()
  });

  return newItemRef.id;
}

async function updateQueueItemStatus(sessionCode, queueItemId, status) {
  const itemRef = doc(db, "sessions", sessionCode, "queue", queueItemId);
  await updateDoc(itemRef, { status });
}

async function removeQueueItem(sessionCode, queueItemId) {
  const itemRef = doc(db, "sessions", sessionCode, "queue", queueItemId);
  await deleteDoc(itemRef);
}

function onQueueChanged(sessionCode, callback) {
  const queueRef = collection(db, "sessions", sessionCode, "queue");
  const q = query(
    queueRef,
    where("status", "in", ["queued", "playing"]),
    orderBy("order", "asc")
  );

  return onSnapshot(q, (snapshot) => {
    const songs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(songs);
  });
}

function onFullQueueChanged(sessionCode, callback) {
  const queueRef = collection(db, "sessions", sessionCode, "queue");
  const q = query(queueRef, orderBy("order", "asc"));

  return onSnapshot(q, (snapshot) => {
    const songs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(songs);
  });
}

export {
  createSession,
  getSession,
  endSession,
  addParticipant,
  removeParticipant,
  onParticipantsChanged,
  addToQueue,
  updateQueueItemStatus,
  removeQueueItem,
  onQueueChanged,
  onFullQueueChanged
};
