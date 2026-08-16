import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { runMigrationIfNeeded } from "./migrate.js";

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signUpWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

// Listeners registered via onAuthChange, called whenever auth state settles
// (including once at startup) — separate from Firebase's own callback so
// UI code doesn't need to import the Firebase SDK directly.
const authStateListeners = [];
export function onAuthChange(callback) {
  authStateListeners.push(callback);
}

let migrationRanForUid = null;

onAuthStateChanged(auth, async (user) => {
  if (user && migrationRanForUid !== user.uid) {
    migrationRanForUid = user.uid;
    try {
      const result = await runMigrationIfNeeded(user.uid);
      authStateListeners.forEach(cb => cb(user, result));
      return;
    } catch (err) {
      console.error("Migration failed:", err);
      authStateListeners.forEach(cb => cb(user, { imported: false, reason: "error", error: err }));
      return;
    }
  }
  if (!user) migrationRanForUid = null;
  authStateListeners.forEach(cb => cb(user, null));
});
