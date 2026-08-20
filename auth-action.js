import { auth } from "./firebase-init.js";
import { AUTH_ACTION_URL } from "./auth.js";
import {
  applyActionCode,
  checkActionCode,
  sendEmailVerification,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const iconWrap = document.getElementById("authActionIconWrap");
const titleEl = document.getElementById("authActionTitle");
const textEl = document.getElementById("authActionText");
const errorEl = document.getElementById("authActionError");
const primaryBtn = document.getElementById("authActionPrimaryBtn");
const resendBtn = document.getElementById("authActionResendBtn");

function setIcon(name, variant) {
  const cls = "auth-action-icon" + (variant === "danger" ? " auth-action-icon-danger" : "");
  iconWrap.innerHTML = `<i data-lucide="${name}" class="${cls}"></i>`;
  lucide.createIcons();
}

function showPrimaryOpenAppButton() {
  primaryBtn.textContent = "Open Flit";
  primaryBtn.style.display = "block";
  primaryBtn.onclick = () => { window.location.href = "index.html"; };
}

function showSuccess() {
  setIcon("check-circle-2");
  titleEl.textContent = "Email verified.";
  textEl.textContent = "You're all set. Head back to Flit to keep going.";
  showPrimaryOpenAppButton();
}

// Offers a working resend when possible (the browser has an active,
// still-unverified session) rather than a dead-end error screen. If
// there's no session here (e.g. the link was opened on a different device
// than the one that signed up), resending isn't possible from this page —
// Settings already has the same control once they're signed in there.
function offerResend() {
  onAuthStateChanged(auth, (user) => {
    if (user && !user.emailVerified) {
      resendBtn.style.display = "block";
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend verification email";
      resendBtn.onclick = async () => {
        resendBtn.disabled = true;
        resendBtn.textContent = "Sending";
        errorEl.classList.remove("show");
        try {
          await sendEmailVerification(user, { url: AUTH_ACTION_URL });
          resendBtn.textContent = "Sent. Check your inbox.";
        } catch (err) {
          resendBtn.disabled = false;
          resendBtn.textContent = "Resend verification email";
          errorEl.textContent = err && err.code === "auth/too-many-requests"
            ? "Too many attempts. Wait a few minutes, then try again."
            : "Couldn't send the email. Try again shortly.";
          errorEl.classList.add("show");
        }
      };
    } else {
      showPrimaryOpenAppButton();
      if (!user) {
        textEl.textContent += " Sign in to Flit, then resend from Settings.";
      }
    }
  });
}

function showFailure(title, message) {
  setIcon("alert-circle", "danger");
  titleEl.textContent = title;
  textEl.textContent = message;
  offerResend();
}

async function run() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  if (mode !== "verifyEmail" || !oobCode) {
    showFailure("This isn't a valid verification link.", "Copy the link from your email again, or request a new one below.");
    return;
  }

  try {
    await checkActionCode(auth, oobCode);
    await applyActionCode(auth, oobCode);
    showSuccess();
  } catch (err) {
    const code = err && err.code;
    let title, message;
    if (code === "auth/user-disabled") {
      title = "This account has been disabled.";
      message = "Contact support if you think this is a mistake.";
    } else if (code === "auth/user-not-found") {
      title = "We couldn't find the account for this link.";
      message = "It may have already been deleted.";
    } else {
      // Covers auth/invalid-action-code and auth/expired-action-code. These
      // links are single-use, and some email providers' security scanners
      // open links automatically before a person ever clicks them — so a
      // link can end up "used" without the user doing anything wrong.
      // Framing this as broken/invalid is misleading; framing it as
      // already-used-or-expired with an easy resend is both more accurate
      // and less alarming.
      title = "This link may have already been used or expired.";
      message = "Verification links only work once. Request a new one below and use it as soon as it arrives.";
    }
    showFailure(title, message);
  }
}

run();
