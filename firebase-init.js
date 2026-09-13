import { initializeApp } from "./vendor/firebase/firebase-app.js";
import { getAuth } from "./vendor/firebase/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "./vendor/firebase/firebase-firestore.js";
import { getAnalytics, isSupported as analyticsIsSupported, logEvent } from "./vendor/firebase/firebase-analytics.js";

// Firebase web config isn't a traditional secret — access control is
// enforced entirely by firestore.rules, not by hiding these values. Replace
// with your real project's config from the Firebase console
// (Project settings → General → Your apps → SDK setup and configuration).
const firebaseConfig = {
  apiKey: "AIzaSyBbaXv4F4kMBWCBVHegyLJUBJRHxUZ4KbM",
  authDomain: "flit-96c38.firebaseapp.com",
  projectId: "flit-96c38",
  storageBucket: "flit-96c38.firebasestorage.app",
  messagingSenderId: "532727180368",
  appId: "1:532727180368:web:96ba0f6862f88ec42eb555"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Raw synchronous handle for app.js (a classic script, so it can't import
// this module directly) — assigned here, at module-evaluation time, rather
// than from auth-ui.js's DOMContentLoaded-gated window.authBridge. This
// module evaluates as a dependency of auth.js before auth.js's own
// onAuthStateChanged registration runs, and onAuthStateChanged never fires
// synchronously with module evaluation — so this is guaranteed to already
// be set by the time any onAuthStateChanged callback (or anything it
// triggers, like app.js's "auth-state-resolved" listener) reads it, with
// no DOMContentLoaded race.
window.firebaseAuth = auth;

// Persistent local cache with multi-tab support gives offline-first
// behavior for free — reads/writes work offline and sync automatically
// once connectivity returns, across multiple open tabs of the app.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// --- Analytics (funnel tracking only — no PII) ---
// getAnalytics() would throw synchronously in an environment where
// Analytics genuinely can't run (no IndexedDB, browser extension context,
// cookies disabled, etc.) — isSupported() is the SDK's own recommended
// guard against that, so this is wrapped rather than called unconditionally
// at module-evaluation time. window.logAnalyticsEvent() is a raw
// synchronous handle for app.js (a classic script, same pattern as
// window.firebaseAuth above) and is always safe to call: before analytics
// finishes initializing (or on a platform where it never will), it's just
// a no-op — no caller needs its own isSupported()/try-catch.
let analyticsInstance = null;
analyticsIsSupported().then((supported) => {
  if (!supported) return;
  try {
    analyticsInstance = getAnalytics(firebaseApp);
  } catch (err) {
    // Most likely cause: this Firebase project has no linked Google
    // Analytics property yet. Funnel events just won't record anywhere
    // until one exists — nothing else in the app depends on this.
  }
});
window.logAnalyticsEvent = (name, params) => {
  if (!analyticsInstance) return;
  try {
    logEvent(analyticsInstance, name, params);
  } catch (err) {
    // Never let a tracking call break the feature it's attached to.
  }
};
