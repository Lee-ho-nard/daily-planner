# Firestore Schema — Daily Planner

Design goals: mirror the existing localStorage shapes as closely as possible
(minimal rewrite of `app.js` render logic), keep `isPremium` and freeze
quotas server-controlled only, and support offline-first behavior via
Firestore's built-in offline persistence.

## Top-level: `users/{uid}`

A single doc per user, holding things that don't need their own collection.

```
users/{uid}
  name: string
  identity: string              // from onboarding "who do you want to become"
  ageBracket: string
  createdAt: timestamp
  onboardingComplete: boolean
  trialStartDate: timestamp | null   // null until the Day 1 seal (first "End
                                      // Day" completion) — NOT set at account
                                      // creation. Written by
                                      // firestoreBridge.setTrialStartDate(),
                                      // called from app.js's
                                      // startTrialOnDayOneSeal(). Signed-out
                                      // users get an equivalent local trial
                                      // via localStorage "trialStartDate" —
                                      // the trial doesn't require an account.
  trialEndDate: timestamp | null     // trialStartDate + 7 days, same null-
                                      // until-Day-1 rule
  dataImportedAt: timestamp | null   // set once, after first localStorage import
```

Client can read/write this doc (except see billing note below).

## `users/{uid}/billing/status` (single doc, NOT a collection)

Server-controlled only. Client has READ-only security rules here. Every
write comes from a Cloud Function (Stripe webhook handler), never the
client. This is the fix for the current `isPremium` localStorage flag being
client-editable.

```
users/{uid}/billing/status
  isPremium: boolean
  subscriptionStatus: "trialing" | "active" | "canceled" | "past_due"
  stripeCustomerId: string
  stripeSubscriptionId: string
  currentPeriodEnd: timestamp
  freezesRemaining: number        // resets monthly, e.g. 2 per month
  freezesResetDate: timestamp
```

## `users/{uid}/tasks/{taskId}`

Same shape as the current `tasks` array objects, unchanged, so the existing
render logic (`getTasksForDate`, `occursOn`, `computeStreak`, etc.) barely
needs to change — just swap the data source.

```
users/{uid}/tasks/{taskId}
  name: string
  category: string
  time: string
  duration: string
  date: string              // "YYYY-MM-DD"
  endDate: string
  done: boolean
  order: number
  recurrence: { type: "none" | "daily" | "weekly", days?: number[], interval?: number }
  completedDates: string[]
  frozenDates: string[]     // streak-freeze days, kept separate from
                             // completedDates so the UI can honestly show
                             // "frozen" vs "actually done" (different dot
                             // style), not silently fake a completion
  isGoal: boolean
  checkoffLabel: string
  why: string
  plan: string
  milestonesEarned: {            // shareable milestone cards (roadmap #6)
    [threshold: "7" | "30" | "100"]: {
      threshold: number,
      startDate: string,          // "YYYY-MM-DD", first day of that streak
      earnedDate: string,         // "YYYY-MM-DD", day the threshold was hit
      protectedDays: number       // frozen (not completed) days in that window
    }
  }
```

Gates each threshold to firing once per streak (checkStreakMilestones() in
app.js) and lets "View milestone" later re-render the exact snapshot as it
was earned, not the task's current (possibly longer) streak — recomputed
from completedDates/frozenDates via occursOn() over [startDate, earnedDate],
same as everywhere else in the app, not stored as a rendered image.

## `users/{uid}/categories/{categoryId}`

```
users/{uid}/categories/{categoryId}
  name: string
  color: string
```

## `users/{uid}/reflections/{dateStr}`

Doc ID is the date string itself (`"YYYY-MM-DD"`), so lookups stay simple.

```
users/{uid}/reflections/{dateStr}
  wentWell: string
  improve: string
  locked: boolean       // replaces the separate `lockedDays` array —
                         // one less thing to keep in sync
```

## `users/{uid}/deepWorkSessions/{sessionId}`

```
users/{uid}/deepWorkSessions/{sessionId}
  date: string
  sessionName: string
  durationMinutes: number
  note: string
```

## `users/{uid}/customPresets/{presetId}`

```
users/{uid}/customPresets/{presetId}
  name: string
  workMinutes: number
  breakMinutes: number
```

## `users/{uid}/settings/prefs` (single doc)

The original design called this `users/{uid}/settings`, but that's actually
a 3-segment collection path, not a valid document path (unlike
`billing/status`, which is 4 segments and valid). Resolved the same way
`billing/status` is structured: a fixed doc, here named `prefs`, inside a
`settings` collection. `firestore.rules`' `match /settings/{docId}` already
covers this generically.

```
users/{uid}/settings/prefs
  selectedTheme: string
  notificationsEnabled: boolean
  smartRemindersEnabled: boolean   // premium
  pushToken: string | null          // for Web Push, added when that phase starts
```

## `users/{uid}/weeklyInsights/{weekKey}` (future — AI insight feature, not built yet)

Server-written only, same pattern as `billing/status`.

```
users/{uid}/weeklyInsights/{weekKey}   // weekKey = ISO week, e.g. "2026-W33"
  text: string
  generatedAt: timestamp
```

## Security rules (summary — see `firestore.rules` for the actual syntax)

- `users/{uid}/tasks/**`, `categories/**`, `reflections/**`,
  `deepWorkSessions/**`, `customPresets/**`, `settings/**` → read/write
  allowed only where `request.auth.uid == uid`.
- `users/{uid}/billing/status` → read allowed for `request.auth.uid == uid`,
  write denied for all clients. Only the Admin SDK (Cloud Functions) can
  write it.
- `users/{uid}/weeklyInsights/**` → same read-only pattern as billing.

## Migration from localStorage (first sign-in)

Implemented in `migrate.js`, run once per account on sign-in:

1. On sign-in, check if `users/{uid}` exists in Firestore.
2. If it doesn't exist AND localStorage has `tasks`/`categories` with data →
   this is a first-time signup on a device that already has local data. Run
   a one-time import: write existing `tasks`, `categories`, `reflections`,
   `lockedDays` (mapped into `reflections.locked`), `deepWorkSessions`, and
   `customPresets` into the new Firestore subcollections. Set
   `dataImportedAt`.
3. If `users/{uid}` already exists (second device, or re-login) → Firestore
   is the source of truth. Do NOT overwrite it with local data. Just start
   syncing from Firestore down to the device.
4. After migration, Firestore's built-in offline persistence
   (`persistentLocalCache` on web, configured in `firebase-init.js`) handles
   the offline-first behavior — localStorage stops being the primary store
   for signed-in users and Firestore's local cache replaces it.

`name` and `ageBracket` are collected during onboarding but were never
persisted to localStorage, so migration currently writes empty strings for
them — nothing exists locally to backfill them from.

## Streak freeze mechanics (honesty constraint — not yet built)

No freeze UI exists in the app yet, but the schema anticipates it, and
`migrate.js` already round-trips the `frozenDates` field so it isn't lost
if/when this ships. A freeze must never silently masquerade as a real
completion:

- `completedDates` = actually completed.
- `frozenDates` = covered by a freeze.
- `computeStreak()` would count both toward the streak number, but goal-dot
  rendering (`renderGoals()`) should style frozen days visibly differently
  (e.g. a small icon overlay instead of the solid category-color dot) so a
  user looking at their own history can always tell the difference.
