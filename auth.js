import { auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  updatePassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { runMigrationIfNeeded } from "./migrate.js";

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  // Without this, Google silently re-signs-in with whichever account was
  // used last instead of showing the picker — no chance to choose a
  // different account.
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export async function signUpWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Best-effort — a failed send here (rare, e.g. transient network issue)
  // shouldn't block account creation. The unverified-email banner in
  // Settings gives the user a retry path either way.
  try { await sendEmailVerification(cred.user); } catch (err) { console.error("Failed to send verification email:", err); }
  return cred;
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function hasPasswordProvider() {
  const user = auth.currentUser;
  return !!user && user.providerData.some(p => p.providerId === "password");
}

export function hasGoogleProvider() {
  const user = auth.currentUser;
  return !!user && user.providerData.some(p => p.providerId === "google.com");
}

export function sendVerificationEmail() {
  const user = auth.currentUser;
  if (!user) return Promise.reject(new Error("Not signed in"));
  return sendEmailVerification(user);
}

// Refreshes auth.currentUser's cached fields (emailVerified, metadata, etc.)
// from the server — needed because those don't update on their own after
// e.g. clicking a verification link in another tab.
export async function reloadCurrentUser() {
  const user = auth.currentUser;
  if (user) await user.reload();
  return auth.currentUser;
}

export function reauthenticateWithPassword(password) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, password);
  return reauthenticateWithCredential(user, credential);
}

export function reauthenticateWithGoogle() {
  const user = auth.currentUser;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return reauthenticateWithPopup(user, provider);
}

// Firebase requires the current password to be verified via
// reauthenticateWithCredential immediately before updatePassword — a stale
// sign-in isn't enough, per Firebase Auth's security requirements.
export function changePassword(newPassword) {
  const user = auth.currentUser;
  return updatePassword(user, newPassword);
}

export function deleteCurrentUser() {
  const user = auth.currentUser;
  return deleteUser(user);
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
