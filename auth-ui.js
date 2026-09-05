import {
  signInWithGoogle,
  checkGoogleRedirectResult,
  signUpWithEmail,
  signInWithEmail,
  signOutUser,
  onAuthChange,
  getCurrentUser,
  hasPasswordProvider,
  hasGoogleProvider,
  sendVerificationEmail,
  reloadCurrentUser,
  reauthenticateWithPassword,
  reauthenticateWithGoogle,
  changePassword,
  deleteCurrentUser,
  getAdditionalUserInfo,
  skipNextMigration,
  cancelSkipMigration
} from "./auth.js";
import { writeOnboardingData, userDocExists } from "./migrate.js";

// Local open/close helpers matching app.js's .modal-overlay "open" class
// pattern (styles.css), kept self-contained rather than depending on
// app.js's globals — the only intentional touch points with app.js's
// existing surface are showToast() (toast notifications) and showConfirm()
// (sign-out/delete-account confirmations, reusing the same pattern already
// used for task/category deletion), both used defensively.
function openModal(el) { el.classList.add("open"); }
function closeModal(el) { el.classList.remove("open"); }
function closeModalInstant(el) {
  el.style.transition = "none";
  el.classList.remove("open");
  void el.offsetWidth;
  el.style.transition = "";
}

function notify(message, variant) {
  if (typeof window.showToast === "function") {
    window.showToast(message, variant);
  }
}

// Flushes app.js's in-memory onboarding draft straight to Firestore, called
// right after the onboarding account-creation step's signup succeeds (the
// matching runMigrationIfNeeded() call was already skipped for this uid —
// see skipNextMigration()). Firestore's own onSnapshot listeners
// (firestore-sync.js) pick the write up from there, same as any other
// change — nothing here touches localStorage.
async function flushOnboardingDraft(uid) {
  if (typeof window.getOnboardingDraft !== "function") return;
  const draft = window.getOnboardingDraft();
  if (!draft) return;
  try {
    await writeOnboardingData(uid, draft);
  } catch (err) {
    console.error("writeOnboardingData failed:", err);
    notify("Account created, but we couldn't save your setup. You can rebuild it in the app.", "warning");
  }
}

function confirmSignOut(onConfirm) {
  if (typeof window.showConfirm === "function") {
    window.showConfirm({
      title: "Sign out",
      message: "You'll need to sign in again to access your synced data on this device.",
      confirmLabel: "Sign out",
      danger: true,
      onConfirm
    });
  } else {
    onConfirm();
  }
}

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/email-already-in-use") return "That email is already registered. Try signing in instead.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Incorrect email or password.";
  if (code === "auth/weak-password") return "Password should be at least 6 characters.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "auth/unauthorized-continue-uri" || code === "auth/unauthorized-domain") return "This site isn't authorized for email verification. Add its domain in Firebase Console → Authentication → Settings → Authorized domains.";
  return "Something went wrong. Please try again.";
}

function friendlyPasswordError(err) {
  const code = err && err.code ? err.code : "";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Incorrect password.";
  if (code === "auth/weak-password") return "Password should be at least 6 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a moment and try again.";
  if (code === "auth/requires-recent-login") return "Please sign out and sign back in, then try again.";
  return "Something went wrong. Please try again.";
}

