import {
  signInWithGoogle,
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
import { writeOnboardingData } from "./migrate.js";

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
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
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
    hasGoogleProvider
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

  document.getElementById("authGoogleBtn").addEventListener("click", async () => {
    // Firestore's own onSnapshot-driven "signed in" event can fire (often
    // from local cache, near-instantly for an account previously used on
    // this device) before this handler even gets to inspect isNewUser below
    // — that race is what let an existing-account collision hydrate real
    // data and advance onboarding ahead of the sign-out further down. This
    // flag tells app.js's listener to hold off until this handler has made
    // its determination; see the "firestore-auth-ready" listener in app.js.
    if (requireNewGoogleAccount) {
      window.pendingGoogleAccountCheck = true;
      skipNextMigration();
    }
    try {
      const result = await signInWithGoogle();
      if (requireNewGoogleAccount) {
        const info = getAdditionalUserInfo(result);
        if (!info || !info.isNewUser) {
          // This Google account already has a Flit account behind it —
          // signInWithPopup just silently signed into it instead of
          // creating a new one. Onboarding is new-users-only, so back out
          // immediately rather than letting them land in the app as if
          // they'd just finished setup on someone else's account.
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
          return;
        }
        // Genuinely new account: flush onboarding's draft to Firestore
        // before hydrating, so the mirror this pulls from already has real
        // data instead of a still-empty collection. The "firestore-auth-
        // ready" event above was held back (or hadn't fired yet) while the
        // isNewUser check above was pending. Clear the guard and, since
        // that event only ever dispatches once per uid, explicitly run the
        // hydrate it would have triggered — later "firestore-data-changed"
        // events keep it in sync from here same as any other sign-up.
        await flushOnboardingDraft(result.user.uid);
        window.pendingGoogleAccountCheck = false;
        if (typeof window.hydrateFromFirestore === "function") window.hydrateFromFirestore();
      }
      closeModal(overlay);
      notifyOnboardingAuthChanged();
    } catch (err) {
      if (requireNewGoogleAccount) cancelSkipMigration();
      window.pendingGoogleAccountCheck = false;
      const msg = friendlyAuthError(err);
      if (msg) { errorEl.textContent = msg; errorEl.classList.add("show"); }
    }
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
            await reauthenticateWithGoogle();
          } else {
            await openReauthModal();
          }
          await deleteCurrentUser();
          finishAccountDeletion();
        } catch (reauthErr) {
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
      message: "This permanently deletes your account and all of your data: tasks, categories, reflections, deep work history, and presets. This cannot be undone.",
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
    }
  });
});
