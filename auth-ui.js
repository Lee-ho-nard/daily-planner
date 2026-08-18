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
  deleteCurrentUser
} from "./auth.js";

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
  if (code === "auth/email-already-in-use") return "That email is already registered — try signing in instead.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Incorrect email or password.";
  if (code === "auth/weak-password") return "Password should be at least 6 characters.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
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
    if (daysLeft > 0) return `Free trial — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  }
  return "Free plan";
}

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("authModalOverlay");
  const emailInput = document.getElementById("authEmailInput");
  const passwordInput = document.getElementById("authPasswordInput");
  const errorEl = document.getElementById("authError");
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

  let mode = "signin";
  let currentUser = null;

  function renderMode() {
    titleEl.textContent = mode === "signin" ? "Sign in" : "Create account";
    submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account";
    modeToggleBtn.textContent = mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in";
    errorEl.classList.remove("show");
  }

  function openAuthModal(initialMode) {
    closeModal(settingsOverlay);
    mode = initialMode || "signin";
    emailInput.value = "";
    passwordInput.value = "";
    renderMode();
    openModal(overlay);
    setTimeout(() => emailInput.focus(), 50);
  }

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
  const accountNudgeCreateBtn = document.getElementById("accountNudgeCreateBtn");
  if (accountNudgeCreateBtn) accountNudgeCreateBtn.addEventListener("click", () => openAuthModal("signup"));
  document.getElementById("authCancelBtn").addEventListener("click", () => closeModal(overlay));
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(overlay); });

  modeToggleBtn.addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    renderMode();
  });

  document.getElementById("authGoogleBtn").addEventListener("click", async () => {
    try {
      await signInWithGoogle();
      closeModal(overlay);
    } catch (err) {
      const msg = friendlyAuthError(err);
      if (msg) { errorEl.textContent = msg; errorEl.classList.add("show"); }
    }
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
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        notify("Account created — check your email to verify it.", "success");
      }
      closeModal(overlay);
    } catch (err) {
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
      message: "This permanently deletes your account and all of your data — tasks, categories, reflections, deep work history, and presets. This cannot be undone.",
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

    if (migrationResult && migrationResult.reason === "error") {
      notify("Signed in, but syncing your data failed. It'll retry next time you sign in.", "warning");
    } else if (migrationResult && migrationResult.imported) {
      notify(`Signed in — synced ${migrationResult.taskCount} task${migrationResult.taskCount === 1 ? "" : "s"} to your account.`, "success");
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
