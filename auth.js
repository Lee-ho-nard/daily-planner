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
  reauthenticateWithPopup,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

export { getAdditionalUserInfo };
import { runMigrationIfNeeded } from "./migrate.js";

// Fixed, not window.location.origin — using the current origin here
// previously broke verification sends outright on preview/newly-deployed
// domains that weren't yet in Firebase's authorized-domains allowlist
// (auth/unauthorized-continue-uri). This project's own default Hosting
// domain is authorized for every Firebase project automatically, so it's
// the one continue URL that's always safe regardless of where the app
// itself is actually being served from when the email gets sent. Routes to
// auth-action.html, the app's styled verification-link landing page —
// requires that page to actually be deployed there (firebase deploy
// --only hosting) for the link to resolve.
export const AUTH_ACTION_URL = "https://flit-96c38.web.app/auth-action.html";
const VERIFICATION_ACTION_SETTINGS = { url: AUTH_ACTION_URL };

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
  try {
    await sendEmailVerification(cred.user, VERIFICATION_ACTION_SETTINGS);
    return { credential: cred, verificationError: null };
  } catch (verificationError) {
    // The account already exists at this point. Keep the user signed in so
    // they can use the visible Resend control instead of seeing a misleading
    // failed-signup state and then an "email already in use" retry error.
    console.error("Initial verification email failed:", verificationError);
    return { credential: cred, verificationError };
  }
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
  return sendEmailVerification(user, VERIFICATION_ACTION_SETTINGS);
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

// Set by auth-ui.js immediately before signUpWithEmail/signInWithGoogle on
// onboarding's account-creation step, since that path writes its own draft
// straight to Firestore (migrate.js's writeOnboardingData()) right after —
// running runMigrationIfNeeded() too would race both writers over
// users/{uid} (whichever's setDoc lands last wins, and migration's blank
// name/identity/ageBracket must never be the one that lands last). Cleared
// on the very next auth state change regardless of outcome, and also
// defensively by auth-ui.js on any signup/Google error so it can never leak
// into an unrelated later sign-in.
let skipMigrationForNextSignIn = false;
export function skipNextMigration() { skipMigrationForNextSignIn = true; }
export function cancelSkipMigration() { skipMigrationForNextSignIn = false; }

// Bumped on every single onAuthStateChanged firing, regardless of branch.
// The migration branch below awaits a Firestore read (runMigrationIfNeeded)
// before notifying authStateListeners — if a newer auth event (e.g. a
// sign-out fired by our own code reacting to that same sign-in) happens
// while that read is still in flight, this lets the now-stale invocation
// recognize it's been superseded and discard its result instead of calling
// authStateListeners.forEach() with a stale user object. Without this, a
// stale, delayed "signed in" notification can re-trigger firestore-sync's
// startListening(uid) for an account that's no longer actually signed in,
// making firestoreBridge.isSignedIn() lie about the real auth state.
let authGeneration = 0;

onAuthStateChanged(auth, async (user) => {
  authGeneration += 1;
  const myGeneration = authGeneration;

  if (user && skipMigrationForNextSignIn) {
    skipMigrationForNextSignIn = false;
    migrationRanForUid = user.uid;
    authStateListeners.forEach(cb => cb(user, { imported: false, reason: "onboarding" }));
    return;
  }

  if (user && migrationRanForUid !== user.uid) {
    migrationRanForUid = user.uid;
    try {
      const result = await runMigrationIfNeeded(user.uid);
      if (myGeneration !== authGeneration) return; // superseded by a newer auth event
      authStateListeners.forEach(cb => cb(user, result));
      return;
    } catch (err) {
      console.error("Migration failed:", err);
      if (myGeneration !== authGeneration) return; // superseded by a newer auth event
      authStateListeners.forEach(cb => cb(user, { imported: false, reason: "error", error: err }));
      return;
    }
  }
  // Reached synchronously (no await before it in this branch), so there's
  // no window for a newer event to interleave — no generation check needed
  // here, but the counter above still advances so it does its job when a
  // later event like this one needs to invalidate an earlier in-flight one.
  if (!user) migrationRanForUid = null;
  authStateListeners.forEach(cb => cb(user, null));
});
