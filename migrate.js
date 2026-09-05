import { db } from "./firebase-init.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const BATCH_LIMIT = 500;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function commitInBatches(ops) {
  for (const group of chunk(ops, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    group.forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

// One-time import of this device's localStorage into Firestore, run on
// first sign-in only. If users/{uid} already exists, Firestore is already
// the source of truth (second device, or re-login) and this is a no-op —
// local data on THIS device must never overwrite it.
export async function runMigrationIfNeeded(uid) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    return { imported: false, reason: "existing-user" };
  }

  const localTasks = JSON.parse(localStorage.getItem("tasks")) || [];
  const localCategories = JSON.parse(localStorage.getItem("categories")) || [];
  const localReflections = JSON.parse(localStorage.getItem("reflections")) || {};
  const localLockedDays = JSON.parse(localStorage.getItem("lockedDays")) || [];
  const localDeepWorkSessions = JSON.parse(localStorage.getItem("deepWorkSessions")) || [];
  const localCustomPresets = JSON.parse(localStorage.getItem("customPresets")) || [];
  const localSelectedTheme = localStorage.getItem("selectedTheme") || null;
  const localIdentity = localStorage.getItem("userIdentity") || "";
  const localOnboardingComplete = localStorage.getItem("onboardingComplete") === "true";

  const hasLocalData = localTasks.length > 0 || localCategories.length > 0;

  await setDoc(userRef, {
    // "name" and "ageBracket" are collected during onboarding but never
    // persisted to localStorage today (only held in memory during the
    // onboarding flow) — nothing exists locally to backfill them from.
    name: "",
    identity: localIdentity,
    ageBracket: "",
    createdAt: serverTimestamp(),
    onboardingComplete: localOnboardingComplete,
    // Trial starts on the Day 1 seal (app.js's startTrialOnDayOneSeal(),
    // written via firestoreBridge.setTrialStartDate), not here at account
    // creation — per roadmap #7, the trial is placed after Day 1, not
    // before/at onboarding. Null until that first seal happens.
    trialStartDate: null,
    trialEndDate: null,
    dataImportedAt: hasLocalData ? serverTimestamp() : null
  });

  if (!hasLocalData) {
    return { imported: false, reason: "no-local-data" };
  }

  const ops = [];

  localTasks.forEach(task => {
    const { id, ...rest } = task;
    const docId = id || doc(collection(db, "users", uid, "tasks")).id;
    ops.push({
      ref: doc(db, "users", uid, "tasks", docId),
      data: { ...rest, frozenDates: task.frozenDates || [] }
    });
  });

  localCategories.forEach(cat => {
    ops.push({ ref: doc(collection(db, "users", uid, "categories")), data: cat });
  });

  // Merge lockedDays into reflections so `locked` lives on the same doc,
  // per the schema — includes locked dates that have no went-well/improve
  // text yet, so the lock state isn't silently dropped.
  const reflectionDates = new Set([
    ...Object.keys(localReflections),
    ...localLockedDays
  ]);
  reflectionDates.forEach(dateStr => {
    const entry = localReflections[dateStr] || {};
    ops.push({
      ref: doc(db, "users", uid, "reflections", dateStr),
      data: {
        wentWell: entry.wentWell || "",
        improve: entry.improve || "",
        locked: localLockedDays.includes(dateStr)
      }
    });
  });

  localDeepWorkSessions.forEach(session => {
    ops.push({ ref: doc(collection(db, "users", uid, "deepWorkSessions")), data: session });
  });

  localCustomPresets.forEach(preset => {
    const { id, ...rest } = preset;
    const docId = id || doc(collection(db, "users", uid, "customPresets")).id;
    ops.push({ ref: doc(db, "users", uid, "customPresets", docId), data: rest });
  });

  if (localSelectedTheme) {
    ops.push({ ref: doc(db, "users", uid, "settings", "prefs"), data: { selectedTheme: localSelectedTheme } });
  }

  await commitInBatches(ops);

  return {
    imported: true,
    taskCount: localTasks.length,
    categoryCount: localCategories.length,
    reflectionCount: reflectionDates.size,
    deepWorkSessionCount: localDeepWorkSessions.length,
    customPresetCount: localCustomPresets.length
  };
}

// Lightweight, read-only existence check — used by auth-ui.js as a
// fallback new-vs-existing signal for the "create account" Google flow
// when checkGoogleRedirectResult() fails to resolve with a UserCredential
// (real-device testing showed it consistently resolving null even after a
// successful sign-in). Deliberately not runMigrationIfNeeded() itself:
// that path is skipped on purpose for onboarding sign-ups (skipNextMigration())
// so it can't double-write against writeOnboardingData() — this only reads.
export async function userDocExists(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists();
}

// Called directly by auth-ui.js right after onboarding's account-creation
// step succeeds, with the in-memory draft built by app.js's
// finalizeOnboardingData() — this never reads localStorage. The matching
// sign-in's runMigrationIfNeeded() call is skipped (auth.js's
// skipNextMigration()) so the two writers can't race over users/{uid}.
export async function writeOnboardingData(uid, draft) {
  const ops = [{
    ref: doc(db, "users", uid),
    data: {
      name: draft.name || "",
      identity: draft.identity || "",
      ageBracket: draft.ageBracket || "",
      createdAt: serverTimestamp(),
      onboardingComplete: true,
      trialStartDate: null,
      trialEndDate: null
    }
  }];

  (draft.tasks || []).forEach(task => {
    ops.push({
      ref: doc(collection(db, "users", uid, "tasks")),
      data: { ...task, frozenDates: task.frozenDates || [] }
    });
  });

  (draft.categories || []).forEach(cat => {
    ops.push({ ref: doc(collection(db, "users", uid, "categories")), data: cat });
  });

  await commitInBatches(ops);
}
