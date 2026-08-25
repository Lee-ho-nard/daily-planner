import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