function formatDate(dateInput) {
  if (!dateInput) return null;
  const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Subscription status is derived from users/{uid}/billing/status (server-
// controlled, isPremium/subscriptionStatus) for the real-premium case, and
// from app.js's trialDaysRemaining() (window-exposed — app.js is a classic
// script, so its top-level function declarations land on window) for the
// trial case, the same function isPremiumUser() itself checks. Deliberately
// not a second, independent trial calculation here — this file used to
// compute trial days straight from account.trialEndDate on its own, which
// could disagree with what isPremiumUser() was actually gating on.
function computeSubscriptionStatus() {
  const billing = window.firestoreBridge && window.firestoreBridge.getBillingStatus ? window.firestoreBridge.getBillingStatus() : null;

  if (billing && billing.isPremium) {
    return "Premium" + (billing.subscriptionStatus ? ` · ${billing.subscriptionStatus}` : "");
  }
  if (typeof window.trialDaysRemaining === "function") {
    const daysLeft = window.trialDaysRemaining();
    if (daysLeft > 0) return `Free trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  }
  return "Free plan";
}

// Streak Insurance's shared premium pool — window-exposed by app.js the
// same way isPremiumUser()/trialDaysRemaining() are (see the comment
// above). Free users never see this line: their own freeze bank is
// per-goal and already surfaced on each goal's card, not a single
// account-wide number the way premium's shared pool is.
function updateFreezeStatusDisplay() {
  const el = document.getElementById("authFreezeStatus");
  if (!el) return;
  if (typeof window.isPremiumUser !== "function" || !window.isPremiumUser() || typeof window.getStreakFreezeState !== "function") {
    el.style.display = "none";
    return;
  }
  const remaining = window.getStreakFreezeState().remaining;
  el.textContent = `❄ ${remaining} freeze${remaining === 1 ? "" : "s"} remaining this month`;
  el.style.display = "block";
}

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("authModalOverlay");
  const emailInput = document.getElementById("authEmailInput");
  const passwordInput = document.getElementById("authPasswordInput");
  const errorEl = document.getElementById("authError");
  const existingAccountLink = document.getElementById("authExistingAccountSignIn");
  const submitBtn = document.getElementById("authSubmitBtn");
  const modeToggleBtn = document.getElementById("authModeToggle");
  const titleEl = document.getElementById("authModalTitle");

  const signInBtn = document.getElementById("authSignInBtn");
  const statusPill = document.getElementById("authStatus");
  const userEmailEl = document.getElementById("authUserEmail");
  const signOutBtn = document.getElementById("authSignOutBtn");

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsModalOverlay");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");

  const verifyBanner = document.getElementById("authVerifyBanner");
  const resendVerifyBtn = document.getElementById("authResendVerifyBtn");
  const changePasswordBtn = document.getElementById("authChangePasswordBtn");
  const deleteAccountBtn = document.getElementById("authDeleteAccountBtn");

  const changePwOverlay = document.getElementById("changePasswordModalOverlay");
  const changePwCurrentInput = document.getElementById("changePwCurrentInput");
  const changePwNewInput = document.getElementById("changePwNewInput");
  const changePwError = document.getElementById("changePwError");
  const changePwSaveBtn = document.getElementById("changePwSaveBtn");
  const changePwCancelBtn = document.getElementById("changePwCancelBtn");

  const reauthOverlay = document.getElementById("reauthModalOverlay");
  const reauthPasswordInput = document.getElementById("reauthPasswordInput");
  const reauthError = document.getElementById("reauthError");
  const reauthSubmitBtn = document.getElementById("reauthSubmitBtn");
  const reauthCancelBtn = document.getElementById("reauthCancelBtn");

  if (!overlay || !signInBtn || !settingsBtn || !settingsOverlay) return; // markup not present — nothing to wire up

  // Small bridge for app.js (classic script) — onboarding's email-
  // verification step needs auth state without importing the Firebase SDK.
  window.authBridge = {
    getCurrentUser,
    reloadCurrentUser,
    sendVerificationEmail,
    hasPasswordProvider,
    hasGoogleProvider,
    deleteCurrentUser,
    clearAuthCredentialFields
  };

  let mode = "signin";
  let modeLocked = false;
  let requireNewGoogleAccount = false;
  let existingAccountDetected = false;
  let currentUser = null;

  function renderMode() {
    titleEl.textContent = mode === "signin" ? "Sign in" : "Create account";
    submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account";
    modeToggleBtn.style.display = modeLocked ? "none" : "";
    modeToggleBtn.textContent = mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in";
    errorEl.classList.remove("show");
    existingAccountLink.style.display = "none";
    existingAccountDetected = false;
  }

  function openAuthModal(initialMode, opts) {
    closeModal(settingsOverlay);
    mode = initialMode || "signin";
    modeLocked = !!(opts && opts.lockMode);
    requireNewGoogleAccount = !!(opts && opts.requireNewAccount);
    emailInput.value = "";
    passwordInput.value = "";
    renderMode();
    openModal(overlay);
    setTimeout(() => emailInput.focus(), 50);
  }

  // Called by app.js's onboarding "Wrong email? Start over" handler right
  // after deleting the just-created auth user, so the modal doesn't still
  // hold the wrong email if something reads these fields before the user
  // taps "Create account" again — openAuthModal() also resets them on open,
  // this just closes the gap between deletion and that next open.
  function clearAuthCredentialFields() {
    emailInput.value = "";
    passwordInput.value = "";
  }

  // Lets onboarding's account-creation step (the final step, reached only
  // after completing onboarding as a new user) open this same modal rather
  // than app.js rebuilding its own Google/email form. Locked to signup —
  // anyone reaching that step has already gone through onboarding as a new
  // user, so there's no legitimate "sign in" path from there; an existing
  // user who ends up on that screen should use the separate escape hatch on
  // step 1 (window.openOnboardingSignInModal) instead, which exits
  // onboarding first. requireNewAccount additionally guards the Google
  // button: Google sign-in bypasses the toggle entirely (picking an
  // already-registered Google account signs straight into it), so that
  // path is checked separately after the OAuth popup resolves.
  window.openOnboardingAuthModal = () => openAuthModal("signup", { lockMode: true, requireNewAccount: true });

  // The step-1 "Already have an account? Sign in" escape hatch — opens this
  // same modal locked to signin. Onboarding itself is left running behind
  // the modal (app.js doesn't exit it beforehand): cancel returns to
  // onboarding untouched, while a successful sign-in is picked up by
  // hydrateFromFirestore()'s existing "signed in while onboarding-active"
  // branch, which exits onboarding to the planner once real account data
  // is confirmed.
  window.openOnboardingSignInModal = () => openAuthModal("signin", { lockMode: true });

  function renderAccountDetails(user) {
    if (!user) return;
    userEmailEl.textContent = user.email || "Signed in";

    const createdDate = user.metadata && user.metadata.creationTime ? formatDate(user.metadata.creationTime) : null;
    document.getElementById("authAccountCreated").textContent = createdDate ? `Member since ${createdDate}` : "";

    document.getElementById("authSubscriptionStatus").textContent = computeSubscriptionStatus();
    updateFreezeStatusDisplay();

    verifyBanner.style.display = user.emailVerified ? "none" : "flex";
    changePasswordBtn.style.display = hasPasswordProvider() ? "block" : "none";
  }

  settingsBtn.addEventListener("click", async () => {
    openModal(settingsOverlay);
    if (!currentUser) return;
    // Refresh emailVerified/metadata from the server — these don't update
    // on their own after e.g. clicking a verification link in another tab.
    try {
      const fresh = await reloadCurrentUser();
      currentUser = fresh;
      renderAccountDetails(fresh);
    } catch (err) {
      // Stale local state is an acceptable fallback here.
    }
  });
  settingsCloseBtn.addEventListener("click", () => closeModal(settingsOverlay));
  settingsOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(settingsOverlay); });

  signInBtn.addEventListener("click", () => openAuthModal());

  // Cancelling out of the "already have a Flit account" state (surfaced
  // when a Google sign-in during onboarding turns out to belong to an
  // existing user) must leave Firebase Auth itself signed out, not just
  // the UI reset — otherwise the background session from that Google
  // pick stays live even though the modal looks like a fresh form again.
  async function dismissAuthModal() {
    if (existingAccountDetected) {
      existingAccountDetected = false;
      try { await signOutUser(); } catch (err) { /* best-effort */ }
    }
    closeModal(overlay);
  }
  document.getElementById("authCancelBtn").addEventListener("click", dismissAuthModal);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") dismissAuthModal(); });

  modeToggleBtn.addEventListener("click", () => {
    if (modeLocked) return;
    mode = mode === "signin" ? "signup" : "signin";
    renderMode();
  });

  function notifyOnboardingAuthChanged() {
    if (document.body.classList.contains("onboarding-active")) {
      document.dispatchEvent(new CustomEvent("onboarding-auth-changed"));
    }
  }

  // signInWithGoogle() now triggers signInWithRedirect (see auth.js) —
  // required for Google sign-in to work inside a native WebView, but it
  // means the page navigates away to Google and back instead of resolving
  // a popup promise in place. This handler only fires the redirect and
  // persists what's needed to resume; the actual result (isNewUser check,
  // flushing onboarding's draft, closing this modal) is handled by
  // handleGoogleRedirectResult() below, once on the next load.
  const GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY = "flitGoogleRedirectRequireNewAccount";
  // Set by attemptDeleteAccount() below, right before it triggers
  // reauthenticateWithGoogle()'s redirect — see that function for why this
  // needs to survive a reload too (the account's Firestore data is already
  // gone by the time reauth is needed; only finishing deleteCurrentUser()
  // is left waiting on it).
  const GOOGLE_REDIRECT_DELETE_REAUTH_KEY = "flitGoogleRedirectDeleteReauth";

  document.getElementById("authGoogleBtn").addEventListener("click", async () => {
    // Firestore's own onSnapshot-driven "signed in" event can fire (often
    // from local cache, near-instantly for an account previously used on
    // this device) before handleGoogleRedirectResult() gets to inspect
    // isNewUser on the next load — that race is what let an existing-
    // account collision hydrate real data and advance onboarding ahead of
    // the sign-out. This flag tells app.js's listener to hold off until
    // that determination is made; see the "firestore-auth-ready" listener
    // in app.js. sessionStorage (not just the in-memory flags below)
    // because a real page reload is coming and would otherwise wipe them.
    if (requireNewGoogleAccount) {
      window.pendingGoogleAccountCheck = true;
      skipNextMigration();
      sessionStorage.setItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY, "1");
      if (typeof window.saveOnboardingStateForGoogleRedirect === "function") window.saveOnboardingStateForGoogleRedirect();
    }
    // TEMPORARY diagnostic logging — see handleGoogleRedirectResult()
    // below for the matching return-leg logs. Remove once a real-account
    // retest confirms Google sign-in actually works end to end.
    console.log("[flit-auth-debug] signInWithGoogle() about to redirect, origin:", location.origin);
    try {
      // Resolves before the redirect navigation completes (often before the
      // user even leaves) — never carries a sign-in result. If it rejects
      // (e.g. the redirect itself couldn't start), fall into the catch
      // below exactly as a popup failure used to.
      await signInWithGoogle();
      console.log("[flit-auth-debug] signInWithGoogle() returned without throwing (navigation should be underway)");
    } catch (err) {
      console.error("[flit-auth-debug] signInWithGoogle() threw:", err && err.code, err && err.message, err);
      if (requireNewGoogleAccount) {
        cancelSkipMigration();
        sessionStorage.removeItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY);
      }
      window.pendingGoogleAccountCheck = false;
      const msg = friendlyAuthError(err);
      if (msg) { errorEl.textContent = msg; errorEl.classList.add("show"); }
    }
  });

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // Shared by handleGoogleRedirectResult()'s main branch and
  // handleGoogleCreateAccountFallback() below — the create-account flow's
  // Google account turned out to already have a Flit account behind it,
  // whichever way that was determined.
  async function handleGoogleAccountCollision() {
    cancelSkipMigration();
    try { await signOutUser(); } catch (signOutErr) { /* best-effort */ }
    window.pendingGoogleAccountCheck = false;
    const stillSignedIn = getCurrentUser();
    if (stillSignedIn) {
      console.error("Sign-out after existing-account Google collision did not take effect — still signed in as", stillSignedIn.uid);
    }
    errorEl.textContent = "Looks like you already have a Flit account.";
    errorEl.classList.add("show");
    existingAccountLink.style.display = "block";
    existingAccountDetected = true;
    // The modal starts closed on this fresh page load (unlike the old
    // popup flow, where it had stayed open the whole time) — reopen it so
    // the error is actually visible.
    openModal(overlay);
  }

  // Fallback for the "create account" flow specifically, when
  // checkGoogleRedirectResult() fails to resolve with a UserCredential
  // (real-device testing showed this happening consistently, across
  // multiple devices/accounts/networks — a genuine Firebase/browser
  // storage issue, not something code alone can force to resolve). Polls
  // briefly for auth.currentUser in case onAuthStateChanged just hasn't
  // caught up yet by this exact tick, then substitutes a direct Firestore
  // existence check for getAdditionalUserInfo(result).isNewUser, which
  // needs a result this path doesn't have.
  async function handleGoogleCreateAccountFallback() {
    let user = getCurrentUser();
    for (let i = 0; i < 10 && !user; i++) {
      await wait(200);
      user = getCurrentUser();
    }

    if (!user) {
      // Genuinely never signed in (cancelled, or the redirect truly
      // failed) — nothing more to do. Leaves the restored onboarding
      // screen as-is so the user can just try again.
      console.log("[flit-auth-debug] create-account fallback: no signed-in user found after polling — treating as a failed/cancelled attempt");
      sessionStorage.removeItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY);
      window.pendingGoogleAccountCheck = false;
      return;
    }

    let alreadyExists;
    try {
      alreadyExists = await userDocExists(user.uid);
    } catch (err) {
      console.error("[flit-auth-debug] create-account fallback: userDocExists() threw:", err);
      // Can't tell either way — safer to treat as a collision (back out)
      // than risk flushing a fresh draft over an existing account's data.
      alreadyExists = true;
    }
    console.log("[flit-auth-debug] create-account fallback: uid =", user.uid, "alreadyExists =", alreadyExists);

    if (alreadyExists) {
      await handleGoogleAccountCollision();
      return;
    }

    await flushOnboardingDraft(user.uid);
    window.pendingGoogleAccountCheck = false;
    if (typeof window.hydrateFromFirestore === "function") window.hydrateFromFirestore();
    closeModal(overlay);
    notifyOnboardingAuthChanged();
  }

  // Called once below, on every load. Resolves non-null exactly when this
  // load is the browser returning from the signInWithGoogle() redirect
  // above — every other load (fresh visit, refresh of an already-signed-in
  // session) resolves null here and is already handled by onAuthChange.
  async function handleGoogleRedirectResult() {
    const wasDeleteReauth = sessionStorage.getItem(GOOGLE_REDIRECT_DELETE_REAUTH_KEY) === "1";

    console.log("[flit-auth-debug] handleGoogleRedirectResult() running on load, origin:", location.origin);
    let result;
    try {
      result = await checkGoogleRedirectResult();
    } catch (err) {
      console.error("[flit-auth-debug] checkGoogleRedirectResult() threw:", err && err.code, err && err.message, err);
      sessionStorage.removeItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY);
      sessionStorage.removeItem(GOOGLE_REDIRECT_DELETE_REAUTH_KEY);
      window.pendingGoogleAccountCheck = false;
      if (wasDeleteReauth) {
        // Firestore data is already gone (deleteAllUserData ran before this
        // reauth was ever triggered) — there's nothing left to lose, just a
        // dangling Auth account that never finished being removed.
        notify("Your data was deleted, but we couldn't finish removing your account. Please try again from Settings.", "warning");
        return;
      }
      const msg = friendlyAuthError(err);
      if (msg) { errorEl.textContent = msg; errorEl.classList.add("show"); openModal(overlay); }
      return;
    }
    // TEMPORARY diagnostic logging — added to investigate a real-account
    // test where existing-user sign-in from onboarding landed at raw step
    // 1 instead of the main app. Remove once a real-account retest
    // confirms the fix below actually resolves it.
    console.log("[flit-auth-debug] checkGoogleRedirectResult() resolved:", result ? { uid: result.user.uid, email: result.user.email } : null);

    if (!result) {
      // Real-device testing showed this resolving null even after a
      // visibly successful Google sign-in — a genuine, reproducible
      // Firebase/browser-storage issue, not an app logic bug on its own.
      // The plain "existing user" case is already covered independently
      // by onAuthChange above (Firebase's core auth-state listener, which
      // keeps firing correctly regardless of this promise). The one thing
      // that still depended entirely on `result` was the "create account"
      // flow's collision check — and returning here unconditionally used
      // to leave window.pendingGoogleAccountCheck stuck true forever,
      // which also silently blocks app.js's own firestore-auth-ready/
      // firestore-data-changed listeners (see their own guards) — the
      // exact "stuck on the restored 'Save your progress' screen forever"
      // symptom. Fall back to a direct Firestore existence check instead
      // of giving up when this was a create-account attempt.
      if (!wasDeleteReauth && sessionStorage.getItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY) === "1") {
        console.log("[flit-auth-debug] result is null but this was a create-account attempt — falling back to a direct sign-in-state check");
        await handleGoogleCreateAccountFallback();
      } else {
        window.pendingGoogleAccountCheck = false;
      }
      return;
    }

    if (wasDeleteReauth) {
      sessionStorage.removeItem(GOOGLE_REDIRECT_DELETE_REAUTH_KEY);
      // Resuming attemptDeleteAccount()'s auth/requires-recent-login branch
      // after the redirect round trip: the reauth itself just succeeded
      // (we have a fresh result), so retry the one thing that was actually
      // waiting on it. No modal/confirmation state to restore here — the
      // deletion was already irrevocably committed (data gone) before this
      // redirect ever started, so finishing quietly is the right resume
      // behavior, not re-showing a confirmation the user already gave.
      try {
        await deleteCurrentUser();
        finishAccountDeletion();
      } catch (err) {
        notify("Your data was deleted, but we couldn't finish removing your account. Please try again from Settings.", "warning");
      }
      return;
    }

    const wasRequireNewAccount = sessionStorage.getItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY) === "1";
    sessionStorage.removeItem(GOOGLE_REDIRECT_REQUIRE_NEW_ACCOUNT_KEY);

    // isNewUser is the ground truth for what actually happened — computed
    // for every redirect return, not just the ones that came from the
    // dedicated "create account" button. wasRequireNewAccount only
    // captures *intent* (which button the user clicked before the
    // redirect fired) and is what previously gated this whole check, which
    // was the bug: an existing user signing in via onboarding's "already
    // have an account" link (wasRequireNewAccount === false) never got an
    // isNewUser check at all, so nothing ever corrected the onboarding
    // step/draft state saveOnboardingStateForGoogleRedirect() may have
    // left behind from an earlier attempt in the same tab, leaving them
    // stuck on the onboarding screen after a fully successful sign-in.
    const info = getAdditionalUserInfo(result);
    const isNewUser = !!(info && info.isNewUser);
    console.log("[flit-auth-debug] wasRequireNewAccount:", wasRequireNewAccount, "isNewUser:", isNewUser);

    if (isNewUser) {
      // Genuinely new account — same treatment whether they came via the
      // dedicated "create account" button (expected) or ended up here via
      // "already have an account" by mistake (unexpected, but the correct
      // outcome is identical: flush this fresh account's onboarding draft
      // in, same as the normal signup path). Flushing before hydrating so
      // the mirror hydrateFromFirestore() reads from already has real data
      // instead of a still-empty collection.
      await flushOnboardingDraft(result.user.uid);
      window.pendingGoogleAccountCheck = false;
      if (typeof window.hydrateFromFirestore === "function") window.hydrateFromFirestore();
    } else if (wasRequireNewAccount) {
      // Expected a new account (the dedicated "create account" button) but
      // this Google account already has a Flit account behind it — back
      // out rather than letting them land in the app as if they'd just
      // finished setup on someone else's account.
      await handleGoogleAccountCollision();
      return;
    } else {
      // An existing account signing in normally (onboarding's "already
      // have an account" link, or step 1's own escape hatch). Explicitly
      // undo any onboarding step/draft state that may have been
      // optimistically restored — an existing user must never resume or
      // re-enter onboarding, regardless of what screen they started from.
      console.log("[flit-auth-debug] existing-user branch: calling clearRestoredOnboardingState()");
      if (typeof window.clearRestoredOnboardingState === "function") window.clearRestoredOnboardingState();
      // The actual fix: clearing onboarding state above only stops the
      // wrong screen from showing — it never loads this account's real
      // data or reveals the app on its own. That was previously left to
      // the independent firestore-auth-ready/firestore-data-changed event
      // chain, which a real-account test showed doesn't reliably do it in
      // time (landing at raw, uncorrected onboarding step 1 rather than
      // any restored/stuck state means nothing ever ran to correct the
      // bootstrap's default guess). Calling hydrateFromFirestore()
      // directly removes that dependency for this specific, critical
      // moment — it's a safe no-op if firestoreBridge isn't marked signed
      // in yet (the later event-driven call still does the real work
      // then), and the actual fix if it already is.
      window.pendingGoogleAccountCheck = false;
      console.log("[flit-auth-debug] existing-user branch: calling hydrateFromFirestore(), firestoreBridge.isSignedIn() =", !!(window.firestoreBridge && window.firestoreBridge.isSignedIn()));
      if (typeof window.hydrateFromFirestore === "function") window.hydrateFromFirestore();
    }
    closeModal(overlay);
    notifyOnboardingAuthChanged();
  }
  handleGoogleRedirectResult().catch(err => {
    // Any uncaught throw above (flushOnboardingDraft, hydrateFromFirestore,
    // etc.) would otherwise die silently — this was invoked fire-and-forget
    // with no .catch() of its own, so nothing after the throw point (up to
    // and including closeModal/notifyOnboardingAuthChanged) would run, and
    // there'd be no trace of why. Logged, not swallowed.
    console.error("[flit-auth-debug] handleGoogleRedirectResult() threw:", err);
  });

  existingAccountLink.addEventListener("click", async () => {
    // Same guarantee as the Cancel path: don't carry the rejected Google
    // session forward into the sign-in flow, even though it was already
    // signed out once at detection time above — belt and suspenders.
    existingAccountDetected = false;
    try { await signOutUser(); } catch (err) { /* best-effort */ }
    // Reroute through step 1's own sign-in escape hatch: jump onboarding
    // back to step 1 first so a real sign-in from here is treated the same
    // as that entry point (hydrateFromFirestore() exits to the planner),
    // rather than being mistaken for just having finished the create-
    // account step.
    if (typeof window.goToOnboardingStep === "function") window.goToOnboardingStep(1);
    openAuthModal("signin", { lockMode: true });
  });

  submitBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      errorEl.textContent = "Enter both an email and a password.";
      errorEl.classList.add("show");
      return;
    }
    errorEl.classList.remove("show");
    submitBtn.disabled = true;
    const fromOnboarding = document.body.classList.contains("onboarding-active");
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
        closeModal(overlay);
        notifyOnboardingAuthChanged();
      } else {
        if (fromOnboarding) skipNextMigration();
        const result = await signUpWithEmail(email, password);
        closeModal(overlay);
        // The account exists at this point regardless of whether the
        // verification email itself succeeded — flush now rather than
        // waiting on verification, which is a separate concern.
        if (fromOnboarding) await flushOnboardingDraft(result.credential.user.uid);
        if (result.verificationError) {
          notify("Account created, but the verification email could not be sent. Use Resend to try again.", "error");
          notifyOnboardingAuthChanged();
        } else if (fromOnboarding) {
          notify("Verification email sent. Check your inbox.", "success");
          notifyOnboardingAuthChanged();
        } else {
          notify("Account created. Check your email to verify it.", "success");
        }
      }
    } catch (err) {
      if (fromOnboarding && mode !== "signin") cancelSkipMigration();
      const msg = friendlyAuthError(err);
      if (msg) { errorEl.textContent = msg; errorEl.classList.add("show"); }
    } finally {
      submitBtn.disabled = false;
    }
  });

  signOutBtn.addEventListener("click", () => {
    closeModalInstant(settingsOverlay);
    confirmSignOut(() => signOutUser());
  });

  resendVerifyBtn.addEventListener("click", async () => {
    resendVerifyBtn.disabled = true;
    try {
      await sendVerificationEmail();
      notify("Verification email sent.", "success");
    } catch (err) {
      // Logged rather than silently swallowed — Firebase's own error.code
      // (e.g. auth/too-many-requests from its send-verification rate
      // limit, or auth/unauthorized-domain if this origin isn't in the
      // Firebase Console's Authentication > Settings > Authorized domains
      // list) is the actual cause and worth seeing in devtools.
      console.error("sendEmailVerification failed:", err);
      const msg = err && err.code === "auth/too-many-requests"
        ? "Too many attempts. Please wait a few minutes and try again."
        : "Couldn't send verification email. Try again shortly.";
      notify(msg, "warning");
    } finally {
      resendVerifyBtn.disabled = false;
    }
  });

  // --- Change password ---
  changePasswordBtn.addEventListener("click", () => {
    closeModalInstant(settingsOverlay);
    changePwCurrentInput.value = "";
    changePwNewInput.value = "";
    changePwError.classList.remove("show");
    openModal(changePwOverlay);
    setTimeout(() => changePwCurrentInput.focus(), 50);
  });

  function backToSettings(el) {
    closeModal(el);
    openModal(settingsOverlay);
  }

  changePwCancelBtn.addEventListener("click", () => backToSettings(changePwOverlay));
  changePwOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") backToSettings(changePwOverlay); });

  changePwSaveBtn.addEventListener("click", async () => {
    const current = changePwCurrentInput.value;
    const next = changePwNewInput.value;
    if (!current || !next) {
      changePwError.textContent = "Enter your current and new password.";
      changePwError.classList.add("show");
      return;
    }
    if (next.length < 6) {
      changePwError.textContent = "New password should be at least 6 characters.";
      changePwError.classList.add("show");
      return;
    }
    changePwError.classList.remove("show");
    changePwSaveBtn.disabled = true;
    try {
      // Firebase requires the current password be freshly verified via
      // reauthenticateWithCredential immediately before updatePassword will
      // succeed — a stale sign-in isn't sufficient.
      await reauthenticateWithPassword(current);
      await changePassword(next);
      backToSettings(changePwOverlay);
      notify("Password updated.", "success");
    } catch (err) {
      changePwError.textContent = friendlyPasswordError(err);
      changePwError.classList.add("show");
    } finally {
      changePwSaveBtn.disabled = false;
    }
  });

  // --- Reauth prompt (used when account deletion requires a fresh sign-in) ---
  let pendingReauthResolve = null;
  let pendingReauthReject = null;

  function openReauthModal() {
    reauthPasswordInput.value = "";
    reauthError.classList.remove("show");
    openModal(reauthOverlay);
    setTimeout(() => reauthPasswordInput.focus(), 50);
    return new Promise((resolve, reject) => {
      pendingReauthResolve = resolve;
      pendingReauthReject = reject;
    });
  }

  reauthCancelBtn.addEventListener("click", () => {
    closeModal(reauthOverlay);
    if (pendingReauthReject) {
      pendingReauthReject(new Error("cancelled"));
      pendingReauthResolve = pendingReauthReject = null;
    }
  });
  reauthOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") reauthCancelBtn.click(); });

  reauthSubmitBtn.addEventListener("click", async () => {
    const pw = reauthPasswordInput.value;
    if (!pw) {
      reauthError.textContent = "Enter your password.";
      reauthError.classList.add("show");
      return;
    }
    reauthError.classList.remove("show");
    reauthSubmitBtn.disabled = true;
    try {
      await reauthenticateWithPassword(pw);
      closeModal(reauthOverlay);
      if (pendingReauthResolve) {
        pendingReauthResolve();
        pendingReauthResolve = pendingReauthReject = null;
      }
    } catch (err) {
      reauthError.textContent = friendlyPasswordError(err);
      reauthError.classList.add("show");
    } finally {
      reauthSubmitBtn.disabled = false;
    }
  });

  // --- Delete account ---
  function finishAccountDeletion() {
    notify("Account deleted.", "info");
    localStorage.clear();
    // A full reload re-runs the app's normal startup check (onboardingComplete
    // + no categories → show onboarding), the simplest reliable way to land
    // back in the signed-out/onboarding state without duplicating that logic.
    setTimeout(() => window.location.reload(), 500);
  }

  async function attemptDeleteAccount() {
    const user = getCurrentUser();
    if (!user) return;
    try {
      // Must delete Firestore data BEFORE the Auth account — once
      // deleteCurrentUser() succeeds the ID token is invalidated and these
      // writes would fail the isOwner() security rule.
      await window.firestoreBridge.deleteAllUserData(user.uid);
      await deleteCurrentUser();
      finishAccountDeletion();
    } catch (err) {
      if (err && err.code === "auth/requires-recent-login") {
        // Data is already gone at this point (deleteAllUserData succeeded —
        // only deleteCurrentUser can throw this code). Just need one more
        // fresh sign-in to finish removing the now-empty Auth account.
        try {
          if (hasGoogleProvider()) {
            // reauthenticateWithGoogle() now redirects the whole page to
            // Google and back (see auth.js) — it resolves before that
            // navigation completes, not with a result, so nothing after
            // this call in this try block ever runs for the Google case.
            // handleGoogleRedirectResult() picks this back up on the next
            // load via the flag set here, retries deleteCurrentUser(), and
            // calls finishAccountDeletion() itself.
            sessionStorage.setItem(GOOGLE_REDIRECT_DELETE_REAUTH_KEY, "1");
            await reauthenticateWithGoogle();
            return;
          }
          await openReauthModal();
          await deleteCurrentUser();
          finishAccountDeletion();
        } catch (reauthErr) {
          sessionStorage.removeItem(GOOGLE_REDIRECT_DELETE_REAUTH_KEY);
          if (reauthErr && reauthErr.message !== "cancelled") {
            notify("Your data was deleted, but we couldn't finish removing your account. Please try again from Settings.", "warning");
          }
        }
      } else {
        notify("Couldn't delete your account. Please try again.", "warning");
      }
    }
  }

  deleteAccountBtn.addEventListener("click", () => {
    const user = getCurrentUser();
    if (!user || typeof window.showConfirm !== "function") return;
    closeModalInstant(settingsOverlay);
    const email = user.email || "";
    window.showConfirm({
      title: "Delete account",
      message: "This permanently deletes your account and all of your data: tasks, categories, reflections, deep work history, presets, and custom reminders. This cannot be undone.",
      confirmLabel: "Delete account",
      danger: true,
      requireText: {
        placeholder: email ? `Type "delete" or your email to confirm` : `Type "delete" to confirm`,
        isValid: (val) => {
          const v = val.trim().toLowerCase();
          return v === "delete" || (!!email && v === email.toLowerCase());
        }
      },
      onConfirm: () => attemptDeleteAccount()
    });
  });

  // onAuthChange fires once on every page load with whatever auth state was
  // already persisted (per auth.js), not just on a fresh sign-in — without
  // this flag, a returning signed-in user would get a "Signed in." toast on
  // every single page refresh, not just when they actually tap sign-in.
  let initialAuthResolved = false;

  onAuthChange((user, migrationResult) => {
    const isInitialLoad = !initialAuthResolved;
    initialAuthResolved = true;
    currentUser = user;

    if (user) {
      signInBtn.style.display = "none";
      statusPill.style.display = "flex";
      renderAccountDetails(user);
    } else {
      signInBtn.style.display = "flex";
      statusPill.style.display = "none";
    }

    // The actual fix for "Google sign-in from onboarding lands on the
    // wrong screen": onAuthChange fires via auth.js's onAuthStateChanged —
    // Firebase's own core auth-state listener, which reliably fires
    // whenever a session is established by ANY means (redirect, popup,
    // persisted reload) — completely independent of whether
    // checkGoogleRedirectResult() happens to resolve with a UserCredential.
    // Real-device testing showed getRedirectResult() consistently
    // resolving null even after Google sign-in visibly succeeded, which
    // silently broke the whole isNewUser-branching path in
    // handleGoogleRedirectResult() below (gated entirely behind that
    // promise) — while this listener, and email/password sign-in which
    // already routed through it correctly, kept working the whole time.
    // Two separate reasons this must not fire while an account-creation
    // attempt is actually in flight from onboarding's own account-creation
    // screen (step 12): window.pendingGoogleAccountCheck covers the narrow
    // window while Google's isNewUser collision check is unresolved, and
    // isOnboardingAtAccountCreationStep() covers the email create-account
    // path (which never sets that flag at all) — without it, this would
    // fire the instant the new email account's onAuthStateChanged lands,
    // wiping onboardingDraft to null via clearRestoredOnboardingState()
    // before the submit handler's own flushOnboardingDraft(uid) call ever
    // gets to read it, silently dropping the new user's entire onboarding
    // setup. Both create-account paths get their own dedicated handling
    // elsewhere; this is only for "existing user signed in from some
    // other onboarding screen."
    if (user && document.body.classList.contains("onboarding-active") && !window.pendingGoogleAccountCheck
        && !(typeof window.isOnboardingAtAccountCreationStep === "function" && window.isOnboardingAtAccountCreationStep())) {
      console.log("[flit-auth-debug] onAuthChange: signed-in user while onboarding-active (not a pending create-account check) — treating as existing-account sign-in, exiting onboarding");
      if (typeof window.clearRestoredOnboardingState === "function") window.clearRestoredOnboardingState();
      if (typeof window.hydrateFromFirestore === "function") window.hydrateFromFirestore();
    }

    if (migrationResult && migrationResult.reason === "onboarding") {
      // Skipped deliberately (skipNextMigration()) — the submit/Google
      // handler above already showed its own toast for this sign-in.
    } else if (migrationResult && migrationResult.reason === "error") {
      notify("Signed in, but syncing your data failed. It'll retry next time you sign in.", "warning");
    } else if (migrationResult && migrationResult.imported) {
      notify(`Signed in. Synced ${migrationResult.taskCount} task${migrationResult.taskCount === 1 ? "" : "s"} to your account.`, "success");
    } else if (user && !isInitialLoad) {
      notify("Signed in.", "success");
    }
  });

  // Billing/trial data arrives asynchronously (separate onSnapshot from the
  // user object itself) — refresh just the subscription line when it lands.
  document.addEventListener("firestore-data-changed", (e) => {
    if (!currentUser) return;
    if (e.detail.key === "billing" || e.detail.key === "userDoc") {
      document.getElementById("authSubscriptionStatus").textContent = computeSubscriptionStatus();
      updateFreezeStatusDisplay();
    }
  });
});
