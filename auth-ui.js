import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  signOutUser,
  onAuthChange
} from "./auth.js";

// Local open/close helpers matching app.js's .modal-overlay "open" class
// pattern (styles.css), kept self-contained rather than depending on
// app.js's globals — the only intentional touch points with app.js's
// existing surface are showToast() (toast notifications) and showConfirm()
// (the sign-out confirmation below, reusing the same pattern already used
// for task/category deletion), both used defensively.
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

  if (!overlay || !signInBtn || !settingsBtn || !settingsOverlay) return; // markup not present — nothing to wire up

  let mode = "signin";

  function renderMode() {
    titleEl.textContent = mode === "signin" ? "Sign in" : "Create account";
    submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account";
    modeToggleBtn.textContent = mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in";
    errorEl.classList.remove("show");
  }

  function openAuthModal() {
    closeModal(settingsOverlay);
    mode = "signin";
    emailInput.value = "";
    passwordInput.value = "";
    renderMode();
    openModal(overlay);
    setTimeout(() => emailInput.focus(), 50);
  }

  settingsBtn.addEventListener("click", () => openModal(settingsOverlay));
  settingsCloseBtn.addEventListener("click", () => closeModal(settingsOverlay));
  settingsOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(settingsOverlay); });

  signInBtn.addEventListener("click", openAuthModal);
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

  onAuthChange((user, migrationResult) => {
    if (user) {
      signInBtn.style.display = "none";
      statusPill.style.display = "flex";
      userEmailEl.textContent = user.email || "Signed in";
    } else {
      signInBtn.style.display = "flex";
      statusPill.style.display = "none";
    }

    if (migrationResult && migrationResult.reason === "error") {
      notify("Signed in, but syncing your data failed. It'll retry next time you sign in.", "warning");
    } else if (migrationResult && migrationResult.imported) {
      notify(`Signed in — synced ${migrationResult.taskCount} task${migrationResult.taskCount === 1 ? "" : "s"} to your account.`, "success");
    } else if (user) {
      notify("Signed in.", "success");
    }
  });
});
