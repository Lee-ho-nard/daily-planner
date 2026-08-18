import { db } from "./firebase-init.js";
import { onAuthChange } from "./auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Live in-memory mirrors of the signed-in user's Firestore data, kept fresh
// by onSnapshot listeners. app.js reads these synchronously via
// window.firestoreBridge.getX() — never a Promise, so none of its render
// functions have to become async. This is the entire signed-in data source;
// app.js's own cached variables (tasks/categories/etc.) get *replaced* with
// this data on the firestore-auth-ready/firestore-data-changed events below,
// they don't read from here directly.
const mirror = {
  tasks: [],
  categories: [],
  reflections: {},
  lockedDays: [],
  deepWorkSessions: [],
  customPresets: [],
  selectedTheme: null,
  userDoc: null,
  billing: null
};

let currentUid = null;
let unsubscribers = [];
let pendingSources = null;
let readyDispatchedForUid = null;

function teardownListeners() {
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
}

function resetMirror() {
  mirror.tasks = [];
  mirror.categories = [];
  mirror.reflections = {};
  mirror.lockedDays = [];
  mirror.deepWorkSessions = [];
  mirror.customPresets = [];
  mirror.selectedTheme = null;
  mirror.userDoc = null;
  mirror.billing = null;
}

function dispatchDataChanged(key) {
  document.dispatchEvent(new CustomEvent("firestore-data-changed", { detail: { key } }));
}

function markSourceReady(uid, sourceKey) {
  if (uid !== currentUid || !pendingSources) return;
  pendingSources.delete(sourceKey);
  if (pendingSources.size === 0) {
    pendingSources = null;
    if (readyDispatchedForUid !== uid) {
      readyDispatchedForUid = uid;
      document.dispatchEvent(new CustomEvent("firestore-auth-ready", { detail: { signedIn: true } }));
    }
  }
}

function startListening(uid) {
  currentUid = uid;
  resetMirror();
  pendingSources = new Set(["tasks", "categories", "reflections", "deepWorkSessions", "customPresets", "settings"]);
  readyDispatchedForUid = null;

  const tasksRef = collection(db, "users", uid, "tasks");
  unsubscribers.push(onSnapshot(tasksRef, snap => {
    mirror.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    markSourceReady(uid, "tasks");
    dispatchDataChanged("tasks");
  }));

  const categoriesRef = collection(db, "users", uid, "categories");
  unsubscribers.push(onSnapshot(categoriesRef, snap => {
    mirror.categories = snap.docs.map(d => d.data());
    markSourceReady(uid, "categories");
    dispatchDataChanged("categories");
  }));

  // Firestore stores reflections + lock state on one doc per date; app.js's
  // existing render logic expects them as two separate structures
  // (reflections object + lockedDays array), so split back apart here.
  const reflectionsRef = collection(db, "users", uid, "reflections");
  unsubscribers.push(onSnapshot(reflectionsRef, snap => {
    const reflections = {};
    const lockedDays = [];
    snap.docs.forEach(d => {
      const data = d.data();
      reflections[d.id] = { wentWell: data.wentWell || "", improve: data.improve || "" };
      if (data.locked) lockedDays.push(d.id);
    });
    mirror.reflections = reflections;
    mirror.lockedDays = lockedDays;
    markSourceReady(uid, "reflections");
    dispatchDataChanged("reflections");
  }));

  const sessionsRef = collection(db, "users", uid, "deepWorkSessions");
  unsubscribers.push(onSnapshot(sessionsRef, snap => {
    mirror.deepWorkSessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    markSourceReady(uid, "deepWorkSessions");
    dispatchDataChanged("deepWorkSessions");
  }));

  const presetsRef = collection(db, "users", uid, "customPresets");
  unsubscribers.push(onSnapshot(presetsRef, snap => {
    mirror.customPresets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    markSourceReady(uid, "customPresets");
    dispatchDataChanged("customPresets");
  }));

  const settingsRef = doc(db, "users", uid, "settings", "prefs");
  unsubscribers.push(onSnapshot(settingsRef, snap => {
    mirror.selectedTheme = (snap.exists() && snap.data().selectedTheme) || null;
    markSourceReady(uid, "settings");
    dispatchDataChanged("selectedTheme");
  }));

  // Account (trial dates, etc.) and billing status — not part of
  // pendingSources/the firestore-auth-ready gate since nothing in the main
  // render path depends on them; Settings just re-renders live off the
  // firestore-data-changed event when either arrives.
  const userDocRef = doc(db, "users", uid);
  unsubscribers.push(onSnapshot(userDocRef, snap => {
    mirror.userDoc = snap.exists() ? snap.data() : null;
    dispatchDataChanged("userDoc");
  }));

  const billingRef = doc(db, "users", uid, "billing", "status");
  unsubscribers.push(onSnapshot(billingRef, snap => {
    mirror.billing = snap.exists() ? snap.data() : null;
    dispatchDataChanged("billing");
  }));
}

