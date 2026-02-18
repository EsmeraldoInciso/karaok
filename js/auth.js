import { firebaseConfig, BASE_URL } from "./config.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Save or update user profile in Firestore (non-blocking — don't break auth if Firestore fails)
async function saveUserProfile(user) {
  try {
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, {
      displayName: user.displayName || "Anonymous",
      email: user.email,
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn("Failed to save user profile to Firestore:", err.message);
  }
}

// Sign in with Google
async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await saveUserProfile(result.user);
  return result.user;
}

// Sign in with email/password
async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await saveUserProfile(result.user);
  return result.user;
}

// Sign up with email/password
async function signUpWithEmail(email, password, displayName) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  await saveUserProfile(result.user);
  return result.user;
}

// Sign out
async function logOut() {
  await signOut(auth);
}

// Get current user (returns a promise)
function getCurrentUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Route guard: redirect to login if not authenticated
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const currentPath = window.location.pathname + window.location.search;
    window.location.href = `${BASE_URL}/login/?redirect=${encodeURIComponent(currentPath)}`;
    return null;
  }
  return user;
}

// Route guard: redirect to dashboard if already authenticated
async function redirectIfAuth() {
  const user = await getCurrentUser();
  if (user) {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    window.location.href = redirect || `${BASE_URL}/dashboard/`;
    return user;
  }
  return null;
}

// Listen for auth state changes
function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export {
  app,
  auth,
  db,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  logOut,
  getCurrentUser,
  requireAuth,
  redirectIfAuth,
  onAuthChanged
};