onAuthChange((user) => {
  if (user) {
    if (currentUid === user.uid) return; // already listening for this account
    teardownListeners();
    startListening(user.uid);
  } else {
    teardownListeners();
    currentUid = null;
    pendingSources = null;
    readyDispatchedForUid = null;
    resetMirror();
    document.dispatchEvent(new CustomEvent("firestore-auth-ready", { detail: { signedIn: false } }));
  }
});

const BATCH_LIMIT = 500;
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function commitInBatches(ops) {
  for (const group of chunk(ops, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    group.forEach(op => {
      if (op.type === "delete") batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    });
    await batch.commit();
  }
}

// Coarse-grained mirror for tasks/customPresets (both have stable local
// ids): set every current item, delete anything Firestore has that the
// array no longer does — using the live mirror's ids as "what Firestore
// currently has" rather than a separate read. Simpler and safer to reason
// about than diffing/tracking granular changes, and at a personal-planner's
// scale (tens to low hundreds of items) the extra writes are a non-issue.
async function mirrorCollection(uid, collectionName, items, itemToDoc, previousIds) {
  const colRef = collection(db, "users", uid, collectionName);
  const currentIds = new Set();
  const ops = items.map(item => {
    const { ref, data, id } = itemToDoc(colRef, item);
    currentIds.add(id);
    return { type: "set", ref, data };
  });
  previousIds.forEach(id => {
    if (id && !currentIds.has(id)) ops.push({ type: "delete", ref: doc(colRef, id) });
  });
  await commitInBatches(ops);
}

function syncTasks(tasksArray) {
  if (!currentUid) return;
  const previousIds = mirror.tasks.map(t => t.id);
  return mirrorCollection(currentUid, "tasks", tasksArray, (colRef, task) => {
    const { id, ...rest } = task;
    const docId = id || doc(colRef).id;
    return { ref: doc(colRef, docId), data: { ...rest, frozenDates: task.frozenDates || [] }, id: docId };
  }, previousIds);
}

function syncCustomPresets(presetsArray) {
  if (!currentUid) return;
  const previousIds = mirror.customPresets.map(p => p.id);
  return mirrorCollection(currentUid, "customPresets", presetsArray, (colRef, preset) => {
    const { id, ...rest } = preset;
    const docId = id || doc(colRef).id;
    return { ref: doc(colRef, docId), data: rest, id: docId };
  }, previousIds);
}

// Categories have no stable local id today, so there's nothing to diff by —
// every sync deletes whatever docs currently exist (read fresh, since the
// mirror doesn't track per-category doc ids) and recreates them with new
// auto-ids. Categories are a short, rarely-changed list, so this is cheap.
async function syncCategories(categoriesArray) {
  if (!currentUid) return;
  const colRef = collection(db, "users", currentUid, "categories");
  const existing = await getDocs(colRef);
  const ops = [];
  existing.forEach(d => ops.push({ type: "delete", ref: d.ref }));
  categoriesArray.forEach(cat => ops.push({ type: "set", ref: doc(colRef), data: cat }));
  await commitInBatches(ops);
}

async function syncReflection(dateStr, entry, locked) {
  if (!currentUid) return;
  const ref = doc(db, "users", currentUid, "reflections", dateStr);
  await setDoc(ref, { wentWell: entry.wentWell || "", improve: entry.improve || "", locked: !!locked });
}

// Generates the doc id synchronously (the modular SDK creates ids
// client-side with no network round-trip) so callers get an id immediately
// to thread through the rest of the session-complete/note flow, while the
// actual write happens in the background.
function logDeepWorkSession(sessionData) {
  if (!currentUid) return null;
  const colRef = collection(db, "users", currentUid, "deepWorkSessions");
  const ref = doc(colRef);
  setDoc(ref, sessionData);
  return ref.id;
}

async function saveDeepWorkSessionNote(sessionId, note) {
  if (!currentUid || !sessionId) return;
  const ref = doc(db, "users", currentUid, "deepWorkSessions", sessionId);
  await updateDoc(ref, { note });
}

async function saveSelectedTheme(theme) {
  if (!currentUid) return;
  const ref = doc(db, "users", currentUid, "settings", "prefs");
  await setDoc(ref, { selectedTheme: theme }, { merge: true });
}

// Starts the trial on the Day 1 seal (app.js's startTrialOnDayOneSeal()).
// Reads the doc fresh (not the live mirror, which may not have loaded yet
// right after sign-in — mirror.userDoc isn't part of the auth-ready gate)
// so a seal that happens to land before the mirror catches up can't
// clobber an already-started trial with a new start date.
async function setTrialStartDate(startDate) {
  if (!currentUid) return;
  const ref = doc(db, "users", currentUid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().trialStartDate) return;
  const end = new Date(startDate.getTime() + 7 * 86400000);
  await setDoc(ref, {
    trialStartDate: Timestamp.fromDate(startDate),
    trialEndDate: Timestamp.fromDate(end)
  }, { merge: true });
}

// Deletes every doc under users/{uid} that the client is allowed to write
// (see firestore.rules): all subcollections plus the top-level doc itself.
// billing/status and weeklyInsights/* are server-controlled — write: if
// false for clients — so they're intentionally left behind; a full purge of
// those needs a Cloud Function running under the Admin SDK, which is out of
// scope here. Must run BEFORE the Auth account is deleted: once deleteUser()
// succeeds the ID token is invalidated and these deletes would fail the
// isOwner() security rule.
async function deleteAllUserData(uid) {
  const subcollections = ["tasks", "categories", "reflections", "deepWorkSessions", "customPresets"];
  const ops = [];
  for (const name of subcollections) {
    const snap = await getDocs(collection(db, "users", uid, name));
    snap.forEach(d => ops.push({ type: "delete", ref: d.ref }));
  }
  ops.push({ type: "delete", ref: doc(db, "users", uid, "settings", "prefs") });
  ops.push({ type: "delete", ref: doc(db, "users", uid) });
  await commitInBatches(ops);
  teardownListeners();
  currentUid = null;
  pendingSources = null;
  readyDispatchedForUid = null;
  resetMirror();
}

window.firestoreBridge = {
  isSignedIn: () => currentUid !== null,
  getTasks: () => mirror.tasks,
  getCategories: () => mirror.categories,
  getReflections: () => mirror.reflections,
  getLockedDays: () => mirror.lockedDays,
  getDeepWorkSessions: () => mirror.deepWorkSessions,
  getCustomPresets: () => mirror.customPresets,
  getSelectedTheme: () => mirror.selectedTheme,
  getAccountInfo: () => mirror.userDoc,
  getBillingStatus: () => mirror.billing,
  syncTasks,
  syncCategories,
  syncCustomPresets,
  syncReflection,
  logDeepWorkSession,
  saveDeepWorkSessionNote,
  saveSelectedTheme,
  setTrialStartDate,
  deleteAllUserData
};
