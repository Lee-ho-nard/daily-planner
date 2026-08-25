  let tasks = JSON.parse(localStorage.getItem("tasks")) || [];
  let categories = JSON.parse(localStorage.getItem("categories")) || [];
  categories = categories.filter(c => c && typeof c === "object" && c.name && c.color);
  localStorage.setItem("categories", JSON.stringify(categories));

  let currentDate = new Date();
  let activeCategory = "All";
  let editingTaskId = null;
  let lastAddedTaskId = null;
  let selectedColor = null;
  let sortableInstance = null;
  let selectedWeekdays = [];
  let currentView = "planner";
  let selectMode = false;
  let selectedTaskIds = new Set();

  const PALETTE = ["#B8D8BA", "#F4C7A8", "#A8C8E8", "#D4B8E8", "#F4D48A", "#9EDAD1", "#F0B8D4", "#C5C9D4", "#F4B8AA", "#C7BFD4", "#B8E0C8", "#E8CB8A", "#A8B8E8", "#E0C9A6", "#F0C2CE", "#C3D4B0"];
  const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

  // Trial: 7 days from the Day 1 seal (first "End Day" completion), not
  // from account creation or first app load — matches roadmap #7 ("trial
  // placed after Day 1 seal, not before onboarding"). Works whether or not
  // the user has an account: signed-in trial start lives on the
  // Firestore users/{uid} doc (synced across devices), signed-out trial
  // start lives in localStorage (this device only). Either way it's a
  // real timestamp that gets checked against elapsed time on every call —
  // not a flag that, once set, stays true forever.
  // Declared up here (not next to the functions that use them, further
  // down) because isPremiumUser() gets called during initial synchronous
  // script execution (applySelectedTheme() etc., a few hundred lines
  // below) — const bindings aren't hoisted the way function declarations
  // are, so referencing these before this line runs threw a
  // "Cannot access before initialization" ReferenceError that broke the
  // entire rest of the script.
  const TRIAL_DURATION_DAYS = 7;
  const LOCAL_TRIAL_START_KEY = "trialStartDate";

  // Premium accent theme presets. The actual CSS custom-property swap lives in
  // styles.css as :root[data-selected-theme="X"] rules (light) paired with
  // :root[data-selected-theme="X"][data-theme="dark"] rules (dark), so light/dark
  // both stay correct automatically as the app already toggles [data-theme] per
  // view. This object only drives the picker UI (name + preview swatch).
  const THEMES = {
    forest: { label: "Forest", light: { accent: "#2F5233" }, dark: { accent: "#4F7A5C" } },
    slate: { label: "Slate", light: { accent: "#4A6B8A" }, dark: { accent: "#7FA3C4" } },
    terracotta: { label: "Terracotta", light: { accent: "#AD5A38" }, dark: { accent: "#D68A5F" } },
    plum: { label: "Plum", light: { accent: "#6B4C7A" }, dark: { accent: "#A57FB8" } },
    ink: { label: "Ink", light: { accent: "#4A5568" }, dark: { accent: "#8A97AB" } },
    moss: { label: "Moss", light: { accent: "#5C6B3D" }, dark: { accent: "#93A369" } },
    clay: { label: "Clay", light: { accent: "#A85C52" }, dark: { accent: "#CC8B80" } },
    ocean: { label: "Ocean", light: { accent: "#3D6B70" }, dark: { accent: "#6FA5AB" } }
  };

  function setIcon(el, name, extraClass) {
    el.innerHTML = `<i data-lucide="${name}" class="icon${extraClass ? " " + extraClass : ""}"></i>`;
    lucide.createIcons();
  }

  let toastEl = null;
  let toastHideTimeout = null;
  const TOAST_ICONS = { info: "info", warning: "alert-triangle", success: "check-circle-2" };
  function showToast(message, variant, duration) {
    variant = variant || "info";
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastHideTimeout);
    const iconColor = variant === "success" ? "var(--accent)" : "var(--text-secondary)";
    toastEl.innerHTML = `<i data-lucide="${TOAST_ICONS[variant]}" class="icon" style="color:${iconColor};"></i><span>${message}</span>`;
    lucide.createIcons();
    toastEl.classList.remove("visible");
    void toastEl.offsetWidth;
    toastEl.classList.add("visible");
    toastHideTimeout = setTimeout(() => {
      toastEl.classList.remove("visible");
    }, duration || 2500);
  }

  let confirmOverlayEl = null;
  // requireText: { placeholder, isValid(value) } — when set, the confirm
  // button starts disabled and only enables once isValid() passes, so a
  // destructive action (e.g. account deletion) can't be confirmed with a
  // single accidental tap.
  function showConfirm({ title, message, confirmLabel, danger, onConfirm, statsHtml, requireText }) {
    if (!confirmOverlayEl) {
      confirmOverlayEl = document.createElement("div");
      confirmOverlayEl.className = "modal-overlay";
      document.body.appendChild(confirmOverlayEl);
    }
    confirmOverlayEl.innerHTML = `
      <div class="modal">
        <h3></h3>
        <p style="font-size:var(--text-base);color:var(--text-secondary);line-height:1.5;margin-top:0.25rem;"></p>
        ${statsHtml || ""}
        ${requireText ? `<input type="text" id="confirmTextInput" class="confirm-text-input" autocomplete="off" spellcheck="false">` : ""}
        <div class="modal-actions">
          <button class="btn-cancel" id="confirmCancelBtn">Cancel</button>
          <button class="${danger ? "btn-delete-modal" : "btn-save"}" id="confirmOkBtn"></button>
        </div>
      </div>
    `;
    confirmOverlayEl.querySelector("h3").textContent = title;
    confirmOverlayEl.querySelector("p").textContent = message;
    const okBtn = confirmOverlayEl.querySelector("#confirmOkBtn");
    okBtn.textContent = confirmLabel || "Confirm";
    confirmOverlayEl.querySelector("#confirmCancelBtn").addEventListener("click", () => {
      closeModal(confirmOverlayEl);
    });
    if (requireText) {
      const textInput = confirmOverlayEl.querySelector("#confirmTextInput");
      textInput.placeholder = requireText.placeholder || "";
      okBtn.disabled = true;
      textInput.addEventListener("input", () => {
        okBtn.disabled = !requireText.isValid(textInput.value);
      });
      textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !okBtn.disabled) okBtn.click();
      });
      setTimeout(() => textInput.focus(), 50);
    }
    okBtn.addEventListener("click", () => {
      if (requireText && okBtn.disabled) return;
      closeModal(confirmOverlayEl);
      onConfirm();
    });
    openModal(confirmOverlayEl);
  }

  // Reusable spring-physics animator (vanilla JS, no deps) for a single
  // numeric value. Unlike a fixed CSS cubic-bezier, the overshoot here comes
  // from real velocity, so it scales with how fast the value was already
  // moving instead of replaying the same curve every time.
  //
  // Pass options.key (any stable object, typically the element being
  // animated) to make repeat calls interruptible: a new call sharing a key
  // with a still-running spring picks up from that spring's live
  // position/velocity instead of restarting cold.
  //
  // Pass options.position and/or options.velocity to explicitly seed the
  // starting position/velocity instead of the normal from-argument-unless-a-
  // prior-spring-is-live behavior — for handing off into a *different*
  // position than where a same-key prior spring left off while still
  // carrying its momentum, e.g. a teleporting transition that shouldn't
  // visibly decelerate to zero right at the handoff point. Without
  // options.position, a same-key call still inherits the prior's actual
  // position as always (options.velocity alone doesn't change that).
  //
  // onUpdate(value) fires every frame; onComplete() fires once velocity and
  // displacement both settle under `precision`. Returns a controller with
  // stop() to cancel early.
  const springRegistry = new WeakMap();
  function spring(from, to, options, onUpdate, onComplete) {
    options = options || {};
    const stiffness = options.stiffness != null ? options.stiffness : 300;
    const damping = options.damping != null ? options.damping : 20;
    const mass = options.mass != null ? options.mass : 1;
    const precision = options.precision != null ? options.precision : 0.01;
    const key = options.key;

    const prior = key ? springRegistry.get(key) : null;
    if (prior) prior.stop();

    let position = options.position != null ? options.position : (prior ? prior.position : from);
    let velocity = options.velocity != null ? options.velocity : (prior ? prior.velocity : 0);
    let rafId = null;
    let lastTime = null;
    let stopped = false;

    const controller = {
      position,
      velocity,
      stop() {
        stopped = true;
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = null;
        if (key && springRegistry.get(key) === controller) springRegistry.delete(key);
      }
    };
    if (key) springRegistry.set(key, controller);

    function tick(now) {
      if (stopped) return;
      if (lastTime == null) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 1 / 30);
      lastTime = now;

      const displacement = position - to;
      const acceleration = (-stiffness * displacement - damping * velocity) / mass;
      velocity += acceleration * dt;
      position += velocity * dt;
      controller.position = position;
      controller.velocity = velocity;

      onUpdate(position);
      // onUpdate may have synchronously called this same controller's
      // stop() (e.g. a caller handing off to a different spring mid-flight)
      // — without this check, this function would ignore that and just
      // re-arm itself for another frame regardless, since cancelling an
      // already-fired rAF id has nothing left to cancel.
      if (stopped) return;

      if (Math.abs(velocity) < precision && Math.abs(position - to) < precision) {
        position = to;
        controller.position = position;
        onUpdate(position);
        if (key && springRegistry.get(key) === controller) springRegistry.delete(key);
        rafId = null;
        if (onComplete) onComplete();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return controller;
  }

  // CSS transitions can't interpolate a plain (unregistered) custom
  // property like --bg-page — without @property, a change to it is instant,
  // not eased, no matter what transition rule is sitting on the element
  // that reads it. Same category of problem as the FAB clone's rect/
  // border-radius interpolation elsewhere: animate it by hand in JS instead.
  function lerpHexColor(hexA, hexB, progress) {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * progress);
    const g = Math.round(ag + (bg - ag) * progress);
    const bl = Math.round(ab + (bb - ab) * progress);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  // Press-feedback squash for the FAB buttons (#openAdd/#openAddGoal),
  // spring-driven so release has the same physical overshoot-past-1 quality
  // as the checkbox's own completion pop, rather than the flat CSS
  // transition this predates. Uses spring()'s default stiffness/damping
  // (same as the checkbox pop, which doesn't override them either) for the
  // same feel. Touch+mouse events, not Pointer Events — same reliability
  // reason as the modal-drag-dismiss/date-nav-swipe gestures elsewhere in
  // this file: older Safari (this app's actual target device) doesn't
  // reliably fire pointer events at all. key: el keeps each FAB's spring
  // independent and lets a fresh press correctly continue from wherever a
  // still-settling release left off, instead of jumping back to 1 first.
  function enableFabPressSpring(el) {
    function pressDown() {
      spring(1, 0.94, { key: el }, (v) => { el.style.transform = `scale(${v})`; }, () => {});
    }
    function pressUp() {
      // Cleared to "" on settle (not left at the inline "scale(1)" the
      // checkbox pop leaves behind) so .fab:hover's own CSS scale can take
      // back over between presses instead of being permanently shadowed by
      // a leftover inline transform.
      spring(0.94, 1, { key: el }, (v) => { el.style.transform = `scale(${v})`; }, () => { el.style.transform = ""; });
    }
    el.addEventListener("touchstart", pressDown, { passive: true });
    el.addEventListener("touchend", pressUp);
    el.addEventListener("touchcancel", pressUp);
    el.addEventListener("mousedown", pressDown);
    el.addEventListener("mouseup", pressUp);
    el.addEventListener("mouseleave", pressUp);
  }

  // Spring-driven reveal for onboarding's .onboarding-reveal elements
  // (opacity 0->1, translateY 8px->0), replacing the flat CSS
  // "transition: opacity 250ms ease, transform 250ms ease" those used to
  // rely on — same category of motion upgrade as the view-transition/Deep
  // Work entrance work. .ob-in is still toggled (not removed) since the
  // CSS rule also drives pointer-events: auto/none, which this doesn't
  // duplicate; only opacity/transform are taken over here, so
  // transitionProperty is neutralized to stop CSS fighting the spring's
  // every-frame writes. Two dedicated keys per element (opacity and
  // translateY animate different value spaces — sharing one key between
  // them would corrupt each other's inherited position) that persist for
  // that element's lifetime, so a reveal interrupted by a hide (or vice
  // versa, see obRevealOut) correctly continues from its live position
  // instead of jumping.
  const obRevealSpringKeys = new WeakMap();
  function getObRevealSpringKeys(el) {
    let keys = obRevealSpringKeys.get(el);
    if (!keys) { keys = { fade: {}, slide: {} }; obRevealSpringKeys.set(el, keys); }
    return keys;
  }
  function obRevealIn(el) {
    const keys = getObRevealSpringKeys(el);
    el.classList.add("ob-in");
    el.style.transitionProperty = "none";
    let settledCount = 0;
    function onSettled() {
      settledCount++;
      if (settledCount === 2) el.style.transitionProperty = "";
    }
    spring(0, 1, { key: keys.fade }, (v) => { el.style.opacity = v; }, onSettled);
    spring(8, 0, { key: keys.slide }, (v) => { el.style.transform = `translateY(${v}px)`; }, onSettled);
  }
  function obRevealOut(el) {
    const keys = getObRevealSpringKeys(el);
    el.style.transitionProperty = "none";
    let settledCount = 0;
    function onSettled() {
      settledCount++;
      if (settledCount === 2) {
        el.classList.remove("ob-in");
        el.style.transitionProperty = "";
      }
    }
    spring(1, 0, { key: keys.fade }, (v) => { el.style.opacity = v; }, onSettled);
    spring(0, 8, { key: keys.slide }, (v) => { el.style.transform = `translateY(${v}px)`; }, onSettled);
  }

  // Spring-driven pop-in for the seal/session-complete/milestone takeover
  // screens' central content (.seal-icon/.session-complete-icon/
  // .milestone-card) — same category of upgrade as obRevealIn above,
  // replacing each element's flat "opacity 400ms ease-out, transform 400ms
  // cubic-bezier(...)" CSS transition. That cubic-bezier already overshot
  // past 1 on the way in, so spring()'s own default (underdamped) feel is
  // the direct physical equivalent, not a departure from it. These
  // elements are static (not recreated per-show like onboarding's), so the
  // starting opacity/scale must be reset explicitly on every call — without
  // it, a second reveal would find the spring already resting at 1 and not
  // animate at all. Two dedicated keys per element, same reasoning as
  // obRevealIn's fade/slide split.
  const scaleRevealSpringKeys = new WeakMap();
  function getScaleRevealSpringKeys(el) {
    let keys = scaleRevealSpringKeys.get(el);
    if (!keys) { keys = { fade: {}, scale: {} }; scaleRevealSpringKeys.set(el, keys); }
    return keys;
  }
  function springScaleReveal(el, fromScale) {
    const keys = getScaleRevealSpringKeys(el);
    el.style.transitionProperty = "none";
    el.style.opacity = "0";
    el.style.transform = `scale(${fromScale})`;
    let settledCount = 0;
    function onSettled() {
      settledCount++;
      if (settledCount === 2) el.style.transitionProperty = "";
    }
    spring(0, 1, { key: keys.fade }, (v) => { el.style.opacity = v; }, onSettled);
    spring(fromScale, 1, { key: keys.scale }, (v) => { el.style.transform = `scale(${v})`; }, onSettled);
  }

  // Spring-driven entrance for the .fab-guide-arrow/.catadd-guide-arrow
  // nudge arrows, layered in front of their existing infinite CSS
  // @keyframes loop (guideArrowDiag/guideArrowRight) rather than replacing
  // it — a continuous ambient pulse is exactly what @keyframes is for, not
  // something a settle-to-target spring should try to do. CSS animations
  // out-rank inline styles in the cascade, so simply pausing the loop
  // wouldn't let the spring's own opacity/transform writes show through —
  // el.style.animation is set to "none" to fully detach it for the
  // entrance's duration (same "take CSS out of the way" pattern as
  // transitionProperty elsewhere), then cleared once settled so the loop
  // reattaches and plays from its own 0% keyframe.
  const guideArrowSpringKeys = new WeakMap();
  function getGuideArrowSpringKeys(el) {
    let keys = guideArrowSpringKeys.get(el);
    if (!keys) { keys = { fade: {}, scale: {} }; guideArrowSpringKeys.set(el, keys); }
    return keys;
  }
  function springArrowIn(el) {
    // Doesn't touch display — #fabGuideArrow's caller sets "flex" itself
    // (its existing toggle), while .catadd-guide-arrow is a freshly
    // created element whose CSS class already provides the right default
    // (display: inline-flex, for correct inline flow next to the category
    // pills) — forcing "flex" here would override that and break its
    // layout.
    const keys = getGuideArrowSpringKeys(el);
    el.style.animation = "none";
    el.style.opacity = "0";
    el.style.transform = "scale(0.7)";
    let settledCount = 0;
    function onSettled() {
      settledCount++;
      if (settledCount === 2) {
        el.style.animation = "";
        el.style.opacity = "";
        el.style.transform = "";
      }
    }
    spring(0, 1, { key: keys.fade }, (v) => { el.style.opacity = v; }, onSettled);
    spring(0.7, 1, { key: keys.scale }, (v) => { el.style.transform = `scale(${v})`; }, onSettled);
  }
  function fadeArrowOut(el) {
    const keys = getGuideArrowSpringKeys(el);
    const currentOpacity = parseFloat(getComputedStyle(el).opacity) || 1;
    el.style.animation = "none";
    el.style.opacity = String(currentOpacity);
    spring(currentOpacity, 0, { key: keys.fade, stiffness: 400, damping: 40 }, (v) => {
      el.style.opacity = v;
    }, () => {
      el.style.display = "none";
      el.style.animation = "";
      el.style.opacity = "";
      el.style.transform = "";
    });
  }

  function openModal(el) {
    el.classList.add("open");
    const modal = el.querySelector(".modal");
    if (!modal) return;
    // Spring drives the open scale directly, so keep CSS out of the way for
    // transform (opacity still transitions via CSS as before); restored on
    // completion so the existing CSS transition handles the close animation.
    modal.style.transitionProperty = "opacity";
    modal.style.transform = "scale(0.96)";
    spring(0.96, 1, { key: modal }, (v) => {
      modal.style.transform = `scale(${v})`;
    }, () => {
      modal.style.transitionProperty = "";
    });
  }
  function closeModal(el) { el.classList.remove("open"); }
  function closeModalInstant(el) {
    el.style.transition = "none";
    el.classList.remove("open");
    void el.offsetWidth;
    el.style.transition = "";
  }

  function animateCountUp(element, targetValue, duration, suffix) {
    suffix = suffix || "";
    duration = duration || 550;
    const startTime = performance.now();
    function frame(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      element.textContent = Math.round(targetValue * progress) + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
  function save() {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      window.firestoreBridge.syncTasks(tasks);
      window.firestoreBridge.syncCategories(categories);
      return;
    }
    localStorage.setItem("tasks", JSON.stringify(tasks));
    localStorage.setItem("categories", JSON.stringify(categories));
  }
  // Signed-in users' identity now lives only on users/{uid} (written by
  // onboarding's Firestore flush, never localStorage) — fall back to
  // localStorage's "userIdentity" for signed-out/legacy users who still
  // have it there from before this refactor.
  function getUserIdentity() {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      const account = window.firestoreBridge.getAccountInfo();
      return (account && account.identity) || "";
    }
    return localStorage.getItem("userIdentity") || "";
  }
  function categoryColor(name) {
    const cat = categories.find(c => c.name === name);
    return (cat && cat.color) ? cat.color : "var(--border)";
  }
  function formatDuration(mins) {
    const m = parseInt(mins);
    if (!m) return "";
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? h + "h " + rem + "m" : h + "h";
  }

  // Chronological (oldest-first) list of dates making up the task's
  // CURRENT unbroken streak — completed or frozen days only, stopping at
  // the first real gap. computeStreak() and the milestone-card feature
  // both need this same walk (length for one, the actual dates for the
  // other), so it lives in one place rather than two similar loops
  // drifting apart.
  function getCurrentStreakDates(task) {
    const today = toDateStr(new Date());
    const start = new Date(task.date + "T00:00:00");
    const end = new Date((task.endDate || today) + "T00:00:00");
    let scheduledDays = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (occursOn(task, d)) scheduledDays.push(toDateStr(d));
    }
    let pastScheduled = scheduledDays.filter(ds => ds <= today).slice().reverse();

    // If today is scheduled but not yet completed, don't let that break the streak —
    // just skip it and start counting from yesterday instead.
    if (pastScheduled.length && pastScheduled[0] === today && !(task.completedDates || []).includes(today)) {
      pastScheduled = pastScheduled.slice(1);
    }

    const streakDates = [];
    for (const ds of pastScheduled) {
      if ((task.completedDates || []).includes(ds) || (task.frozenDates || []).includes(ds)) streakDates.push(ds);
      else break;
    }
    return streakDates.reverse(); // oldest first
  }

  function computeStreak(task) {
    return getCurrentStreakDates(task).length;
  }

  // Streak freeze economy (Snapchat-style): every 7 consecutive streak days
  // (completed or already-frozen) banks 1 freeze, capped at a stockpile of
  // 2. A past scheduled day that's missed consumes a banked freeze instead
  // of breaking the streak, if one's available. This is a pure re-simulation
  // from task.date forward through completedDates/frozenDates every time
  // it's called — deliberately not a separately-stored, freely-settable
  // "freeze count" field, so there's nothing for a client to just edit to a
  // higher number; the only persisted side effect is appending newly-frozen
  // dates to frozenDates, exactly like any other task field edit already
  // goes through the same read/write security rule.
  // Returns { changed, freezesAvailable } — changed is true when new dates
  // were appended to task.frozenDates (caller should persist via save()).
  function applyStreakFreezes(task) {
    if (!task.recurrence || task.recurrence.type === "none") return { changed: false, freezesAvailable: 0 };

    const today = toDateStr(new Date());
    const start = new Date(task.date + "T00:00:00");
    const end = new Date((task.endDate || today) + "T00:00:00");
    let scheduledDays = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (occursOn(task, d)) scheduledDays.push(toDateStr(d));
    }
    // Only days that have actually passed can be auto-frozen — "today" isn't
    // a missed day until it's over.
    const pastScheduled = scheduledDays.filter(ds => ds < today);

    const completedDates = task.completedDates || [];
    const existingFrozen = new Set(task.frozenDates || []);
    const newlyFrozen = [];

    let freezesBanked = 0;
    let consecutive = 0;

    pastScheduled.forEach(ds => {
      const isCompleted = completedDates.includes(ds);
      const isFrozen = existingFrozen.has(ds);

      if (isCompleted || isFrozen) {
        consecutive++;
      } else if (freezesBanked > 0) {
        newlyFrozen.push(ds);
        freezesBanked--;
        consecutive++;
      } else {
        consecutive = 0;
      }

      if (consecutive > 0 && consecutive % 7 === 0) {
        freezesBanked = Math.min(2, freezesBanked + 1);
      }
    });

    if (newlyFrozen.length === 0) return { changed: false, freezesAvailable: freezesBanked };
    task.frozenDates = [...(task.frozenDates || []), ...newlyFrozen];
    return { changed: true, freezesAvailable: freezesBanked };
  }

  // Shareable milestone cards (roadmap #6). MILESTONE_THRESHOLDS gates
  // are recorded per-task in task.milestonesEarned = { "7": record, ... }
  // (see docs/firestore-schema.md) so each threshold only ever fires once
  // per streak, and "View milestone" later can re-render the exact
  // snapshot from when it was actually earned — not the task's current,
  // possibly-longer streak.
  const MILESTONE_THRESHOLDS = [7, 30, 100];

  // Mutates task.milestonesEarned in place and returns the newly-earned
  // record if the task's current streak just crossed a threshold it
  // hadn't already earned, else null. Only ever reports (and records) one
  // threshold per call — if a streak already spans multiple unearned
  // thresholds at once (e.g. this feature shipped after someone already
  // had a 40-day streak), the rest get caught on the next check rather
  // than firing several full-screen takeovers back to back.
  function checkStreakMilestones(task) {
    if (!task.recurrence || task.recurrence.type === "none") return null;
    const streakDates = getCurrentStreakDates(task);
    const streak = streakDates.length;
    const earned = task.milestonesEarned || {};
    for (const threshold of MILESTONE_THRESHOLDS) {
      if (streak >= threshold && !earned[threshold]) {
        const windowDates = streakDates.slice(streakDates.length - threshold);
        const completedDates = task.completedDates || [];
        const protectedDays = windowDates.filter(ds => !completedDates.includes(ds)).length;
        const record = {
          threshold,
          startDate: windowDates[0],
          earnedDate: windowDates[windowDates.length - 1],
          protectedDays
        };
        task.milestonesEarned = { ...earned, [threshold]: record };
        return record;
      }
    }
    return null;
  }

  // Runs applyStreakFreezes + checkStreakMilestones across every recurring
  // task (goals and plain repeating tasks alike — frozenDates is a general
  // task field per docs/firestore-schema.md, not goal-only) and persists
  // once if anything changed, rather than one save() per task. Shows the
  // full-screen milestone card for the first newly-earned milestone found,
  // as long as nothing else is already on screen — the natural "checked
  // whenever streak state is calculated/displayed" hook this already is
  // for freezes doubles as the milestone trigger point.
  function syncAllStreakFreezes() {
    let anyChanged = false;
    let newMilestone = null;
    tasks.forEach(t => {
      if (applyStreakFreezes(t).changed) anyChanged = true;
      const record = checkStreakMilestones(t);
      if (record) {
        anyChanged = true;
        if (!newMilestone) newMilestone = { task: t, record };
      }
    });
    if (anyChanged) save();
    if (newMilestone && !document.querySelector(".modal-overlay.open") &&
        !document.getElementById("milestoneScreen").classList.contains("visible")) {
      showMilestoneScreen(newMilestone.task, newMilestone.record);
    }
    return anyChanged;
  }

  // --- Shareable milestone card: card data, DOM preview, canvas export ---

  // Dot size/gap (CSS px at the card's 320px reference width — see
  // .milestone-card in styles.css) scaled down as the day count grows, so
  // a 100-dot grid still fits the card cleanly instead of overflowing or
  // shrinking the rest of the layout.
  function milestoneDotMetrics(threshold) {
    if (threshold <= 7) return { size: 18, gap: 8 };
    if (threshold <= 30) return { size: 11, gap: 5 };
    return { size: 6, gap: 3 };
  }

  function formatMilestoneDate(dateStr) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // Rebuilds the exact scheduled-occurrence dates between the milestone's
  // stored startDate/earnedDate (not the task's current, possibly-longer
  // streak) so "View milestone" always reproduces the snapshot as it was
  // actually earned. Uses occursOn() rather than every calendar day in the
  // range, since a weekly-recurring task's streak dates skip non-scheduled
  // days.
  function buildMilestoneCardData(task, record) {
    const start = new Date(record.startDate + "T00:00:00");
    const end = new Date(record.earnedDate + "T00:00:00");
    const completedDates = task.completedDates || [];
    const dots = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (!occursOn(task, d)) continue;
      const ds = toDateStr(d);
      dots.push({ date: ds, protected: !completedDates.includes(ds) });
    }
    return {
      taskName: task.checkoffLabel || task.name,
      threshold: record.threshold,
      startDate: record.startDate,
      earnedDate: record.earnedDate,
      protectedDays: record.protectedDays,
      dots
    };
  }

  function renderMilestoneDotsDOM(container, data) {
    container.innerHTML = "";
    const metrics = milestoneDotMetrics(data.threshold);
    container.style.gap = metrics.gap + "px";
    data.dots.forEach(dot => {
      const el = document.createElement("div");
      el.className = "milestone-dot " + (dot.protected ? "protected" : "completed");
      el.style.width = metrics.size + "px";
      el.style.height = metrics.size + "px";
      // Same 5px-at-18px ratio as .goal-dot, scaled with dot size — a flat
      // 5px radius would read as a plain circle once dots shrink to 6-11px.
      el.style.borderRadius = (metrics.size * (5 / 18)) + "px";
      container.appendChild(el);
    });
  }

  let currentMilestoneCardData = null;

  function showMilestoneScreen(task, record) {
    const data = buildMilestoneCardData(task, record);
    currentMilestoneCardData = data;
    renderMilestoneDotsDOM(document.getElementById("milestoneDots"), data);
    document.getElementById("milestoneStat").textContent = `${data.threshold}-day streak`;
    document.getElementById("milestoneDateRange").textContent =
      `${formatMilestoneDate(data.startDate)} to ${formatMilestoneDate(data.earnedDate)}`;
    const protectedEl = document.getElementById("milestoneProtected");
    if (data.protectedDays > 0) {
      protectedEl.textContent = `${data.protectedDays} of ${data.threshold} days protected`;
      protectedEl.style.display = "block";
    } else {
      // Never show "0 of N days protected" — the honesty line only earns
      // its place when there's something to actually disclose.
      protectedEl.textContent = "";
      protectedEl.style.display = "none";
    }
    lucide.createIcons();
    document.getElementById("milestoneScreen").classList.add("visible");
    springScaleReveal(document.getElementById("milestoneCard"), 0.92);
  }

  document.getElementById("milestoneCloseBtn").addEventListener("click", () => {
    document.getElementById("milestoneScreen").classList.remove("visible");
  });
  document.getElementById("milestoneScreen").addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.getElementById("milestoneScreen").classList.remove("visible");
  });

  // --- Canvas export (actual downloadable/shareable image, not a DOM
  // screenshot) — redraws the same design at export resolution using the
  // fixed brand color/dimensions, independent of the on-screen preview's
  // CSS so it renders identically regardless of viewport size or theme. ---

  const MILESTONE_CANVAS_WIDTH = 1080;
  const MILESTONE_CANVAS_HEIGHT = 1350; // 4:5
  const MILESTONE_CARD_REF_WIDTH = 320; // matches .milestone-card's CSS reference width
  const MILESTONE_SCALE = MILESTONE_CANVAS_WIDTH / MILESTONE_CARD_REF_WIDTH;

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Canvas has no native letter-spacing support reliable across browsers,
  // so each character is measured and placed by hand for the wordmark's
  // 0.16em tracking.
  function drawLetterSpacedText(ctx, text, x, y, spacing) {
    let cursorX = x;
    [...text].forEach(ch => {
      ctx.fillText(ch, cursorX, y);
      cursorX += ctx.measureText(ch).width + spacing;
    });
  }

  function renderMilestoneCardCanvas(data) {
    const canvas = document.createElement("canvas");
    canvas.width = MILESTONE_CANVAS_WIDTH;
    canvas.height = MILESTONE_CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    const S = MILESTONE_SCALE;

    ctx.fillStyle = "#2F5233";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const padX = 22.4 * S;
    const padTop = 25.6 * S;

    // Wordmark, top-left, quiet.
    ctx.fillStyle = "rgba(250,250,247,0.7)";
    ctx.font = `600 ${11.2 * S}px "Hanken Grotesk", sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    drawLetterSpacedText(ctx, "FLIT", padX, padTop, 1.79 * S);

    // Dot grid, centered in a fixed middle band so it's unaffected by the
    // exact height of the wordmark/stat/footer text around it.
    const metrics = milestoneDotMetrics(data.threshold);
    const dotSize = metrics.size * S;
    const dotGap = metrics.gap * S;
    const dotsAreaTop = canvas.height * 0.22;
    const dotsAreaBottom = canvas.height * 0.66;
    const dotsAreaWidth = canvas.width - padX * 2;
    const perRow = Math.max(1, Math.floor((dotsAreaWidth + dotGap) / (dotSize + dotGap)));
    const rowCount = Math.ceil(data.dots.length / perRow);
    const gridHeight = rowCount * dotSize + (rowCount - 1) * dotGap;
    const gridTop = dotsAreaTop + Math.max(0, ((dotsAreaBottom - dotsAreaTop) - gridHeight) / 2);

    data.dots.forEach((dot, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const dotsInRow = Math.min(perRow, data.dots.length - row * perRow);
      const rowWidth = dotsInRow * dotSize + (dotsInRow - 1) * dotGap;
      const rowLeft = padX + (dotsAreaWidth - rowWidth) / 2;
      const x = rowLeft + col * (dotSize + dotGap);
      const y = gridTop + row * (dotSize + dotGap);
      // Same 5px-at-18px ratio as .goal-dot (5px radius on a 15px box,
      // ~0.33) scaled down for the 30/100-day dot sizes — a flat 5px
      // radius stops reading as a rounded square and looks like a plain
      // circle once dots shrink to 6-11px.
      drawRoundedRectPath(ctx, x, y, dotSize, dotSize, dotSize * (5 / 18));
      if (dot.protected) {
        ctx.strokeStyle = "#FAFAF7";
        ctx.lineWidth = 1.5 * S;
        ctx.setLineDash([dotSize * 0.35, dotSize * 0.25]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = "#FAFAF7";
        ctx.fill();
      }
    });

    // Stat line — moderate weight, not display-scale type.
    ctx.fillStyle = "#FAFAF7";
    ctx.font = `600 ${20 * S}px "Hanken Grotesk", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${data.threshold}-day streak`, canvas.width / 2, canvas.height * 0.72);

    // Footer — date range, plus the honesty line only when it has
    // something real to disclose.
    ctx.font = `400 ${11.52 * S}px "Hanken Grotesk", sans-serif`;
    ctx.fillStyle = "rgba(250,250,247,0.85)";
    const lineHeight = 11.52 * S * 1.6;
    const footerLines = [`${formatMilestoneDate(data.startDate)} to ${formatMilestoneDate(data.earnedDate)}`];
    if (data.protectedDays > 0) footerLines.push(`${data.protectedDays} of ${data.threshold} days protected`);
    const footerBottom = canvas.height - padTop;
    const footerTop = footerBottom - (footerLines.length - 1) * lineHeight;
    footerLines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, footerTop + i * lineHeight);
    });

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  }

  async function exportMilestoneCanvas() {
    if (!currentMilestoneCardData) return null;
    // Canvas text silently falls back to a default font if the requested
    // one isn't loaded yet when drawing happens. document.fonts.ready
    // alone isn't enough here — it only resolves for fonts some element on
    // the page has already triggered a load for, and nothing else on
    // screen necessarily uses these exact weights yet. Explicitly request
    // the exact font strings the canvas draws with (weight matters — a
    // browser can have 400 loaded but not 600) and wait for those.
    try {
      await Promise.all([
        document.fonts.load(`600 40px "Hanken Grotesk"`),
        document.fonts.load(`400 40px "Hanken Grotesk"`)
      ]);
    } catch (err) { /* best-effort — falls back to a system sans if this fails */ }
    return renderMilestoneCardCanvas(currentMilestoneCardData);
  }

  document.getElementById("milestoneSaveBtn").addEventListener("click", async () => {
    const btn = document.getElementById("milestoneSaveBtn");
    btn.disabled = true;
    try {
      const canvas = await exportMilestoneCanvas();
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flit-${currentMilestoneCardData.threshold}-day-streak.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showToast("Couldn't save the image. Try again.", "warning");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("milestoneShareBtn").addEventListener("click", async () => {
    const btn = document.getElementById("milestoneShareBtn");
    btn.disabled = true;
    try {
      const canvas = await exportMilestoneCanvas();
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], `flit-${currentMilestoneCardData.threshold}-day-streak.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${currentMilestoneCardData.threshold}-day streak` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Sharing isn't available here. Saved the image instead.", "info");
      }
    } catch (err) {
      // A user cancelling the native share sheet throws AbortError — not
      // a real failure, nothing to tell them.
      if (err && err.name !== "AbortError") {
        showToast("Couldn't share the image. Try again.", "warning");
      }
    } finally {
      btn.disabled = false;
    }
  });

  function occursOn(t, dateObj) {
    const dateStr = toDateStr(dateObj);
    if (!t.recurrence || t.recurrence.type === "none") {
      return t.date === dateStr;
    }
    if (dateStr < t.date) return false;
    if (t.endDate && dateStr > t.endDate) return false;
    if (t.recurrence.type === "daily") return true;
    if (t.recurrence.type === "weekly") {
      const dayIndex = dateObj.getDay();
      if (!t.recurrence.days.includes(dayIndex)) return false;
      const startDate = new Date(t.date + "T00:00:00");
      const msPerDay = 86400000;
      const daysDiff = Math.floor((dateObj - startDate) / msPerDay);
      const weeksDiff = Math.floor(daysDiff / 7);
      const interval = t.recurrence.interval || 1;
      return weeksDiff % interval === 0;
    }
    return false;
  }

  function getTasksForDate(dateObj, categoryFilter) {
    const dateStr = toDateStr(dateObj);
    let list = tasks.filter(t => occursOn(t, dateObj));
    if (categoryFilter && categoryFilter !== "All") {
      list = list.filter(t => t.category === categoryFilter);
    }
    return list.map(t => {
      const isRecurring = t.recurrence && t.recurrence.type !== "none";
      const done = isRecurring ? (t.completedDates || []).includes(dateStr) : t.done;
      const frozen = isRecurring && !done && (t.frozenDates || []).includes(dateStr);
      return { ...t, occurrenceDate: dateStr, occurrenceDone: done, occurrenceFrozen: frozen, isRecurring };
    }).sort((a, b) => {
      if (a.occurrenceDone !== b.occurrenceDone) return a.occurrenceDone ? 1 : -1;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }

  // Takes a getTasksForDate() occurrence (the shape renderTasks() iterates
  // over), not a raw tasks[] record — a recurring task's own t.date is its
  // series start (often long in the past) and it has no t.done at all, so
  // checking those directly would misfire. occurrenceDate/occurrenceDone are
  // already resolved per-day for both recurring and one-off tasks above,
  // which is the correct pair to compare against "today". String comparison
  // is safe since toDateStr() always produces zero-padded YYYY-MM-DD.
  // Visibility-in-the-Planner (the 3rd overdue condition) isn't checked
  // here — it's guaranteed by only ever calling this from renderTasks()'s
  // per-rendered-item loop, never against the full unfiltered tasks[] list.
  function isTaskOverdue(task) {
    return !task.occurrenceDone && task.occurrenceDate < toDateStr(new Date());
  }

  // --- View switching ---
  const CROSSFADE_VIEW_IDS = { planner: "plannerView", goals: "goalsView", analysis: "analysisView", reflection: "reflectionView" };
  const VIEW_FADE_SPRING_KEY = {};
  const VIEW_SLIDE_SPRING_KEY = {};
  // #focusView isn't part of the prevEl/nextEl crossfade swap below (it's a
  // separate fixed-position overlay, not one of the four swapped-in-place
  // views) and its own entrance/exit can run concurrently with whichever of
  // the four is animating underneath it — sharing VIEW_FADE_SPRING_KEY/
  // VIEW_SLIDE_SPRING_KEY would let one call's spring silently steal the
  // other's key mid-flight (this codebase's recurring key-collision bug).
  // Dedicated keys avoid that.
  const FOCUS_FADE_SPRING_KEY = {};
  const FOCUS_SLIDE_SPRING_KEY = {};
  // Deep Work is a full theme change (light view -> dark, timer-focused
  // mode), not a same-weight peer switch like Planner<->Goals. The normal
  // snappy 600/34 read as too fast/abrupt; the "ceremonial" 300/20 already
  // used for the End Day reflection reveal was tried next but still read as
  // too fast for a full-screen theme change specifically — lower stiffness
  // still, for a slower, more deliberate settle.
  const FOCUS_SPRING_STIFFNESS = 120;
  const FOCUS_SPRING_DAMPING = 18;
  // Mirrors enableDateNavSwipe()'s own `transitioning` guard: blocks a new
  // switchView() call from starting while #focusView's own entrance/exit is
  // still mid-flight, so rapid tab-tapping in/out of Deep Work can't stack
  // a second transition on top of one still resolving.
  let focusTransitioning = false;
  // --bg-page is a plain (unregistered) custom property — without
  // @property, CSS can't actually interpolate it, so the "transition:
  // background 0.5s ease" sitting on body/#focusView never did anything for
  // this specific value; the light->dark (or reverse) snap was instant.
  // Hardcoded here rather than read from the custom property so the lerp
  // has real hex to interpolate between regardless of that limitation.
  const FOCUS_BG_LIGHT = "#FAFAF7";
  const FOCUS_BG_DARK = "#1A211C";
  // Same unregistered-custom-property limitation as --bg-page, confirmed
  // directly this time (sampled body's computed color repeatedly across a
  // real-time window after data-theme flipped — it never moved off the
  // light value at all, not even part way, which is what a genuinely inert
  // "transition" on a var()-sourced value looks like). --text-primary was
  // left on its CSS transition when the background fix went in, deferred
  // as a smaller-magnitude follow-up; this is that follow-up.
  const FOCUS_TEXT_LIGHT = "#232520";
  const FOCUS_TEXT_DARK = "#F2F1ED";

  function switchView(view) {
    if (pendingLockDate && view !== "reflection") {
      showToast("Finish your reflection to end the day.", "warning");
      return;
    }
    if (focusTransitioning) return;
    const previousView = currentView;
    currentView = view;

    document.getElementById("tabPlanner").classList.toggle("active", view === "planner");
    document.getElementById("tabGoals").classList.toggle("active", view === "goals");
    document.getElementById("tabAnalysis").classList.toggle("active", view === "analysis");
    document.getElementById("tabFocus").classList.toggle("active", view === "focus");

    const enteringFocus = view === "focus" && previousView !== "focus";
    const leavingFocus = previousView === "focus" && view !== "focus";
    // Entering shows immediately, matching the old CSS's 0-delay "enter"
    // case — leaving defers hiding until hideFocusView()'s exit spring
    // actually settles (see below), so the fade-out stays visible for its
    // full run instead of being cut off.
    if (enteringFocus) {
      const focusEl = document.getElementById("focusView");
      focusEl.classList.add("visible");
      // .visible's own CSS (opacity: 1) takes effect the instant the class
      // lands — but showFocusView()'s spring doesn't actually start until
      // 150ms later (after the old tab's own fade-out below), so without
      // pinning it back to its pre-entrance state right here, in the same
      // synchronous tick, #focusView flashed fully opaque and already dark
      // (data-theme flips below, in this same tick too) for that whole
      // 150ms gap, before snapping back down to 0 and re-fading in. Prime
      // it now; showFocusView() just starts the springs from here later.
      focusEl.style.transition = "opacity 0s linear, background 0s linear, color 0s linear";
      // Clears any inline visibility: hidden / pointer-events: none left by
      // a prior exit (see hideFocusView()) — .visible's own CSS already
      // sets visibility: visible with 0 delay and the base rule has no
      // pointer-events restriction, but both are shadowed by a leftover
      // inline value, which always wins over a class/base rule.
      focusEl.style.visibility = "";
      focusEl.style.pointerEvents = "";
      focusEl.style.opacity = "0";
      focusEl.style.transform = "translateY(8px)";
      focusEl.style.backgroundColor = FOCUS_BG_LIGHT;
      focusEl.style.color = FOCUS_TEXT_LIGHT;
      document.body.style.transition = "background 0s linear, color 0s linear";
      document.body.style.backgroundColor = FOCUS_BG_LIGHT;
      document.body.style.color = FOCUS_TEXT_LIGHT;
    }

    document.getElementById("openAdd").style.display = view === "planner" ? "block" : "none";
    document.getElementById("openAddGoal").style.display = view === "goals" ? "block" : "none";
    document.getElementById("micBtn").style.display = view === "planner" ? "block" : "none";
    document.getElementById("todayBtn").style.display = view === "planner" ? "block" : "none";
    updateFabArrow();
    document.body.classList.toggle("deep-work-mode", view === "focus");
    // data-theme itself is set further down, at the moment the outgoing
    // view is actually hidden (not here, synchronously) — see the
    // enteringFocus branch below. deep-work-mode stays synchronous/
    // immediate on purpose: it only affects the shared, persistent tab
    // bar's own styling, not the content that's fading out.
    if (!enteringFocus) {
      document.documentElement.setAttribute("data-theme", view === "focus" ? "dark" : "light");
    }

    const prevEl = CROSSFADE_VIEW_IDS[previousView] ? document.getElementById(CROSSFADE_VIEW_IDS[previousView]) : null;
    const nextEl = CROSSFADE_VIEW_IDS[view] ? document.getElementById(CROSSFADE_VIEW_IDS[view]) : null;

    // #focusView's entrance/exit, brought in line with the other four tabs'
    // spring-driven opacity+translateY motion (same stiffness/damping) —
    // it was intentionally left on a plain CSS fade when that work
    // happened, flagged as a follow-up. Background AND text color are both
    // driven by hand (see lerpHexColor()) piggybacked on this same fade
    // spring's onUpdate, rather than the CSS "background/color 0.5s ease"
    // that looked right but were actually no-ops — --bg-page/--text-primary
    // are unregistered custom properties, which CSS can't interpolate at
    // all, so those rules only ever produced an instant snap (confirmed
    // directly for color: sampled repeatedly across a real 640ms window and
    // it never moved off its starting value). Opacity/background/color are
    // all taken out of CSS's hands (duration forced to 0 so CSS doesn't
    // fight the spring's every-frame writes).
    function showFocusView() {
      const el = document.getElementById("focusView");
      el.style.transition = "opacity 0s linear, background 0s linear, color 0s linear";
      document.body.style.transition = "background 0s linear, color 0s linear";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      let settledCount = 0;
      function onSettled() {
        settledCount++;
        if (settledCount === 2) {
          focusTransitioning = false;
          el.style.transition = "";
          el.style.backgroundColor = "";
          el.style.color = "";
          document.body.style.transition = "";
          document.body.style.backgroundColor = "";
          document.body.style.color = "";
        }
      }
      spring(0, 1, { stiffness: FOCUS_SPRING_STIFFNESS, damping: FOCUS_SPRING_DAMPING, key: FOCUS_FADE_SPRING_KEY }, (v) => {
        el.style.opacity = v;
        // v runs light(0)->dark(1) here, same direction as both lerps.
        const bg = lerpHexColor(FOCUS_BG_LIGHT, FOCUS_BG_DARK, v);
        const text = lerpHexColor(FOCUS_TEXT_LIGHT, FOCUS_TEXT_DARK, v);
        el.style.backgroundColor = bg;
        el.style.color = text;
        document.body.style.backgroundColor = bg;
        document.body.style.color = text;
      }, onSettled);
      spring(8, 0, { stiffness: FOCUS_SPRING_STIFFNESS, damping: FOCUS_SPRING_DAMPING, key: FOCUS_SLIDE_SPRING_KEY }, (v) => { el.style.transform = `translateY(${v}px)`; }, onSettled);
    }
    function hideFocusView() {
      const el = document.getElementById("focusView");
      el.style.transition = "opacity 0s linear, background 0s linear, color 0s linear";
      document.body.style.transition = "background 0s linear, color 0s linear";
      focusTransitioning = true;
      let settledCount = 0;
      function onSettled() {
        settledCount++;
        if (settledCount === 2) {
          focusTransitioning = false;
          el.classList.remove("visible");
          // el.style.transition is cleared in this same synchronous tick as
          // the class removal above, so the browser's single resulting
          // style recalc sees the RESTORED base-rule transition (which
          // delays visibility:hidden by 0.5s) rather than the inline
          // override that was active a moment ago — the class-removal
          // doesn't get to use the override at all, since both changes
          // land in the same recalc. #focusView has no pointer-events rule,
          // so for that real 0.5s it stays fully hit-testable — invisible,
          // but still intercepting every click across the whole viewport
          // (position:fixed, inset:0, z-index:5) — which is exactly what
          // made Settings (or anything else) look stuck/unclickable right
          // after leaving Deep Work. Set visibility directly so it's
          // immediate, not dependent on CSS transition timing at all. Also
          // set pointer-events: none as a second, independent guarantee —
          // unlike visibility, it has no transition/delay semantics to get
          // caught by the same-tick issue above in the first place, so it
          // can't be subject to whatever timing quirk affects the other
          // property, whether that's this exact mechanism or something else
          // still misfiring the same way.
          el.style.visibility = "hidden";
          el.style.pointerEvents = "none";
          el.style.transition = "";
          el.style.backgroundColor = "";
          el.style.color = "";
          document.body.style.transition = "";
          document.body.style.backgroundColor = "";
          document.body.style.color = "";
        }
      }
      spring(1, 0, { stiffness: FOCUS_SPRING_STIFFNESS, damping: FOCUS_SPRING_DAMPING, key: FOCUS_FADE_SPRING_KEY }, (v) => {
        el.style.opacity = v;
        // v runs dark(1)->light(0) here too, still the same "how much dark"
        // meaning as the entrance case above.
        const bg = lerpHexColor(FOCUS_BG_LIGHT, FOCUS_BG_DARK, v);
        const text = lerpHexColor(FOCUS_TEXT_LIGHT, FOCUS_TEXT_DARK, v);
        el.style.backgroundColor = bg;
        el.style.color = text;
        document.body.style.backgroundColor = bg;
        document.body.style.color = text;
      }, onSettled);
      spring(0, 8, { stiffness: FOCUS_SPRING_STIFFNESS, damping: FOCUS_SPRING_DAMPING, key: FOCUS_SLIDE_SPRING_KEY }, (v) => { el.style.transform = `translateY(${v}px)`; }, onSettled);
    }
    if (enteringFocus) {
      focusTransitioning = true;
      // Old tab fully fades out first, then Deep Work fades in — the two
      // used to overlap (prevEl stayed visible while focusView rose on top
      // of it, revealed rather than replaced), which read as the outgoing
      // tab's background/content briefly double-exposed with Deep Work's
      // own session options as they appeared. Reuses the existing 150ms
      // CSS opacity fade already on all four crossfade views (see
      // "#plannerView, #goalsView, ..." below) for the exit half, kept
      // short and undelayed on purpose so this reads as one quick clean
      // handoff, not a second slow step stacked in front of the
      // already-deliberately-slow (~960ms) entrance spring.
      if (prevEl) {
        prevEl.style.opacity = "0";
        setTimeout(() => {
          prevEl.style.display = "none";
          // Flips only now, right as the outgoing view actually disappears
          // — virtually every color in the app is a :root-scoped custom
          // property keyed to data-theme, so flipping this any earlier (it
          // used to be synchronous, at the very top of switchView()) made
          // prevEl instantly repaint in the new theme's colors while still
          // fully on screen for this entire 150ms window.
          document.documentElement.setAttribute("data-theme", "dark");
          showFocusView();
        }, 150);
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        showFocusView();
      }
    }
    if (leavingFocus) hideFocusView();

    function renderNewView() {
      if (view === "goals") renderGoals();
      if (view === "analysis") renderAnalysis();
      if (view === "reflection") renderReflection();
      if (view === "focus") renderFocus();
    }

    function showNextView() {
      if (nextEl) {
        // Spring drives opacity/translateY directly, so keep CSS out of the
        // way for this element's entrance; restored once both springs settle
        // so this same element's *exit* fade (prevEl.style.opacity above)
        // still goes through the normal CSS transition next time around.
        nextEl.style.transitionProperty = "none";
        nextEl.style.display = "block";
        nextEl.style.opacity = "0";
        nextEl.style.transform = "translateY(8px)";
        // A caller can ask for a slower, more ceremonial reveal (the "End
        // Day" flow does this for reflectionView) by setting this element's
        // transitionDuration before calling switchView — that used to drive
        // the old CSS transition directly; it now just picks a softer spring.
        const ceremonial = !!nextEl.style.transitionDuration;
        const stiffness = ceremonial ? 300 : 600;
        const damping = ceremonial ? 20 : 34;
        let settledCount = 0;
        function onSettled() {
          settledCount++;
          if (settledCount === 2) nextEl.style.transitionProperty = "";
        }
        spring(0, 1, { stiffness, damping, key: VIEW_FADE_SPRING_KEY }, (v) => { nextEl.style.opacity = v; }, onSettled);
        spring(8, 0, { stiffness, damping, key: VIEW_SLIDE_SPRING_KEY }, (v) => { nextEl.style.transform = `translateY(${v}px)`; }, onSettled);
      }
      renderNewView();
    }

    if (prevEl && nextEl && prevEl !== nextEl) {
      prevEl.style.opacity = "0";
      setTimeout(() => {
        prevEl.style.display = "none";
        showNextView();
      }, 120);
    } else {
      // Entering focus is the one case here with nextEl falsy but prevEl
      // real: skip the instant hide, since showFocusView() above already
      // owns hiding prevEl once its own entrance spring settles (so it
      // stays visible underneath the fade instead of vanishing first).
      if (prevEl && prevEl !== nextEl && !enteringFocus) {
        prevEl.style.opacity = "";
        prevEl.style.display = "none";
      }
      showNextView();
    }
  }

  document.getElementById("tabPlanner").addEventListener("click", () => switchView("planner"));
  document.getElementById("tabGoals").addEventListener("click", () => switchView("goals"));
  document.getElementById("tabAnalysis").addEventListener("click", () => switchView("analysis"));
  document.getElementById("tabFocus").addEventListener("click", () => switchView("focus"));

  // --- Goals ---
  function renderGoalsIdentityCard(goalTasks) {
    const card = document.getElementById("goalsIdentityCard");
    const identity = getUserIdentity();
    if (!identity) { card.innerHTML = ""; return; }
    let bestStreak = 0;
    let bestGoalName = "";
    goalTasks.forEach(g => {
      const streak = computeStreak(g);
      if (streak > bestStreak) { bestStreak = streak; bestGoalName = g.name; }
    });
    if (bestStreak < 3) { card.innerHTML = ""; return; }
    card.innerHTML = `
      <div style="background:var(--bg-card);border-radius:var(--radius-md);padding:1.1rem;margin-bottom:0.7rem;box-shadow:var(--shadow-card);">
        <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:0.4rem;">Becoming</div>
        <div style="font-size:var(--text-lg);font-weight:600;margin-bottom:0.35rem;">${identity}</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">${bestStreak}-day streak on ${bestGoalName}</div>
      </div>
    `;
  }

  function renderGoals() {
    syncAllStreakFreezes();
    updateFabArrow();
    const listEl = document.getElementById("goalsList");
    listEl.innerHTML = "";
    const goalTasks = tasks.filter(t => t.isGoal);
    renderGoalsIdentityCard(goalTasks);

    if (goalTasks.length === 0) {
      const msg = document.createElement("div");
      msg.className = "empty-msg";
      msg.innerHTML = `
        <i data-lucide="target" class="icon" style="width:28px;height:28px;color:var(--text-muted);display:block;margin:0 auto 0.5rem;"></i>
        <div class="big">No goals yet.</div>
        Goals track a small daily action, repeated, that adds up to something bigger over time.
        <span class="empty-msg-instruction">Add your first goal</span>
      `;
      listEl.appendChild(msg);
      lucide.createIcons();
      return;
    }

    const today = toDateStr(new Date());

    goalTasks.forEach(goal => {
      const startDate = new Date(goal.date + "T00:00:00");
      const endDate = new Date((goal.endDate || goal.date) + "T00:00:00");

      let scheduledDays = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        if (occursOn(goal, d)) scheduledDays.push(toDateStr(d));
      }

      const doneCount = scheduledDays.filter(ds => (goal.completedDates || []).includes(ds)).length;
      const pct = scheduledDays.length ? Math.round((doneCount / scheduledDays.length) * 100) : 0;
      const streak = computeStreak(goal);
      const freezesAvailable = applyStreakFreezes(goal).freezesAvailable;

      const card = document.createElement("li");
      card.className = "goal-card pressable";

      const top = document.createElement("div");
      top.className = "goal-card-top";
      const name = document.createElement("div");
      name.className = "goal-name";
      // Category color now lives here (a dot) instead of the card's old
      // border-left — no "at risk"/"behind pace" state exists to reserve
      // that border for, so it was purely decorative.
      name.innerHTML = `<span class="goal-category-dot" style="background:${categoryColor(goal.category)}"></span><i data-lucide="target" class="icon"></i> `;
      name.append(goal.name);
      const pctEl = document.createElement("div");
      pctEl.className = "goal-pct";
      pctEl.textContent = pct + "%";

      const menuBtn = document.createElement("button");
      menuBtn.innerHTML = '<i data-lucide="more-vertical" class="icon"></i>';
      menuBtn.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0 0.3rem;display:flex;align-items:center;";
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openGoalViewModal(goal.id);
      });

      top.appendChild(name);
      top.appendChild(pctEl);
      top.appendChild(menuBtn);

      const sub = document.createElement("div");
      sub.className = "goal-sub";
      sub.append(`${goal.category} · ${doneCount} / ${scheduledDays.length} days`);
      if (streak > 0) {
        sub.append(" · ");
        const flame = document.createElement("i");
        flame.setAttribute("data-lucide", "flame");
        flame.className = "icon";
        sub.appendChild(flame);
        sub.append(` ${streak} day${streak === 1 ? "" : "s"}`);
      }
      if (freezesAvailable > 0) {
        sub.append(" · ");
        const snow = document.createElement("i");
        snow.setAttribute("data-lucide", "snowflake");
        snow.className = "icon";
        sub.appendChild(snow);
        sub.append(` ${freezesAvailable} freeze${freezesAvailable === 1 ? "" : "s"} banked`);
      }
      const earnedMilestones = goal.milestonesEarned || {};
      const earnedThresholds = MILESTONE_THRESHOLDS.filter(t => earnedMilestones[t]);
      if (earnedThresholds.length > 0) {
        const highest = earnedThresholds[earnedThresholds.length - 1];
        sub.append(" · ");
        const viewLink = document.createElement("button");
        viewLink.type = "button";
        viewLink.className = "goal-milestone-link";
        viewLink.innerHTML = '<i data-lucide="image" class="icon"></i> View milestone';
        viewLink.addEventListener("click", (e) => {
          e.stopPropagation();
          showMilestoneScreen(goal, earnedMilestones[highest]);
        });
        sub.appendChild(viewLink);
      }

      const dots = document.createElement("div");
      dots.className = "goal-dots";
      let consecutiveDone = 0;
      scheduledDays.forEach((ds, idx) => {
        const dot = document.createElement("div");
        const isDone = (goal.completedDates || []).includes(ds);
        // A frozen day must never look like a completed one — see the
        // .goal-dot.frozen rule in styles.css for the distinct treatment.
        const isFrozen = !isDone && (goal.frozenDates || []).includes(ds);
        const isFuture = ds > today;
        dot.className = "goal-dot" + (isDone ? " done" : "") + (isFrozen ? " frozen" : "") + (isFuture && !isDone && !isFrozen ? " future" : "");
        if (isDone || isFrozen) {
          if (isDone) dot.style.background = categoryColor(goal.category);
          consecutiveDone++;
          if (consecutiveDone % 7 === 0) dot.classList.add("milestone");
        } else {
          consecutiveDone = 0;
        }
        dot.title = isFrozen ? `${ds}: streak freeze used` : ds;
        // Spring drives the entrance scale/opacity directly; keep CSS only
        // for background (dots are discarded and rebuilt on every render, so
        // there's no need to restore the dropped transform/opacity here).
        dot.style.transition = "background 200ms";
        dot.style.opacity = "0";
        dot.style.transform = "scale(0.7)";
        dots.appendChild(dot);

        const targetOpacity = (isFuture && !isDone) ? 0.4 : 1;
        const delay = Math.min(idx * 12, 300);
        setTimeout(() => {
          spring(0, targetOpacity, {}, (v) => { dot.style.opacity = v; });
          spring(0.7, 1, {}, (v) => { dot.style.transform = `scale(${v})`; });
        }, delay);
      });

      card.appendChild(top);
      card.appendChild(sub);
      card.appendChild(dots);
      listEl.appendChild(card);
    });
    lucide.createIcons();
  }

   

  function renderDate() {
    const today = new Date(); today.setHours(0,0,0,0);
    const check = new Date(currentDate); check.setHours(0,0,0,0);
    const diffDays = Math.round((check - today) / 86400000);

    let prefix = "";
    if (diffDays === 0) prefix = "Today, ";
    else if (diffDays === 1) prefix = "Tomorrow, ";
    else if (diffDays === -1) prefix = "Yesterday, ";

    document.getElementById("weekday").textContent = prefix + currentDate.toLocaleDateString(undefined, { weekday: "long" });
    document.getElementById("fulldate").textContent = currentDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  function renderProgress(dayTasks) {
    const total = dayTasks.length;
    const done = dayTasks.filter(t => t.occurrenceDone).length;
    const wrap = document.getElementById("progressWrap");
    if (total === 0) { wrap.style.display = "none"; return; }
    wrap.style.display = "block";
    const pct = Math.round((done / total) * 100);
    document.getElementById("progressCount").textContent = `${done} / ${total} tasks completed`;
    document.getElementById("progressFill").style.width = pct + "%";
    const remaining = total - done;
    let msg = "";
    if (remaining === 0) msg = "Everything completed";
    else if (remaining === 1) msg = "Only 1 task left";
    else if (pct >= 75) msg = `Almost there, ${remaining} to go`;
    else if (pct >= 50) msg = `Over halfway, ${remaining} to go`;
    else if (done > 0) msg = `${remaining} more to go`;
    document.getElementById("progressMsg").textContent = msg;
  }

  // Lightweight, once-per-day "all done" celebration. Keyed off a plain
  // localStorage date string (not the completion state itself) so unchecking
  // and rechecking a task, or just reopening the app later the same day,
  // never re-fires it — only a NEW calendar day resets the gate.
  const DAILY_COMPLETION_CELEBRATED_KEY = "dailyCompletionCelebratedDate";
  function maybeCelebrateDailyCompletion() {
    const todayStr = toDateStr(new Date());
    const todayTasks = getTasksForDate(new Date(), "All");
    if (todayTasks.length === 0 || !todayTasks.every(t => t.occurrenceDone)) return;
    if (localStorage.getItem(DAILY_COMPLETION_CELEBRATED_KEY) === todayStr) return;
    localStorage.setItem(DAILY_COMPLETION_CELEBRATED_KEY, todayStr);

    showToast("All done for today. Nice work.", "success", 3200);
    const wrap = document.getElementById("progressWrap");
    if (wrap) {
      wrap.classList.add("celebrate-pulse");
      setTimeout(() => wrap.classList.remove("celebrate-pulse"), 900);
    }
  }

  // First-time guidance arrow pointing at the shared .fab button (#openAdd
  // on Planner, #openAddGoal on Goals — never both visible at once, so one
  // arrow element serves both). Purely a visibility toggle; never disables
  // or hides the .fab itself.
  // Tracked separately from the DOM (rather than reading el.style.display
  // back) because this function runs on every render, not just when the
  // shown/hidden state actually changes — without it, springArrowIn() would
  // re-fire the entrance on every single render while the arrow stays
  // visible, not just the one time it actually appears.
  let fabArrowVisible = false;
  function updateFabArrow() {
    const el = document.getElementById("fabGuideArrow");
    if (!el) return;
    let show = false;
    if (currentView === "planner") {
      show = categories.length > 0 && tasks.length === 0;
    } else if (currentView === "goals") {
      show = tasks.filter(t => t.isGoal).length === 0;
    }
    if (show === fabArrowVisible) return;
    fabArrowVisible = show;
    if (show) {
      el.style.display = "flex";
      springArrowIn(el);
    } else {
      fadeArrowOut(el);
    }
  }

  // .catadd-guide-arrow is a fresh element every renderCategoryTabs() call
  // (the whole wrap is wiped and rebuilt each time), so unlike
  // #fabGuideArrow there's no persistent element to read prior visibility
  // off of — this flag is the only record of whether it was already
  // showing, so the entrance spring only fires the one time it actually
  // appears, not on every re-render while categories stay empty.
  let catAddArrowVisible = false;
  function renderCategoryTabs() {
    const wrap = document.getElementById("categoryTabs");
    wrap.innerHTML = "";

    const allCount = getTasksForDate(currentDate, "All").length;
    const allPill = document.createElement("button");
    allPill.className = "cat-pill";
    allPill.style.background = activeCategory === "All" ? "var(--accent)" : "var(--bg-card)";
    allPill.style.color = activeCategory === "All" ? "var(--on-accent)" : "var(--text-primary)";
    allPill.textContent = allCount > 0 ? `All (${allCount})` : "All";
    allPill.addEventListener("click", () => { activeCategory = "All"; renderAll(); });
    wrap.appendChild(allPill);

    categories.forEach(cat => {
      const count = getTasksForDate(currentDate, cat.name).length;
      const pill = document.createElement("button");
      const isActive = activeCategory === cat.name;
      pill.className = "cat-pill";
      pill.style.background = isActive ? cat.color : "var(--bg-card)";
      pill.style.color = isActive ? "#1a1d26" : "var(--text-primary)";
      pill.textContent = count > 0 ? `${cat.name} (${count})` : cat.name;
      pill.addEventListener("click", () => { activeCategory = cat.name; renderAll(); });
      pill.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openEditCategoryModal(cat.name);
      });
      wrap.appendChild(pill);
    });

    if (categories.length === 0) {
      const catAddArrow = document.createElement("div");
      catAddArrow.className = "guide-arrow catadd-guide-arrow";
      catAddArrow.innerHTML = '<i data-lucide="arrow-right" class="icon"></i>';
      wrap.appendChild(catAddArrow);
      if (!catAddArrowVisible) springArrowIn(catAddArrow);
      catAddArrowVisible = true;
    } else {
      catAddArrowVisible = false;
    }

    const addBtn = document.createElement("button");
    addBtn.className = "cat-add";
    addBtn.innerHTML = '<i data-lucide="plus" class="icon"></i>';
    addBtn.addEventListener("click", openCategoryModal);
    wrap.appendChild(addBtn);
    lucide.createIcons();
    updateFabArrow();

    const sel = document.getElementById("modalCategory");
    sel.innerHTML = "";
    if (categories.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "Add a category first";
      opt.disabled = true;
      sel.appendChild(opt);
    } else {
      categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.name;
        opt.textContent = cat.name;
        sel.appendChild(opt);
      });
    }
  }

  function renderTasks() {
    const listEl = document.getElementById("taskList");
    listEl.innerHTML = "";
    const dayTasks = getTasksForDate(currentDate, activeCategory);
    renderProgress(dayTasks);
    updateSelectAllBtn(dayTasks);

    if (dayTasks.length === 0) {
      const msg = document.createElement("div");
      msg.className = "empty-msg";
      // A brand-new account (no tasks anywhere yet, viewing the unfiltered
      // list) gets the fuller "what is this for" prompt; a returning user
      // who just has nothing scheduled for this particular day/category
      // keeps the plain, unobtrusive message — they don't need onboarding.
      if (tasks.length === 0 && activeCategory === "All") {
        // Sequenced guidance: a category has to exist before a task can be
        // added to it (openAddModal() itself blocks otherwise), so point at
        // .cat-add first and only point at .fab once that's satisfied.
        const instruction = categories.length === 0 ? "Add a category to get started" : "Add your first task";
        msg.innerHTML = `
          <i data-lucide="calendar-days" class="icon" style="width:28px;height:28px;color:var(--text-muted);display:block;margin:0 auto 0.5rem;"></i>
          <div class="big">Plan your day here.</div>
          Add the tasks you want to get done today, then check them off as you go.
          <span class="empty-msg-instruction">${instruction}</span>
        `;
        listEl.appendChild(msg);
      } else {
        msg.innerHTML = `<i data-lucide="calendar-days" class="icon" style="width:28px;height:28px;color:var(--text-muted);display:block;margin:0 auto 0.5rem;"></i><div class="big">No tasks for this day.</div>`;
        listEl.appendChild(msg);
      }
      lucide.createIcons();
      return;
    }
    if (dayTasks.every(t => t.occurrenceDone)) {
      const msg = document.createElement("div");
      msg.className = "empty-msg";
      msg.innerHTML = `<div class="big"><i data-lucide="check-circle-2" class="icon icon-lg icon-accent"></i> Everything is done for today.</div>Go enjoy your day.`;
      listEl.appendChild(msg);
      lucide.createIcons();
      return;
    }

    dayTasks.forEach(task => {
      const li = document.createElement("li");
      const isSelected = selectedTaskIds.has(task.id);
      li.className = "task-item pressable" + (task.occurrenceDone ? " done" : "") + (task.id === lastAddedTaskId ? " entering" : "") + (selectMode ? " select-mode" : "") + (isSelected ? " item-selected" : "");
      // No inline border-left-color here — an inline style would outrank
      // the .item-selected CSS rule's border-left-color (inline beats any
      // class selector), silently breaking the selection-state color.
      // .task-category below already carries the category color.
      li.dataset.taskId = task.id;

      const selectCheckbox = document.createElement("div");
      selectCheckbox.className = "select-checkbox" + (isSelected ? " checked" : "");
      selectCheckbox.innerHTML = isSelected ? '<i data-lucide="check" class="icon"></i>' : "";

      const drag = document.createElement("div");
      drag.className = "drag-handle";
      drag.innerHTML = '<i data-lucide="grip-vertical" class="icon"></i>';

      const checkbox = document.createElement("div");
      checkbox.className = "checkbox" + (task.occurrenceDone ? " checked" : "") + (task.occurrenceFrozen ? " frozen" : "");
      // A frozen day must never look like a completed one — snowflake, not a
      // checkmark, and never combined with the "checked" state (occurrenceFrozen
      // is only ever true when occurrenceDone is false, see getTasksForDate).
      if (task.occurrenceDone) checkbox.innerHTML = '<i data-lucide="check" class="icon"></i>';
      else if (task.occurrenceFrozen) { checkbox.innerHTML = '<i data-lucide="snowflake" class="icon"></i>'; checkbox.title = "Streak freeze used this day"; }
      else checkbox.innerHTML = "";
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isDayLocked(task.occurrenceDate)) { showToast("This day is locked. Reflection already completed.", "warning"); return; }
        const realTask = tasks.find(t => t.id === task.id);
        let nowDone;
        if (task.isRecurring) {
          realTask.completedDates = realTask.completedDates || [];
          const idx = realTask.completedDates.indexOf(task.occurrenceDate);
          if (idx === -1) { realTask.completedDates.push(task.occurrenceDate); nowDone = true; }
          else { realTask.completedDates.splice(idx, 1); nowDone = false; }
        } else {
          realTask.done = !realTask.done;
          nowDone = realTask.done;
        }

        checkbox.classList.toggle("checked", nowDone);
        // Spring drives the pop scale directly; keep CSS transitions for
        // background/border-color (the checked-state color change) but not
        // transform, mirroring .checkbox's rule in styles.css minus transform.
        checkbox.style.transition = "background 300ms ease, border-color 300ms ease";
        spring(1, 1.08, { key: checkbox }, (v) => {
          checkbox.style.transform = `scale(${v})`;
        }, () => {
          spring(1.08, 1, { key: checkbox }, (v) => {
            checkbox.style.transform = `scale(${v})`;
          });
        });

        if (nowDone) {
          triggerHaptic("light");
          checkbox.innerHTML = '<i data-lucide="check" class="icon" style="opacity:0;transform:scale(0.5);transition:opacity 200ms cubic-bezier(0.34,1.56,0.64,1), transform 200ms cubic-bezier(0.34,1.56,0.64,1);"></i>';
          lucide.createIcons();
          const checkIcon = checkbox.querySelector(".icon");
          requestAnimationFrame(() => {
            checkIcon.style.opacity = "1";
            checkIcon.style.transform = "scale(1)";
          });
          li.classList.add("completing");
          save();
          maybeCelebrateDailyCompletion();
          setTimeout(() => renderTasks(), 450);
        } else {
          checkbox.innerHTML = "";
          save();
          setTimeout(() => renderTasks(), 200);
        }
      });

      const name = document.createElement("span");
      name.className = "task-name";
      name.textContent = task.checkoffLabel || task.name;

      const meta = document.createElement("span");
      meta.className = "task-meta";
      const durText = formatDuration(task.duration);
      const durIcon = durText ? '<i data-lucide="clock" class="icon"></i>' + durText : "";
      const goalIcon = task.isGoal ? '<i data-lucide="target" class="icon"></i>' : "";
      let streakIcon = "";
      let freezeIcon = "";
      if (task.isRecurring) {
        const realTask = tasks.find(t => t.id === task.id);
        const streak = computeStreak(realTask);
        streakIcon = streak > 0 ? `<i data-lucide="flame" class="icon"></i>${streak}` : '<i data-lucide="repeat" class="icon"></i>';
        const freezesAvailable = applyStreakFreezes(realTask).freezesAvailable;
        if (freezesAvailable > 0) freezeIcon = `<i data-lucide="snowflake" class="icon"></i>${freezesAvailable}`;
      }
      const metaParts = [task.time, durIcon, streakIcon, freezeIcon, goalIcon].filter(Boolean);
      meta.innerHTML = metaParts.join(" · ");

      const cat = document.createElement("span");
      cat.className = "task-category";
      cat.style.setProperty("--task-cat-color", categoryColor(task.category));
      cat.textContent = task.category;

      // Only ever appended when overdue — with no modifier class applied
      // otherwise, there's nothing rendered for the false case, matching
      // "no modifier class, stays hidden" without needing new CSS.
      const overdue = document.createElement("span");
      if (isTaskOverdue(task)) {
        overdue.className = "status-badge overdue";
        overdue.textContent = "Overdue";
      }

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i data-lucide="x" class="icon"></i>';
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        const label = task.isRecurring ? "Delete this whole repeating task series?" : "Delete this task?";
        showConfirm({
          title: "Delete task",
          message: label,
          confirmLabel: "Delete",
          danger: true,
          onConfirm: () => {
            const height = li.offsetHeight;
            li.style.maxHeight = height + "px";
            li.classList.add("exiting");
            void li.offsetHeight;
            requestAnimationFrame(() => {
              li.style.opacity = "0";
              li.style.maxHeight = "0px";
              li.style.marginBottom = "0px";
              li.style.paddingTop = "0px";
              li.style.paddingBottom = "0px";
            });
            setTimeout(() => {
              tasks = tasks.filter(t => t.id !== task.id);
              save();
              renderTasks();
            }, 200);
          }
        });
      });

      li.addEventListener("click", (e) => {
        if (selectMode) {
          toggleTaskSelection(task.id);
          return;
        }
        if (e.target === checkbox || e.target === del) return;
        // Delayed so the row's .pressable press-squash is visible before
        // the modal covers it, instead of the tap looking like it did nothing.
        setTimeout(() => openEditModal(task.id), 100);
      });

      li.appendChild(selectCheckbox);
      li.appendChild(drag);
      li.appendChild(checkbox);
      li.appendChild(name);
      if (metaParts.length) li.appendChild(meta);
      li.appendChild(cat);
      if (overdue.classList.contains("overdue")) li.appendChild(overdue);
      li.appendChild(del);
      listEl.appendChild(li);
    });
    lucide.createIcons();
    lastAddedTaskId = null;

    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = new Sortable(listEl, {
      animation: 150,
      ghostClass: "sortable-ghost",
      disabled: selectMode,
      onEnd: () => {
        const newOrderIds = [...listEl.children].map(li => li.dataset.taskId).filter(Boolean);
        newOrderIds.forEach((id, index) => {
          const t = tasks.find(t => t.id === id);
          if (t) t.order = index;
        });
        save();
        triggerHaptic("light");
      }
    });

    updateBulkActionBar();
  }

  function toggleTaskSelection(taskId) {
    if (selectedTaskIds.has(taskId)) selectedTaskIds.delete(taskId); else selectedTaskIds.add(taskId);
    renderTasks();
  }

  function setSelectMode(on) {
    selectMode = on;
    if (!on) selectedTaskIds.clear();
    document.body.classList.toggle("select-mode-active", on);
    document.getElementById("selectModeBtn").textContent = on ? "Cancel" : "Select";
    renderTasks();
  }

  function updateBulkActionBar() {
    document.getElementById("bulkActionBar").style.display = (selectMode && selectedTaskIds.size > 0) ? "flex" : "none";
  }

  function updateSelectAllBtn(dayTasks) {
    const btn = document.getElementById("selectAllBtn");
    btn.style.display = selectMode ? "inline-block" : "none";
    if (!selectMode) return;
    const allSelected = dayTasks.length > 0 && dayTasks.every(t => selectedTaskIds.has(t.id));
    btn.textContent = allSelected ? "Deselect all" : "Select all";
  }

  document.getElementById("selectModeBtn").addEventListener("click", () => setSelectMode(!selectMode));

  document.getElementById("selectAllBtn").addEventListener("click", () => {
    const dayTasks = getTasksForDate(currentDate, activeCategory);
    const allSelected = dayTasks.length > 0 && dayTasks.every(t => selectedTaskIds.has(t.id));
    if (allSelected) {
      dayTasks.forEach(t => selectedTaskIds.delete(t.id));
    } else {
      dayTasks.forEach(t => selectedTaskIds.add(t.id));
    }
    renderTasks();
  });

  function renderAll() {
    syncAllStreakFreezes();
    renderDate();
    renderCategoryTabs();
    renderTasks();

    const locked = isDayLocked(toDateStr(currentDate));
    const isFutureDay = toDateStr(currentDate) > toDateStr(new Date());
    document.getElementById("lockedBanner").style.display = locked ? "block" : "none";
    document.getElementById("endDayBtn").style.display = (locked || isFutureDay) ? "none" : "block";
  }

  document.getElementById("prevDay").addEventListener("click", () => { currentDate.setDate(currentDate.getDate() - 1); renderAll(); });
  document.getElementById("nextDay").addEventListener("click", () => { currentDate.setDate(currentDate.getDate() + 1); renderAll(); });
  function goToToday() { currentDate = new Date(); renderAll(); }

  // Swipeable day navigation on the Planner's date header — adapts the same
  // gesture-quality patterns already built and debugged in
  // enableModalDragDismiss() (spring physics, touch-action, velocity-based
  // commit, cancel-always-safe). Touch + Mouse events rather than literally
  // Pointer Events, for the same reason as that function: Pointer Events
  // don't reliably fire at all on older Safari, which is the actual target
  // device here — see that function's own comment for the fuller story.
  // "pointercancel" below means touchcancel (mouse has no equivalent, same
  // as the modal).
  function enableDateNavSwipe(navEl, extraStartEls, plannerViewEl) {
    extraStartEls = (extraStartEls || []).filter(Boolean);
    const DIRECTION_LOCK_DISTANCE = 10; // px of total movement sampled before committing to a direction
    const RUBBER_START = 100;
    const RUBBER_RANGE = 80;
    const RUBBER_CONSTANT = 0.55;
    const COMMIT_DISTANCE = 60;
    const COMMIT_VELOCITY = 0.5; // px/ms
    // See enableModalDragDismiss()'s identical constant for why this isn't
    // shorter: a held-still drag produces zero move events, indistinguishable
    // from a stuck one by inactivity alone. visibilitychange/blur below are
    // the real, event-based triggers; this is only a last-resort fallback.
    const STALL_TIMEOUT = 5000;

    // idle: nothing happening. sampling: pointer down, direction not yet
    // decided. horizontal: locked in, this drag owns the gesture. aborted:
    // decided vertical — hands off entirely, browser's native scroll owns it.
    let phase = "idle";
    let startX = 0, startY = 0;
    let dx = 0;
    let lastX = 0, lastT = 0, velocity = 0;
    let stallTimer = null;
    // True from the moment a commit is decided until the enter-spring for
    // the new day settles — covers the gap phase alone can't, since phase
    // itself goes back to "idle" as soon as the exit/enter sequence starts
    // (the live drag is over; what's left is an auto-driven animation, not
    // a gesture in progress). Blocks a new swipe from starting mid-sequence.
    let transitioning = false;
    // Dedicated key, separate from any other spring usage on this page —
    // same lesson as enableModalDragDismiss()'s dragSpringKey: sharing a
    // key across springs animating different value spaces corrupts the
    // inherited starting position when one interrupts the other. Reused
    // across the live drag, cancel, exit, and enter springs here since all
    // of them animate the same value space (horizontal pixel offset).
    const navSpringKey = {};

    function rubberBand(d, range, c) {
      return (d * range * c) / (range + c * d);
    }

    function visualDxFor(rawDx) {
      const abs = Math.abs(rawDx);
      if (abs <= RUBBER_START) return rawDx;
      const sign = rawDx < 0 ? -1 : 1;
      return sign * (RUBBER_START + rubberBand(abs - RUBBER_START, RUBBER_RANGE, RUBBER_CONSTANT));
    }

    function armStallTimer() {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { if (phase === "horizontal") cancelSwipe(); }, STALL_TIMEOUT);
    }

    // Mouse-dragging across text (the date, the progress line) would
    // otherwise trigger the browser's native text-selection while horizontal
    // lock is active — set only for the drag's duration rather than via
    // preventDefault() on every event, which would risk swallowing other
    // default behavior too.
    function setSwipeZoneUserSelect(value) {
      navEl.style.userSelect = value;
      extraStartEls.forEach((el) => { el.style.userSelect = value; });
    }

    function begin(clientX, clientY, targetEl) {
      if (phase !== "idle" || transitioning) return;
      if (targetEl.closest("button, a, input, select, textarea")) return;
      // Mutual exclusion with switchView()'s own entrance spring, which
      // also drives #plannerView's transform (translateY, on tab-switch
      // crossfade) via this same key. Day-swipe only makes sense while
      // already on Planner, so if that's still mid-flight, just don't
      // start tracking rather than risk both writing to transform at once.
      if (springRegistry.has(VIEW_SLIDE_SPRING_KEY)) return;
      phase = "sampling";
      startX = clientX;
      startY = clientY;
      dx = 0;
      lastX = clientX;
      lastT = performance.now();
      velocity = 0;
    }

    function move(clientX, clientY) {
      if (phase === "idle" || phase === "aborted") return;
      const rawDx = clientX - startX;
      const rawDy = clientY - startY;

      if (phase === "sampling") {
        if (Math.hypot(rawDx, rawDy) < DIRECTION_LOCK_DISTANCE) return;
        if (Math.abs(rawDx) <= Math.abs(rawDy)) {
          // Vertical or ambiguous — hand this gesture entirely back to the
          // browser (page scroll) and never touch it again this gesture.
          phase = "aborted";
          return;
        }
        phase = "horizontal";
        // Seize this gesture's own key, in case a previous release's
        // cancel spring is still settling.
        spring(0, 0, { key: navSpringKey }, () => {}, () => {});
        navEl.style.touchAction = "none";
        setSwipeZoneUserSelect("none");
        armStallTimer();
      }

      armStallTimer();
      dx = rawDx;
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) velocity = (clientX - lastX) / dt;
      lastX = clientX;
      lastT = now;
      // The drag-start zone stays .date-nav/#progressWrap (navEl/
      // extraStartEls, for touch-action/user-select above) but what
      // actually moves is the whole page — plannerViewEl.
      plannerViewEl.style.transform = `translateX(${visualDxFor(dx)}px)`;
    }

    // Same principle as the modal: anything that isn't a clean, deliberate
    // release (an interrupted gesture, or the stall watchdog) always springs
    // back rather than acting on possibly-stale data.
    function cancelSwipe() {
      if (phase !== "horizontal") { phase = "idle"; return; }
      phase = "idle";
      clearTimeout(stallTimer);
      const visual = visualDxFor(dx);
      spring(visual, 0, { key: navSpringKey }, (v) => {
        plannerViewEl.style.transform = `translateX(${v}px)`;
      }, () => {
        plannerViewEl.style.transform = "";
        navEl.style.touchAction = "";
        setSwipeZoneUserSelect("");
      });
    }

    function end() {
      if (phase !== "horizontal") { phase = "idle"; return; } // tap, or already handed off to the browser
      clearTimeout(stallTimer);

      const shouldCommit = Math.abs(dx) > COMMIT_DISTANCE || Math.abs(velocity) > COMMIT_VELOCITY;
      if (!shouldCommit) { cancelSwipe(); return; }

      phase = "idle";
      transitioning = true;
      navEl.style.touchAction = "";
      setSwipeZoneUserSelect("");
      // Nothing should be tappable/draggable (including #taskList's
      // Sortable.js reordering) while content is mid-transition and not
      // actually where the user's finger is anymore.
      plannerViewEl.style.pointerEvents = "none";

      // Drag right (dx>0) mirrors reaching for the left/prev chevron, and
      // continuing further right is "the old day exits right, the previous
      // day enters from the left" — the reverse for a left drag/next day.
      const dir = dx > 0 ? 1 : -1;
      const exitTarget = dir * window.innerWidth;
      const enterStart = -dir * window.innerWidth;
      const visual = visualDxFor(dx);
      // Once the exiting content has moved past its own rendered width,
      // it's fully clear of where it started on screen — safe to swap and
      // teleport it without that being visible. translateX doesn't affect
      // layout, so this stays accurate throughout regardless of the
      // current offset.
      const offscreenThreshold = plannerViewEl.getBoundingClientRect().width;

      let handedOff = false;
      // Swap on threshold-crossing while the exit spring is still moving,
      // not on settle — waiting for it to fully stop (velocity ~0) before
      // launching a second spring from a standstill is what made this read
      // as two animations stapled together, a visible "stop", rather than
      // one continuous flow. Handing off here carries the live velocity
      // into the enter spring below instead.
      const exitController = spring(visual, exitTarget, { key: navSpringKey, stiffness: 1800, damping: 75 }, (v) => {
        plannerViewEl.style.transform = `translateX(${v}px)`;
        if (handedOff || Math.abs(v) < offscreenThreshold) return;
        handedOff = true;
        const carriedVelocity = exitController.velocity;
        // Old day is fully off-screen now — safe to swap content. Click
        // the real buttons rather than duplicating their day-math +
        // renderAll() here, so this can never drift out of sync with them.
        // (renderTasks() inside renderAll() destroys/recreates Sortable on
        // every call already — nothing extra needed here for that.)
        document.getElementById(dir > 0 ? "prevDay" : "nextDay").click();
        // Instant, no transition: place the newly-rendered new day just
        // off the opposite edge, ready to enter from there.
        plannerViewEl.style.transform = `translateX(${enterStart}px)`;
        // Same key as the exit spring, which stops it (see spring()'s own
        // stopped-flag handling for why that's now safe to do from inside
        // this still-running onUpdate); explicit velocity carries the
        // exit's momentum through the teleport instead of relaunching from
        // a standstill, which is the actual "flow, not a stop" fix.
        spring(enterStart, 0, { key: navSpringKey, position: enterStart, velocity: carriedVelocity, stiffness: 1800, damping: 75 }, (v2) => {
          plannerViewEl.style.transform = `translateX(${v2}px)`;
        }, () => {
          plannerViewEl.style.transform = "";
          plannerViewEl.style.pointerEvents = "";
          transitioning = false;
        });
      }, () => {
        // Only reached if the exit spring fully settles without ever
        // crossing the threshold — shouldn't normally happen, since
        // exitTarget is always farther out than offscreenThreshold, but
        // guards against ending up stuck mid-exit if it somehow did.
        if (handedOff) return;
        document.getElementById(dir > 0 ? "prevDay" : "nextDay").click();
        plannerViewEl.style.transform = "";
        plannerViewEl.style.pointerEvents = "";
        transitioning = false;
      });
    }

    // Bound to both navEl and extraStartEls below — begin()/move()/end()
    // don't care which element a gesture started on, only where the
    // pointer is; navEl alone still owns the visual transform throughout.
    function bindStart(el) {
      el.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        begin(t.clientX, t.clientY, e.target);
      }, { passive: true }); // sampling phase never preventDefaults, so this can stay passive
      el.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        begin(e.clientX, e.clientY, e.target);
      });
    }

    bindStart(navEl);
    extraStartEls.forEach(bindStart);

    document.addEventListener("touchmove", (e) => {
      if (phase === "idle" || phase === "aborted") return;
      move(e.touches[0].clientX, e.touches[0].clientY);
      if (phase === "horizontal") e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", cancelSwipe);

    document.addEventListener("mousemove", (e) => {
      if (phase === "idle" || phase === "aborted") return;
      move(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", end);

    // Same reasoning as enableModalDragDismiss(): tab/window losing focus is
    // a real interruption signal, unlike mere inactivity while the user
    // holds still deciding.
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelSwipe(); });
    window.addEventListener("blur", cancelSwipe);
  }
  // Planner only — #plannerView disambiguates from reflection's own,
  // separate .date-nav, which this deliberately does not touch. progressWrap
  // widens the drag-start hit area (purely visual, no buttons/handlers of
  // its own); #plannerView itself is what actually moves.
  enableDateNavSwipe(document.querySelector("#plannerView .date-nav"), [document.getElementById("progressWrap")], document.getElementById("plannerView"));

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "t" && !overlay.classList.contains("open") && !goalOverlay.classList.contains("open")) {
      goToToday();
    }
  });

  const overlay = document.getElementById("modalOverlay");

  // Drag-to-dismiss, piloted on this one modal only (see enableModalDragDismiss
  // call below) before considering a wider rollout — written against a
  // generic overlay/modal pair so extending it later is just another call,
  // not a rewrite.
  //
  // Drag only starts from the top handle zone (near the title) and only
  // when the modal's own content is scrolled to the top, so it can't hijack
  // a scroll or a tap on a form field. Downward drag follows the finger
  // 1:1 up to FREE_DRAG, then rubber-bands (iOS-style) so it never feels
  // like it's about to fly off; upward drag is fully ignored. On release,
  // a real distance-or-velocity threshold decides whether to spring the
  // modal off-screen and hand off to the existing closeModal() (same CSS
  // fade every other modal close already uses) or spring back to rest.
  function enableModalDragDismiss(overlayEl) {
    const modalEl = overlayEl.querySelector(".modal");
    if (!modalEl) return;

    const HANDLE_HEIGHT = 56;
    const FREE_DRAG = 160;
    const RUBBER_RANGE = 80;
    const RUBBER_CONSTANT = 0.55;
    const CLOSE_DISTANCE = 130;
    const CLOSE_VELOCITY = 0.5; // px/ms
    // A held-still drag (finger down, deciding, not yet released) produces
    // zero move events — indistinguishable from a genuinely stuck gesture by
    // inactivity alone, so that can't be the trigger. visibilitychange/blur
    // below catch the real failure mode (something actually interrupted the
    // gesture) instantly; this is only a last-resort fallback, long enough
    // to never plausibly fire during a normal paused hold.
    const STALL_TIMEOUT = 5000;

    let dragging = false;
    let startY = 0;
    let rawDy = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let stallTimer = null;
    let restingTop = 0;
    // Dedicated key for this drag's own translateY springs (cancel/commit),
    // deliberately separate from openModal()'s own `key: modalEl` scale
    // spring. spring()'s key-based continuation inherits the PRIOR spring's
    // raw numeric position when a new call shares a key — fine within one
    // value space, but openModal() animates a scale factor (~0.96-1) while
    // this drag animates a pixel offset (0-600+), so sharing modalEl as the
    // key here would let a still-mid-flight open animation hand its scale
    // number off as this drag's starting pixel position — exactly the
    // "jumps to a nonsense position, then vanishes" bug this key avoids.
    const dragSpringKey = {};

    function rubberBand(d, range, c) {
      return (d * range * c) / (range + c * d);
    }

    function visualDyFor(dy) {
      if (dy <= 0) return 0;
      if (dy <= FREE_DRAG) return dy;
      return FREE_DRAG + rubberBand(dy - FREE_DRAG, RUBBER_RANGE, RUBBER_CONSTANT);
    }

    function canStartDrag(clientY, targetEl) {
      if (dragging) return false;
      if (!overlayEl.classList.contains("open")) return false;
      if (targetEl.closest("input, select, textarea, button, a")) return false;
      const rect = modalEl.getBoundingClientRect();
      const inHandleZone = clientY - rect.top <= HANDLE_HEIGHT;
      // The handle zone (title area) can always start a dismiss, regardless
      // of scroll position — it's not part of the scrollable content, so
      // there's nothing to "finish scrolling" there. The scrollTop gate
      // only matters below it, bottom-sheet style: don't hijack a scroll
      // that's still mid-flight, only pick up a drag once it's already at
      // the top.
      if (inHandleZone) return true;
      return modalEl.scrollTop === 0;
    }

    function armStallTimer() {
      clearTimeout(stallTimer);
      // Real hardware can hijack a touch mid-drag (its own scroll/gesture
      // recognition taking over) without ever delivering a terminal event
      // to us at all — no touchend, no touchcancel, nothing. Without this,
      // that leaves `dragging` stuck true and the modal frozen wherever the
      // last touchmove left it, forever. This guarantees an outcome even
      // when the browser never tells us the gesture ended. Kept as a
      // fallback only — see STALL_TIMEOUT's comment.
      stallTimer = setTimeout(() => { if (dragging) cancelDrag(); }, STALL_TIMEOUT);
    }

    function startDrag(clientY) {
      dragging = true;
      startY = clientY;
      rawDy = 0;
      lastY = clientY;
      lastT = performance.now();
      velocity = 0;
      // Captured once, up front, while the modal is still at its natural
      // resting position — endDrag()'s fly-away target is computed from
      // this, not a live re-measurement, since by release time the modal's
      // own rect is already offset by the drag and would under-shoot.
      restingTop = modalEl.getBoundingClientRect().top;
      // Seize the modal's transform key from openModal()'s own scale
      // spring, in case a drag starts before that's settled — otherwise
      // its rAF loop would keep overwriting the translateY this drives.
      spring(1, 1, { key: modalEl }, () => {}, () => {});
      // Also seize this drag's own key, in case a fresh grab starts while a
      // previous release's cancel/commit spring (dragSpringKey) is still
      // settling — otherwise that spring's rAF loop would fight this drag's
      // direct transform writes on alternating frames.
      spring(0, 0, { key: dragSpringKey }, () => {}, () => {});
      modalEl.style.transitionProperty = "none";
      // Belt-and-suspenders against the page's own bounce/pull-to-reload
      // winning the gesture instead of this drag; touch-action alone isn't
      // reliably honored on older Safari, hence also preventDefault() below
      // on every touchmove, not just once at the start.
      modalEl.style.touchAction = "none";
      armStallTimer();
    }

    function moveDrag(clientY) {
      if (!dragging) return;
      armStallTimer(); // real movement is still arriving — push the stall deadline out
      rawDy = clientY - startY;
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) velocity = (clientY - lastY) / dt;
      lastY = clientY;
      lastT = now;
      modalEl.style.transform = `translateY(${visualDyFor(rawDy)}px)`;
    }

    // The safe outcome for anything that isn't a clean, deliberate release:
    // an interrupted gesture (touchcancel) or a stalled one (the watchdog
    // above) always springs back to rest rather than running the distance/
    // velocity decision on data that may be stale or mid-hijack — committing
    // to a full close on ambiguous input is the riskier failure mode here.
    function cancelDrag() {
      if (!dragging) return;
      dragging = false;
      clearTimeout(stallTimer);
      const visual = visualDyFor(rawDy);
      spring(visual, 0, { key: dragSpringKey }, (v) => {
        modalEl.style.transform = `translateY(${v}px)`;
      }, () => {
        modalEl.style.transitionProperty = "";
        modalEl.style.transform = "";
        modalEl.style.touchAction = "";
      });
    }

    function endDrag() {
      if (!dragging) return;
      const shouldClose = rawDy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY;
      if (!shouldClose) { cancelDrag(); return; }

      dragging = false;
      clearTimeout(stallTimer);
      const visual = visualDyFor(rawDy);
      const flyDistance = window.innerHeight - restingTop + 40;
      // A damped spring settles asymptotically — it doesn't actually reach
      // "stopped" at flyDistance until well after the modal has already
      // scrolled fully below the visible viewport, so waiting for onComplete
      // to fire the backdrop close left the blurred overlay visibly stuck on
      // screen for a beat after the modal itself was already gone. Fire the
      // close as soon as it crosses fully offscreen instead — same
      // early-trigger-inside-onUpdate pattern as the day-swipe's exit/enter
      // handoff — not at settle.
      const offscreenThreshold = window.innerHeight - restingTop;
      let closed = false;
      let flySpring = null;
      function fireClose() {
        if (closed) return;
        closed = true;
        // Firing early (as soon as it's offscreen) means this spring is
        // usually still coasting toward flyDistance in the background —
        // stopping it here, not just resetting transform once, matters
        // because otherwise it keeps ticking and keeps overwriting
        // modalEl.style.transform on every subsequent frame. A reopen
        // (this same overlay, or any overlay reusing dragSpringKey) that
        // happens before it would've naturally settled landed its fresh
        // "" reset first, then watched this leftover spring immediately
        // clobber it again, frame by frame, walking the freshly-reopened
        // modal back off-screen — invisible, with only the backdrop (and
        // its blur) showing. That's what actually made a fast reopen after
        // a drag-dismiss look permanently stuck.
        if (flySpring) flySpring.stop();
        // Reset transitionProperty/transform here rather than counting on
        // the next open() to do it — that assumption held for app.js's own
        // openModal() (which unconditionally resets both), but several of
        // this function's overlays (Settings, Change Password, Reauth,
        // Auth) are opened by auth-ui.js's own separate, simpler
        // openModal() (just el.classList.add("open"), no reset). Without
        // this, reopening one of those after a drag-dismiss left the modal
        // box permanently transformed off-screen — the backdrop (and its
        // blur) reopened normally, but the dialog itself stayed invisible.
        modalEl.style.transitionProperty = "";
        modalEl.style.transform = "";
        modalEl.style.touchAction = "";
        // closeModal()'s shared 200ms backdrop fade is tuned for a modal
        // shrinking/fading in place — but by now it's already flown fully
        // off-screen (and closes early, the instant it does, rather than at
        // spring settle), so the full 200ms would just be a needless extra
        // beat before the backdrop catches up. The base CSS also delays
        // visibility:hidden by 200ms (so the fade has time to play out
        // normally) — overriding only the duration leaves that delay in
        // place, so the blurred backdrop would stay rendered for up to
        // 200ms after the modal is already gone. Zero the delay too, but
        // keep the duration short-and-real (not near-zero) — 50ms compresses
        // to under 3 frames, which reads as an abrupt cut rather than a
        // fade. Scoped to only this close path (override, then restore once
        // it's done) — Cancel/Escape/tap-outside all keep the normal 200ms
        // fade untouched.
        overlayEl.style.transitionDuration = "140ms";
        overlayEl.style.transitionDelay = "0s";
        closeModal(overlayEl);
        setTimeout(() => {
          overlayEl.style.transitionDuration = "";
          overlayEl.style.transitionDelay = "";
        }, 150);
      }
      flySpring = spring(visual, flyDistance, { key: dragSpringKey, stiffness: 300, damping: 30 }, (v) => {
        modalEl.style.transform = `translateY(${v}px)`;
        if (v >= offscreenThreshold) fireClose();
      }, fireClose);
    }

    // Touch events, not Pointer Events — Pointer Events support on Safari
    // has historically been incomplete/late (full support only from iOS 13
    // on), so on an older phone they can simply never fire at all, silently
    // leaving every touch to the page's native scroll. Touch events have
    // been supported since the very first iPhoneOS, so this is the more
    // reliable choice for the actual target device here.
    modalEl.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      if (!canStartDrag(t.clientY, e.target)) return;
      startDrag(t.clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      moveDrag(e.touches[0].clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchend", endDrag);
    document.addEventListener("touchcancel", cancelDrag);

    // The real signals something interrupted the gesture (tab backgrounded,
    // app switched away, window lost focus) — unlike inactivity, these can't
    // fire just because the user is holding still deciding whether to
    // commit, so they're safe to treat as "recover now" rather than a guess.
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelDrag(); });
    window.addEventListener("blur", cancelDrag);

    // Mouse events for desktop (the pilot's already-verified click-drag path).
    modalEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!canStartDrag(e.clientY, e.target)) return;
      startDrag(e.clientY);
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => moveDrag(e.clientY));
    document.addEventListener("mouseup", endDrag);
  }
  enableModalDragDismiss(overlay);

  const repeatSelect = document.getElementById("modalRepeat");
  const repeatExtra = document.getElementById("repeatExtra");
  const weekdayPicker = document.getElementById("weekdayPicker");

  function buildWeekdayPicker() {
    weekdayPicker.innerHTML = "";
    WEEKDAY_LABELS.forEach((label, i) => {
      const btn = document.createElement("div");
      btn.className = "weekday-btn" + (selectedWeekdays.includes(i) ? " selected" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        const idx = selectedWeekdays.indexOf(i);
        if (idx === -1) selectedWeekdays.push(i); else selectedWeekdays.splice(idx, 1);
        buildWeekdayPicker();
      });
      weekdayPicker.appendChild(btn);
    });
  }

  repeatSelect.addEventListener("change", () => {
    repeatExtra.classList.toggle("show", repeatSelect.value !== "none");
  });

  document.getElementById("modalIsGoal").addEventListener("change", () => {
    document.getElementById("modalGoalFields").classList.toggle("show", document.getElementById("modalIsGoal").checked);
  });

  function openAddModal() {
    if (isDayLocked(toDateStr(currentDate))) { showToast("This day is locked. You can't add tasks to a day you've already reflected on.", "warning"); return; }
    if (categories.length === 0) { showToast("Add a category first using the + next to the category tabs.", "warning"); return; }
    editingTaskId = null;
    document.getElementById("modalTitle").textContent = "Add Task";
    document.getElementById("modalName").value = "";
    document.getElementById("modalTime").value = "";
    document.getElementById("modalDuration").value = "";
    document.getElementById("modalDate").value = toDateStr(currentDate);
    document.getElementById("modalEndDate").value = "";
    document.getElementById("modalInterval").value = 1;
    if (activeCategory !== "All") {
      document.getElementById("modalCategory").value = activeCategory;
    }
    document.getElementById("modalIsGoal").checked = false;
    document.getElementById("modalGoalFields").classList.remove("show");
    document.getElementById("modalGoalWhy").value = "";
    document.getElementById("modalGoalPlan").value = "";
    repeatSelect.value = "none";
    repeatExtra.classList.remove("show");
    selectedWeekdays = [currentDate.getDay()];
    buildWeekdayPicker();
    document.getElementById("copiesRow").style.display = "block";
    document.getElementById("modalCopies").value = 1;
    openModal(overlay);
    setTimeout(() => document.getElementById("modalName").focus(), 50);
  }

  // FAB-to-modal shape morph for the Add Task modal specifically. Deliberately
  // NOT routed through openModal() — that shared function drives ~15 other
  // modals and stays untouched. The setup block below duplicates
  // openAddModal()'s guard checks and form reset (rather than factoring out
  // a shared helper) so openAddModal() itself can stay completely
  // unmodified for its other callers. Close still goes through the
  // ordinary closeModal(overlay) — this pass only replaces how the modal
  // becomes visible on open.
  function openAddTaskModalMorphed() {
    if (isDayLocked(toDateStr(currentDate))) { showToast("This day is locked. You can't add tasks to a day you've already reflected on.", "warning"); return; }
    if (categories.length === 0) { showToast("Add a category first using the + next to the category tabs.", "warning"); return; }
    editingTaskId = null;
    document.getElementById("modalTitle").textContent = "Add Task";
    document.getElementById("modalName").value = "";
    document.getElementById("modalTime").value = "";
    document.getElementById("modalDuration").value = "";
    document.getElementById("modalDate").value = toDateStr(currentDate);
    document.getElementById("modalEndDate").value = "";
    document.getElementById("modalInterval").value = 1;
    if (activeCategory !== "All") {
      document.getElementById("modalCategory").value = activeCategory;
    }
    document.getElementById("modalIsGoal").checked = false;
    document.getElementById("modalGoalFields").classList.remove("show");
    document.getElementById("modalGoalWhy").value = "";
    document.getElementById("modalGoalPlan").value = "";
    repeatSelect.value = "none";
    repeatExtra.classList.remove("show");
    selectedWeekdays = [currentDate.getDay()];
    buildWeekdayPicker();
    document.getElementById("copiesRow").style.display = "block";
    document.getElementById("modalCopies").value = 1;

    const fab = document.getElementById("openAdd");
    const modal = overlay.querySelector(".modal");
    const fabRect = fab.getBoundingClientRect();

    // Measure .modal's natural centered target rect (with this modal's real,
    // just-reset content) without actually revealing it yet.
    overlay.style.visibility = "visible";
    overlay.style.opacity = "0";
    const modalRect = modal.getBoundingClientRect();
    const modalRadius = parseFloat(getComputedStyle(modal).borderRadius) || 0;
    overlay.style.visibility = "";
    overlay.style.opacity = "";

    // Pin the real modal at its final scale up front (silently, no
    // transition) so later, when .open triggers its CSS transition, only
    // opacity actually changes — the clone owns all the shape/size motion.
    modal.style.transitionProperty = "none";
    modal.style.transform = "scale(1)";
    void modal.offsetWidth;
    modal.style.transitionProperty = "";

    const clone = document.createElement("div");
    clone.style.position = "fixed";
    clone.style.top = fabRect.top + "px";
    clone.style.left = fabRect.left + "px";
    clone.style.width = fabRect.width + "px";
    clone.style.height = fabRect.height + "px";
    clone.style.borderRadius = (fabRect.width / 2) + "px";
    clone.style.background = "var(--accent)";
    clone.style.zIndex = "21"; // just under .modal-overlay's 22, so the real modal ends up on top once it fades in
    clone.style.pointerEvents = "none";
    document.body.appendChild(clone);

    // Fade the real FAB out from under the clone so there's no visible
    // duplicate at progress 0, where the clone exactly overlaps it.
    fab.style.transitionProperty = "opacity";
    fab.style.transitionDuration = "80ms";
    void fab.offsetWidth;
    fab.style.opacity = "0";

    // Dim/blur the backdrop early — a fixed real-time delay (reacting to
    // the tap itself), not tied to shape progress, so the clone spends most
    // of its journey traveling across an already-dimming background instead
    // of a fully bright one. Decoupled from .modal's own reveal below,
    // which still gates on the later crossover via .open.
    setTimeout(() => overlay.classList.add("backdrop-visible"), 80);

    let revealed = false;
    spring(0, 1, { stiffness: 260, damping: 26 }, (progress) => {
      clone.style.top = (fabRect.top + (modalRect.top - fabRect.top) * progress) + "px";
      clone.style.left = (fabRect.left + (modalRect.left - fabRect.left) * progress) + "px";
      clone.style.width = (fabRect.width + (modalRect.width - fabRect.width) * progress) + "px";
      clone.style.height = (fabRect.height + (modalRect.height - fabRect.height) * progress) + "px";
      clone.style.borderRadius = (fabRect.width / 2 + (modalRadius - fabRect.width / 2) * progress) + "px";

      if (!revealed && progress >= 0.8) {
        revealed = true;
        // Real modal/backdrop crossfade in on top of the still-settling
        // clone, timed to the modal's own normal 200ms open transition.
        overlay.style.transitionDuration = "200ms";
        modal.style.transitionDuration = "200ms";
        // Force a reflow between committing the duration and flipping the
        // opacity target (.open) — otherwise the browser can collapse both
        // into the same frame and the fade never visibly plays, same
        // gotcha as showNextView()'s void nextEl.offsetWidth.
        void overlay.offsetWidth;
        // Reset the modal's pinned scale down to a real starting point so
        // .modal's own CSS transition (transform ... -> scale(1) via
        // .modal-overlay.open .modal) has something to visibly animate,
        // giving the reveal a subtle scale-up alongside the opacity fade
        // instead of only opacity moving. Silent (no transition) via the
        // same forced-reflow pattern used earlier in this function.
        modal.style.transitionProperty = "none";
        modal.style.transform = "scale(0.95)";
        void modal.offsetWidth;
        modal.style.transitionProperty = "";
        // Release the inline pin entirely (rather than leaving it at
        // scale(0.95)) so .modal-overlay.open .modal's scale(1) can
        // actually win the cascade and transition — an inline transform,
        // at any value, always outranks a class rule and would otherwise
        // freeze the modal at 0.95 forever.
        modal.style.transform = "";
        overlay.classList.add("open");
        setTimeout(() => {
          overlay.style.transitionDuration = "";
          modal.style.transitionDuration = "";
          // The now-opaque overlay backdrop already covers the FAB (it sits
          // above it, z-index 22 vs auto), so restoring it here is invisible.
          fab.style.opacity = "";
          fab.style.transitionProperty = "";
          fab.style.transitionDuration = "";
        }, 210);
      }
    }, () => {
      clone.remove();
      // Defensive: guarantee the modal is open even if a frame skipped past
      // the 0.55 threshold check somehow.
      if (!overlay.classList.contains("open")) overlay.classList.add("open");
      // .open now covers the backdrop too, so this was only ever needed to
      // bridge the early-dim gap — drop it so it can't leak into a later,
      // unrelated normal open of this same shared overlay (e.g. Edit Task).
      overlay.classList.remove("backdrop-visible");
    });

    setTimeout(() => document.getElementById("modalName").focus(), 50);
  }

  function openEditModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    editingTaskId = taskId;
    document.getElementById("copiesRow").style.display = "none";
    document.getElementById("modalTitle").textContent = "Edit Task";
    document.getElementById("modalName").value = task.name;
    document.getElementById("modalCategory").value = task.category;
    document.getElementById("modalTime").value = task.time || "";
    document.getElementById("modalDuration").value = task.duration || "";
    document.getElementById("modalDate").value = task.date;
    document.getElementById("modalEndDate").value = task.endDate || "";
    document.getElementById("modalIsGoal").checked = !!task.isGoal;
    document.getElementById("modalGoalFields").classList.toggle("show", !!task.isGoal);
    document.getElementById("modalGoalWhy").value = task.why || "";
    document.getElementById("modalGoalPlan").value = task.plan || "";

    const rec = task.recurrence;
    if (rec && rec.type === "daily") {
      repeatSelect.value = "daily";
      repeatExtra.classList.add("show");
      selectedWeekdays = [];
    } else if (rec && rec.type === "weekly") {
      repeatSelect.value = "weekly";
      repeatExtra.classList.add("show");
      selectedWeekdays = [...rec.days];
      document.getElementById("modalInterval").value = rec.interval || 1;
    } else {
      repeatSelect.value = "none";
      repeatExtra.classList.remove("show");
      selectedWeekdays = [];
    }
    buildWeekdayPicker();

    openModal(overlay);
    setTimeout(() => document.getElementById("modalName").focus(), 50);
  }

  document.getElementById("openAdd").addEventListener("click", openAddModal);
  enableFabPressSpring(document.getElementById("openAdd"));
  document.getElementById("cancelAdd").addEventListener("click", () => closeModal(overlay));

  function submitTaskForm() {
    const name = document.getElementById("modalName").value.trim();
    const category = document.getElementById("modalCategory").value;
    const time = document.getElementById("modalTime").value;
    const duration = document.getElementById("modalDuration").value;
    const date = document.getElementById("modalDate").value || toDateStr(currentDate);
    const endDate = document.getElementById("modalEndDate").value;
    const repeatType = repeatSelect.value;
    const isGoal = repeatType !== "none" && document.getElementById("modalIsGoal").checked;
    const why = isGoal ? document.getElementById("modalGoalWhy").value.trim() : "";
    const plan = isGoal ? document.getElementById("modalGoalPlan").value.trim() : "";

    if (!name || !category) return;

    let recurrence = { type: "none" };
    if (repeatType === "daily") {
      recurrence = { type: "daily" };
    } else if (repeatType === "weekly") {
      recurrence = { type: "weekly", days: [...selectedWeekdays].sort(), interval: parseInt(document.getElementById("modalInterval").value) || 1 };
    }

    if (editingTaskId) {
      const task = tasks.find(t => t.id === editingTaskId);
      task.name = name; task.category = category; task.time = time; task.duration = duration;
      task.date = date; task.endDate = endDate; task.recurrence = recurrence; task.isGoal = isGoal;
      task.why = why; task.plan = plan;
      if (!task.completedDates) task.completedDates = [];
    } else {
      let copies = parseInt(document.getElementById("modalCopies").value) || 1;
      copies = Math.max(1, Math.min(10, copies));
      let maxOrder = tasks.filter(t => t.date === date).reduce((max, t) => Math.max(max, t.order ?? 0), -1);
      for (let i = 0; i < copies; i++) {
        const newId = Date.now().toString() + Math.random().toString(36).slice(2, 7);
        maxOrder += 1;
        tasks.push({
          id: newId, name, category, time, duration, date, endDate,
          done: false, order: maxOrder, recurrence, completedDates: [], isGoal, why, plan
        });
        lastAddedTaskId = newId;
      }
    }
    save();
    closeModal(overlay);
    renderAll();
  }

  document.getElementById("saveAdd").addEventListener("click", submitTaskForm);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTaskForm();
    if (e.key === "Escape") closeModal(overlay);
  });

  // --- Bulk task actions ---
  document.getElementById("bulkDeleteBtn").addEventListener("click", () => {
    if (!selectedTaskIds.size) return;
    const n = selectedTaskIds.size;
    showConfirm({
      title: "Delete tasks",
      message: `Delete ${n} selected task${n > 1 ? "s" : ""}?`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        tasks = tasks.filter(t => !selectedTaskIds.has(t.id));
        save();
        setSelectMode(false);
        renderAll();
      }
    });
  });

  document.getElementById("bulkDuplicateBtn").addEventListener("click", () => {
    if (!selectedTaskIds.size) return;
    const toDuplicate = tasks.filter(t => selectedTaskIds.has(t.id));
    toDuplicate.forEach(t => {
      const dateTasks = tasks.filter(x => x.date === t.date);
      const maxOrder = dateTasks.length ? Math.max(...dateTasks.map(x => x.order ?? 0)) : -1;
      tasks.push({
        ...t,
        id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
        order: maxOrder + 1,
        done: false,
        completedDates: []
      });
    });
    const n = toDuplicate.length;
    save();
    setSelectMode(false);
    renderAll();
    showToast(`Duplicated ${n} task${n > 1 ? "s" : ""}`, "success");
  });

  // Move/Category/Duration each open the same modal shell, but scoped to
  // just the one field that was clicked — only that field is shown, and
  // Save only ever writes that single field to the selected tasks.
  const bulkEditOverlay = document.getElementById("bulkEditModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(bulkEditOverlay);
  const bulkEditTitle = document.getElementById("bulkEditModalTitle");
  const BULK_EDIT_FIELDS = {
    date: { input: "bulkEditDateInput", clear: "bulkEditDateClear", group: "bulkFieldGroupDate", label: "Date" },
    category: { input: "bulkEditCategorySelect", clear: "bulkEditCategoryClear", group: "bulkFieldGroupCategory", label: "Category" },
    duration: { input: "bulkEditDurationInput", clear: "bulkEditDurationClear", group: "bulkFieldGroupDuration", label: "Duration" }
  };
  let activeBulkEditField = null;

  function bulkEditFieldRow(key) {
    return document.getElementById(BULK_EDIT_FIELDS[key].input).closest(".bulk-field-row");
  }

  function updateBulkEditFieldState(key) {
    const input = document.getElementById(BULK_EDIT_FIELDS[key].input);
    const clearBtn = document.getElementById(BULK_EDIT_FIELDS[key].clear);
    const changed = input.value.trim() !== "";
    bulkEditFieldRow(key).classList.toggle("changed", changed);
    clearBtn.style.display = changed ? "flex" : "none";
  }

  function resetBulkEditField(key) {
    document.getElementById(BULK_EDIT_FIELDS[key].input).value = "";
    updateBulkEditFieldState(key);
  }

  Object.keys(BULK_EDIT_FIELDS).forEach(key => {
    const { input, clear } = BULK_EDIT_FIELDS[key];
    document.getElementById(input).addEventListener("input", () => updateBulkEditFieldState(key));
    document.getElementById(clear).addEventListener("click", () => resetBulkEditField(key));
  });

  function populateBulkEditCategorySelect() {
    const sel = document.getElementById("bulkEditCategorySelect");
    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No change";
    sel.appendChild(placeholder);
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }

  const BULK_EDIT_FOCUS_MAP = { date: "bulkEditDateInput", category: "bulkEditCategorySelect", duration: "bulkEditDurationInput" };

  function openBulkEditModal(focusField) {
    if (!selectedTaskIds.size) return;
    activeBulkEditField = focusField;
    populateBulkEditCategorySelect();
    Object.keys(BULK_EDIT_FIELDS).forEach(key => {
      resetBulkEditField(key);
      document.getElementById(BULK_EDIT_FIELDS[key].group).style.display = key === focusField ? "" : "none";
    });
    bulkEditTitle.textContent = `Edit ${BULK_EDIT_FIELDS[focusField].label}`;
    openModal(bulkEditOverlay);
    const focusId = BULK_EDIT_FOCUS_MAP[focusField];
    if (focusId) {
      setTimeout(() => {
        const el = document.getElementById(focusId);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus();
      }, 50);
    }
  }

  document.getElementById("bulkMoveBtn").addEventListener("click", () => openBulkEditModal("date"));
  document.getElementById("bulkCategoryBtn").addEventListener("click", () => openBulkEditModal("category"));
  document.getElementById("bulkDurationBtn").addEventListener("click", () => openBulkEditModal("duration"));

  function closeBulkEditModal() {
    closeModal(bulkEditOverlay);
  }

  document.getElementById("bulkEditCancel").addEventListener("click", closeBulkEditModal);
  bulkEditOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBulkEditModal(); });

  document.getElementById("bulkEditSave").addEventListener("click", () => {
    const field = activeBulkEditField;
    if (field && bulkEditFieldRow(field).classList.contains("changed")) {
      const val = document.getElementById(BULK_EDIT_FIELDS[field].input).value;
      tasks.forEach(t => {
        if (!selectedTaskIds.has(t.id)) return;
        t[field] = val;
      });
      save();
      renderAll();
    }
    closeBulkEditModal();
  });

  const catOverlay = document.getElementById("catModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(catOverlay);

  function buildColorSwatches(wrap, currentColor, onSelect) {
    wrap.innerHTML = "";
    PALETTE.forEach(color => {
      const sw = document.createElement("div");
      sw.className = "swatch" + (color === currentColor ? " selected" : "");
      sw.style.background = color;
      sw.addEventListener("click", () => {
        wrap.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
        sw.classList.add("selected");
        onSelect(color);
      });
      wrap.appendChild(sw);
    });
  }

  // Lets normal vertical wheel/trackpad input scroll the horizontally-
  // scrolling swatch row, instead of requiring a manual horizontal drag.
  // Attached once to the static row elements (buildColorSwatches only
  // rebuilds their contents), and left alone for touch so native swipe
  // still works untouched.
  document.querySelectorAll(".color-swatches").forEach(wrap => {
    wrap.addEventListener("wheel", (e) => {
      if (e.deltaY === 0) return;
      wrap.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  });

  function openCategoryModal() {
    document.getElementById("catName").value = "";
    selectedColor = PALETTE[0];
    buildColorSwatches(document.getElementById("colorSwatches"), selectedColor, (color) => { selectedColor = color; });
    openModal(catOverlay);
    setTimeout(() => document.getElementById("catName").focus(), 50);
  }

  document.getElementById("catCancel").addEventListener("click", () => closeModal(catOverlay));
  document.getElementById("todayBtn").addEventListener("click", goToToday);
  document.getElementById("catSave").addEventListener("click", () => {
    const name = document.getElementById("catName").value.trim();
    if (!name || categories.some(c => c.name === name)) { closeModal(catOverlay); return; }
    categories.push({ name, color: selectedColor });
    save();
    closeModal(catOverlay);
    renderCategoryTabs();
  });
  catOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal(catOverlay);
  });

  let editingCategoryName = null;
  let editingCategoryColor = null;
  const editCatOverlay = document.getElementById("editCatModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(editCatOverlay);

  function openEditCategoryModal(catName) {
    const cat = categories.find(c => c.name === catName);
    if (!cat) return;
    editingCategoryName = cat.name;
    editingCategoryColor = cat.color;
    document.getElementById("editCatName").value = cat.name;
    buildColorSwatches(document.getElementById("editColorSwatches"), editingCategoryColor, (color) => { editingCategoryColor = color; });
    openModal(editCatOverlay);
  }

  document.getElementById("editCatCancel").addEventListener("click", () => closeModal(editCatOverlay));

  document.getElementById("editCatSave").addEventListener("click", () => {
    const newName = document.getElementById("editCatName").value.trim();
    if (!newName) return;
    const cat = categories.find(c => c.name === editingCategoryName);
    const oldName = cat.name;
    cat.name = newName;
    cat.color = editingCategoryColor;
    tasks.forEach(t => { if (t.category === oldName) t.category = newName; });
    if (activeCategory === oldName) activeCategory = newName;
    save();
    closeModal(editCatOverlay);
    renderAll();
  });

  document.getElementById("editCatDelete").addEventListener("click", () => {
    closeModalInstant(editCatOverlay);
    showConfirm({
      title: "Delete category",
      message: `Delete "${editingCategoryName}"? Tasks in this category will keep the category name but it won't be selectable anymore.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        categories = categories.filter(c => c.name !== editingCategoryName);
        if (activeCategory === editingCategoryName) activeCategory = "All";
        save();
        renderAll();
      }
    });
  });

  // --- Premium accent themes ---
  // localSelectedTheme is always the source of truth for reads (kept fresh
  // by saveSelectedTheme() below and, for signed-in users, by
  // hydrateFromFirestore() when a Firestore snapshot arrives) — it does NOT
  // branch live to window.firestoreBridge.getSelectedTheme() on every read.
  // That used to be the case, and it caused a real bug: Firestore writes
  // are inherently async (they only land once onSnapshot echoes them back),
  // so applySelectedTheme() — called synchronously right after
  // saveSelectedTheme() in the same click handler — would still read the
  // *previous* theme, leaving --accent-bg (and the row's background color)
  // one click behind the checkmark, which updates via a plain classList
  // change and was never affected. Updating this cache optimistically,
  // synchronously, on save fixes that.
  let localSelectedTheme = localStorage.getItem("selectedTheme") || null;

  function getSelectedTheme() {
    return localSelectedTheme;
  }

  function saveSelectedTheme(theme) {
    localSelectedTheme = theme;
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      window.firestoreBridge.saveSelectedTheme(theme);
      return;
    }
    localStorage.setItem("selectedTheme", theme);
  }

  function applySelectedTheme() {
    const stored = getSelectedTheme();
    const themeName = (stored && THEMES[stored]) ? stored : null;
    if (themeName && themeName !== "forest") {
      document.documentElement.setAttribute("data-selected-theme", themeName);
    } else {
      document.documentElement.removeAttribute("data-selected-theme");
    }
  }

  function updateThemesBtnVisibility() {
    document.getElementById("themesBtn").style.display = "flex";
  }

  const themesOverlay = document.getElementById("themesModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(themesOverlay);

  function renderThemeOptions() {
    const wrap = document.getElementById("themeOptionList");
    wrap.innerHTML = "";
    const current = getSelectedTheme() || "forest";
    Object.keys(THEMES).forEach(key => {
      const theme = THEMES[key];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ob-row pressable" + (key === current ? " selected" : "");
      const swatch = document.createElement("span");
      swatch.className = "ob-row-swatch";
      swatch.style.background = theme.light.accent;
      const label = document.createElement("span");
      label.className = "ob-row-name";
      label.textContent = theme.label;
      const check = document.createElement("span");
      check.className = "ob-row-check";
      row.appendChild(swatch);
      row.appendChild(label);
      row.appendChild(check);
      row.addEventListener("click", () => {
        triggerHaptic("light");
        wrap.querySelectorAll(".ob-row.selected").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
        saveSelectedTheme(key);
        applySelectedTheme();
        swatch.style.transform = "scale(1.15)";
        setTimeout(() => {
          swatch.style.transform = "scale(1)";
        }, 200);
      });
      wrap.appendChild(row);
    });
  }

  document.getElementById("themesBtn").addEventListener("click", () => {
    renderThemeOptions();
    openModal(themesOverlay);
  });
  document.getElementById("themesCloseBtn").addEventListener("click", () => closeModal(themesOverlay));
  themesOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(themesOverlay); });

  // --- Premium data export ---
  function updateExportBtnVisibility() {
    document.getElementById("exportDataBtn").style.display = isPremiumUser() ? "flex" : "none";
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    const str = String(value == null ? "" : value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function exportDataAsJson() {
    // Reads the cached variables (correct for both signed-in and
    // signed-out — the cache reflects whichever is the live source) rather
    // than localStorage directly, since localStorage isn't kept in sync
    // for signed-in users.
    const data = {
      tasks,
      categories,
      reflections,
      lockedDays
    };
    downloadFile(`planner-export-${toDateStr(new Date())}.json`, JSON.stringify(data, null, 2), "application/json");
    showToast("Exported. Check your downloads.", "success");
  }

  function exportDataAsCsv() {
    const dateStr = toDateStr(new Date());

    const storedTasks = tasks;
    const taskHeader = ["name", "category", "date", "time", "duration", "done", "isGoal", "why", "plan"];
    const taskLines = [taskHeader.join(",")];
    storedTasks.forEach(t => {
      const isRecurring = t.recurrence && t.recurrence.type !== "none";
      const doneSummary = isRecurring ? (t.completedDates || []).join(";") : (t.done ? "true" : "false");
      taskLines.push([
        csvEscape(t.name), csvEscape(t.category), csvEscape(t.date), csvEscape(t.time), csvEscape(t.duration),
        csvEscape(doneSummary), csvEscape(t.isGoal ? "true" : "false"), csvEscape(t.why), csvEscape(t.plan)
      ].join(","));
    });
    downloadFile(`planner-export-tasks-${dateStr}.csv`, taskLines.join("\n"), "text/csv");

    const storedReflections = reflections;
    const reflHeader = ["date", "wentWell", "improve"];
    const reflLines = [reflHeader.join(",")];
    Object.keys(storedReflections).sort().forEach(date => {
      const entry = storedReflections[date] || {};
      reflLines.push([csvEscape(date), csvEscape(entry.wentWell), csvEscape(entry.improve)].join(","));
    });
    downloadFile(`planner-export-reflections-${dateStr}.csv`, reflLines.join("\n"), "text/csv");
    showToast("Exported. Check your downloads.", "success");
  }

  const exportOverlay = document.getElementById("exportModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(exportOverlay);
  document.getElementById("exportDataBtn").addEventListener("click", () => {
    if (!isPremiumUser()) return;
    openModal(exportOverlay);
  });
  document.getElementById("exportJsonBtn").addEventListener("click", exportDataAsJson);
  document.getElementById("exportCsvBtn").addEventListener("click", exportDataAsCsv);
  document.getElementById("exportCloseBtn").addEventListener("click", () => closeModal(exportOverlay));
  exportOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(exportOverlay); });

  applySelectedTheme();
  updateThemesBtnVisibility();
  updateExportBtnVisibility();
  updateSearchReflectionsBtnVisibility();

  const micBtn = document.getElementById("micBtn");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.style.display = "none";
  } else {
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    let listening = false;

    micBtn.addEventListener("click", () => {
      if (listening) { recognition.stop(); return; }
      recognition.start();
    });
    recognition.addEventListener("start", () => { listening = true; micBtn.classList.add("listening"); });
    recognition.addEventListener("end", () => { listening = false; micBtn.classList.remove("listening"); });
    recognition.addEventListener("result", (e) => {
      const transcript = e.results[0][0].transcript;
      parseAndFillModal(transcript);
    });
  }

  function parseAndFillModal(text) {
    let working = " " + text.toLowerCase() + " ";
    let parsedDate = toDateStr(currentDate);
    let parsedTime = "";
    let parsedCategory = "";
    let parsedDuration = "";

    if (working.includes("tomorrow")) {
      const d = new Date(currentDate); d.setDate(d.getDate() + 1);
      parsedDate = toDateStr(d);
      working = working.replace("tomorrow", " ");
    } else if (working.includes("today")) {
      working = working.replace("today", " ");
    } else {
      const inXDays = working.match(/in (\d+) days?/);
      if (inXDays) {
        const d = new Date(currentDate); d.setDate(d.getDate() + parseInt(inXDays[1]));
        parsedDate = toDateStr(d);
        working = working.replace(inXDays[0], " ");
      }
    }

    const timeMatch = working.match(/(\d{1,2}):(\d{2})|(\d{1,2})\s?(am|pm)/);
    if (timeMatch) {
      if (timeMatch[1]) {
        parsedTime = timeMatch[1].padStart(2, "0") + ":" + timeMatch[2];
      } else {
        let h = parseInt(timeMatch[3]);
        if (timeMatch[4] === "pm" && h !== 12) h += 12;
        if (timeMatch[4] === "am" && h === 12) h = 0;
        parsedTime = String(h).padStart(2, "0") + ":00";
      }
      working = working.replace(timeMatch[0], " ");
    }

    const durMatch = working.match(/(\d+(\.\d+)?)\s?(hours?|hrs?|minutes?|mins?)/);
    if (durMatch) {
      const num = parseFloat(durMatch[1]);
      const unit = durMatch[3];
      parsedDuration = unit.startsWith("h") ? Math.round(num * 60) : Math.round(num);
      working = working.replace(durMatch[0], " ");
    }

    const WEEKDAY_NAMES = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    let parsedRepeatType = "none";
    let parsedWeekdays = [];
    let parsedInterval = 1;

    if (/every day|daily/.test(working)) {
      parsedRepeatType = "daily";
      working = working.replace(/every day|daily/, " ");
    } else if (working.includes("every")) {
      const intervalMatch = working.match(/every\s+(\d+)\s+weeks?/);
      if (intervalMatch) {
        parsedInterval = parseInt(intervalMatch[1]);
        working = working.replace(intervalMatch[0], " every ");
      }
      Object.keys(WEEKDAY_NAMES).forEach(dayName => {
        if (working.includes(dayName)) {
          parsedWeekdays.push(WEEKDAY_NAMES[dayName]);
          working = working.replace(new RegExp(dayName, "g"), " ");
        }
      });
      if (parsedWeekdays.length > 0) {
        parsedRepeatType = "weekly";
        working = working.replace(/\bevery\b/g, " ");
      }
    }

    const catMatch = working.match(/categor(y|ie)\s+(\w+)/);
    if (catMatch) {
      const spoken = catMatch[2];
      const found = categories.find(c => c.name.toLowerCase() === spoken);
      if (found) parsedCategory = found.name;
      working = working.replace(catMatch[0], " ");
    }

    const taskName = working
      .replace(/,/g, " ")
      .replace(/\./g, " ")
      .replace(/\bduration\b/gi, " ")
      .replace(/\bam\b|\bpm\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    editingTaskId = null;
    document.getElementById("modalTitle").textContent = "Add Task (from voice)";
    document.getElementById("modalName").value = taskName.charAt(0).toUpperCase() + taskName.slice(1);
    document.getElementById("modalTime").value = parsedTime;
    document.getElementById("modalDate").value = parsedDate;
    document.getElementById("modalDuration").value = parsedDuration;
    document.getElementById("modalEndDate").value = "";
    document.getElementById("modalIsGoal").checked = false;
    document.getElementById("modalGoalFields").classList.remove("show");
    document.getElementById("modalGoalWhy").value = "";
    document.getElementById("modalGoalPlan").value = "";
    repeatSelect.value = parsedRepeatType;
    if (parsedRepeatType !== "none") {
      repeatExtra.classList.add("show");
      selectedWeekdays = parsedWeekdays;
      document.getElementById("modalInterval").value = parsedInterval;
    } else {
      repeatExtra.classList.remove("show");
      selectedWeekdays = [];
    }
    buildWeekdayPicker();
    if (parsedCategory) document.getElementById("modalCategory").value = parsedCategory;
    openModal(overlay);
  }

 // --- Dedicated Add Goal flow ---
 let goalSelectedWeekdays = [];
  let editingGoalId = null;
  const goalOverlay = document.getElementById("goalModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(goalOverlay);
  const goalWeekdayPicker = document.getElementById("goalWeekdayPicker");

  function buildGoalWeekdayPicker() {
    goalWeekdayPicker.innerHTML = "";
    WEEKDAY_LABELS.forEach((label, i) => {
      const btn = document.createElement("div");
      btn.className = "weekday-btn" + (goalSelectedWeekdays.includes(i) ? " selected" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        const idx = goalSelectedWeekdays.indexOf(i);
        if (idx === -1) goalSelectedWeekdays.push(i); else goalSelectedWeekdays.splice(idx, 1);
        buildGoalWeekdayPicker();
      });
      goalWeekdayPicker.appendChild(btn);
    });
  }

  document.getElementById("openAddGoal").addEventListener("click", () => {
    if (categories.length === 0) { showToast("Add a category first from the Planner tab.", "warning"); return; }

    editingGoalId = null;
    document.getElementById("goalName").value = "";
    document.getElementById("goalStartDate").value = toDateStr(new Date());
    document.getElementById("goalLength").value = "";
    document.getElementById("goalTime").value = "";
    goalSelectedWeekdays = [0,1,2,3,4,5,6];
    buildGoalWeekdayPicker();
    document.getElementById("goalFormError").classList.remove("show");

    const sel = document.getElementById("goalCategory");
    sel.innerHTML = "";
    categories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.name;
      opt.textContent = cat.name;
      sel.appendChild(opt);
    });

    openModal(goalOverlay);
    setTimeout(() => document.getElementById("goalName").focus(), 50);
  });
  enableFabPressSpring(document.getElementById("openAddGoal"));

  document.getElementById("goalCancel").addEventListener("click", () => closeModal(goalOverlay));

  document.getElementById("goalSave").addEventListener("click", () => {
    const name = document.getElementById("goalName").value.trim();
    const category = document.getElementById("goalCategory").value;
    const startDate = document.getElementById("goalStartDate").value;
    const length = parseInt(document.getElementById("goalLength").value);
    const time = document.getElementById("goalTime").value;

    if (!name || !category || !startDate || !length || goalSelectedWeekdays.length === 0) {
      const err = document.getElementById("goalFormError");
      err.textContent = "Please fill in the goal name, length, and at least one day of the week.";
      err.classList.add("show");
      return;
    }
    document.getElementById("goalFormError").classList.remove("show");

    const endD = new Date(startDate + "T00:00:00");
    endD.setDate(endD.getDate() + length - 1);
    const endDate = toDateStr(endD);

    const recurrence = goalSelectedWeekdays.length === 7
      ? { type: "daily" }
      : { type: "weekly", days: [...goalSelectedWeekdays].sort(), interval: 1 };

      const checkoffLabel = document.getElementById("goalCheckoff").value.trim() || name;
    const why = document.getElementById("goalWhy").value.trim();
    const plan = document.getElementById("goalPlan").value.trim();

    if (editingGoalId) {
      const g = tasks.find(t => t.id === editingGoalId);
      g.name = name; g.category = category; g.time = time;
      g.checkoffLabel = checkoffLabel; g.why = why; g.plan = plan;
      g.date = startDate; g.endDate = endDate; g.recurrence = recurrence;
      editingGoalId = null;
    } else {
      tasks.push({
        id: Date.now().toString(), name, category, time, duration: "",
        date: startDate, endDate, done: false, order: 0,
        recurrence, completedDates: [], isGoal: true,
        checkoffLabel, why, plan
      });
    }

    save();
    closeModal(goalOverlay);
    renderGoals();
  });

  goalOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("goalSave").click();
    if (e.key === "Escape") closeModal(goalOverlay);
  });
  goalOverlay.addEventListener("input", () => {
    document.getElementById("goalFormError").classList.remove("show");
  });
  const goalViewOverlay = document.getElementById("goalViewModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(goalViewOverlay);

function openGoalViewModal(goalId) {
  const g = tasks.find(t => t.id === goalId);
  if (!g) return;
  document.getElementById("goalViewName").textContent = g.name;
  document.getElementById("goalViewCheckoff").textContent = "Daily check-off: " + (g.checkoffLabel || g.name);
  const freezesAvailable = applyStreakFreezes(g).freezesAvailable;
  const freezesEl = document.getElementById("goalViewFreezes");
  freezesEl.style.display = freezesAvailable > 0 ? "block" : "none";
  freezesEl.textContent = freezesAvailable > 0 ? `❄ ${freezesAvailable} streak freeze${freezesAvailable === 1 ? "" : "s"} banked` : "";
  document.getElementById("goalViewWhy").textContent = g.why || "None";
  document.getElementById("goalViewPlan").textContent = g.plan || "None";
  editingGoalId = goalId;
  openModal(goalViewOverlay);
}

document.getElementById("goalViewClose").addEventListener("click", () => {
  closeModal(goalViewOverlay);
});

document.getElementById("goalViewDelete").addEventListener("click", () => {
  closeModalInstant(goalViewOverlay);
  showConfirm({
    title: "Delete goal",
    message: "Delete this goal entirely?",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => {
      tasks = tasks.filter(t => t.id !== editingGoalId);
      save();
      renderGoals();
    }
  });
});

document.getElementById("goalViewEdit").addEventListener("click", () => {
  const g = tasks.find(t => t.id === editingGoalId);
  closeModal(goalViewOverlay);

  document.getElementById("goalName").value = g.name;
  document.getElementById("goalStartDate").value = g.date;
  const length = Math.round((new Date(g.endDate) - new Date(g.date)) / 86400000) + 1;
  document.getElementById("goalLength").value = length;
  document.getElementById("goalTime").value = g.time || "";
  document.getElementById("goalCheckoff").value = g.checkoffLabel || "";
  document.getElementById("goalWhy").value = g.why || "";
  document.getElementById("goalPlan").value = g.plan || "";

  goalSelectedWeekdays = g.recurrence.type === "daily" ? [0,1,2,3,4,5,6] : [...g.recurrence.days];
  buildGoalWeekdayPicker();

  const sel = document.getElementById("goalCategory");
  sel.innerHTML = "";
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    sel.appendChild(opt);
  });
  sel.value = g.category;

  document.getElementById("goalFormError").classList.remove("show");
  openModal(goalOverlay);
});
let currentRange = "week";

  // --- Weekly recap (premium) ---
  function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }

  // Stats for the 7-day period ending on endDate (defaults to today), so the
  // Analysis card can show a rolling "this week" while the rollover banner
  // can pass yesterday to summarize the most recently completed week.
  function computeWeeklyRecap(endDate) {
    const end = endDate || new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const startStr = toDateStr(start);
    const endStr = toDateStr(end);

    let tasksCompleted = 0;
    tasks.forEach(t => {
      const isRecurring = t.recurrence && t.recurrence.type !== "none";
      if (isRecurring) {
        (t.completedDates || []).forEach(ds => { if (ds >= startStr && ds <= endStr) tasksCompleted++; });
      } else if (t.done && t.date >= startStr && t.date <= endStr) {
        tasksCompleted++;
      }
    });

    const deepWorkSessions = getDeepWorkSessions()
      .filter(s => s.date >= startStr && s.date <= endStr).length;

    const reflectionsWritten = Object.keys(reflections)
      .filter(d => d >= startStr && d <= endStr).length;

    const goalTasks = tasks.filter(t => t.isGoal);
    let currentStreak = 0;
    goalTasks.forEach(g => {
      const s = computeStreak(g);
      if (s > currentStreak) currentStreak = s;
    });

    return { weekStart: startStr, weekEnd: endStr, tasksCompleted, deepWorkSessions, reflectionsWritten, currentStreak };
  }

  function recapSummaryText(recap) {
    return `${recap.tasksCompleted} task${recap.tasksCompleted === 1 ? "" : "s"} done · `
      + `${recap.deepWorkSessions} Deep Work session${recap.deepWorkSessions === 1 ? "" : "s"} · `
      + `${recap.reflectionsWritten} reflection${recap.reflectionsWritten === 1 ? "" : "s"} written`;
  }

  function renderWeeklyRecapCard() {
    const card = document.getElementById("weeklyRecapCard");
    if (!card) return;
    if (!isPremiumUser()) { card.style.display = "none"; return; }
    const recap = computeWeeklyRecap();
    card.style.display = "block";
    card.innerHTML = `
      <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:0.4rem;">This week</div>
      <div style="font-size:var(--text-base);color:var(--text-primary);">${recapSummaryText(recap)}</div>
    `;
  }

  function maybeShowWeeklyRecapBanner() {
    if (!isPremiumUser()) return;
    const currentWeekKey = getISOWeekKey(new Date());
    if (localStorage.getItem("lastRecapShownWeek") === currentWeekKey) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recap = computeWeeklyRecap(yesterday);
    const hasData = recap.tasksCompleted > 0 || recap.deepWorkSessions > 0 || recap.reflectionsWritten > 0;
    if (!hasData) return;

    showWeeklyRecapBannerWhenClear(recap, currentWeekKey, 60);
  }

  // The banner should never show while a modal is open — it used to have a
  // higher z-index than modals, so it could visually stack on top of one,
  // and dismissing it while a modal's own close transition was also active
  // made the animation stutter (two competing transitions). Waits for any
  // open modal to close (checked every 500ms, capped at ~30s) rather than
  // showing over it or silently giving up right away.
  function showWeeklyRecapBannerWhenClear(recap, currentWeekKey, attemptsLeft) {
    if (document.querySelector(".modal-overlay.open")) {
      if (attemptsLeft <= 0) return;
      setTimeout(() => showWeeklyRecapBannerWhenClear(recap, currentWeekKey, attemptsLeft - 1), 500);
      return;
    }

    const banner = document.getElementById("weeklyRecapBanner");
    if (!banner) return;
    const stat = (value, label) => `
      <div>
        <div style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);">${value}</div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);">${label}</div>
      </div>`;
    banner.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.85rem;">
        <div style="font-size:var(--text-sm);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);">Last week's recap</div>
        <button id="weeklyRecapBannerClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0.25rem;flex-shrink:0;"><i data-lucide="x" class="icon"></i></button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;">
        ${stat(recap.tasksCompleted, "Tasks done")}
        ${stat(recap.deepWorkSessions, "Deep Work sessions")}
        ${stat(recap.reflectionsWritten, "Reflections")}
        ${stat(recap.currentStreak, "Day streak")}
      </div>
    `;
    lucide.createIcons();

    function dismiss() {
      banner.classList.remove("visible");
      localStorage.setItem("lastRecapShownWeek", currentWeekKey);
    }
    banner.onclick = dismiss;

    banner.classList.remove("visible");
    void banner.offsetWidth;
    banner.classList.add("visible");
  }

  function hasAnyCompletionHistory() {
    return tasks.some(t => (t.completedDates && t.completedDates.length > 0) || t.done);
  }

  function renderAnalysis() {
    syncAllStreakFreezes();
    const hasHistory = hasAnyCompletionHistory();
    document.getElementById("analysisEmptyState").style.display = hasHistory ? "none" : "block";
    document.getElementById("analysisContent").style.display = hasHistory ? "block" : "none";
    lucide.createIcons();
    if (!hasHistory) return;

    renderRingChart();

    // Bar chart, momentum, focus score, and smart insights are premium —
    // free users get none of the four, replaced by a single combined
    // locked-state card rather than four separate teasers. Ring chart
    // above stays fully free/functional regardless. monthComparisonBox
    // and weeklyRecapCard are separate, pre-existing premium gates
    // (each hides/shows itself already) and are untouched here.
    const premiumAnalysis = isPremiumUser();
    document.getElementById("analysisLockedCard").style.display = premiumAnalysis ? "none" : "block";
    document.getElementById("insightsCard").style.display = premiumAnalysis ? "" : "none";
    document.getElementById("momentumBox").style.display = premiumAnalysis ? "" : "none";
    document.getElementById("focusScoreBox").style.display = premiumAnalysis ? "" : "none";
    document.querySelector(".range-tabs").style.display = premiumAnalysis ? "" : "none";
    document.getElementById("barChart").style.display = premiumAnalysis ? "" : "none";
    document.getElementById("bestWorst").style.display = premiumAnalysis ? "" : "none";
    if (premiumAnalysis) {
      renderBarChart(currentRange);
      renderMomentum();
      renderFocusScore();
      renderInsights();
    }

    renderMonthComparison();
    renderWeeklyRecapCard();
  }

  // --- Smart Insights ---
  function weeklyTrendInsight() {
    const thisWeek = avgPctForRange(6, 0);
    const lastWeek = avgPctForRange(13, 7);
    if (thisWeek === null || lastWeek === null) return null;
    const diff = Math.round(thisWeek - lastWeek);
    if (Math.abs(diff) <= 3) return { icon: "minus", text: "You're steady with last week" };
    if (diff > 0) return { icon: "trending-up", text: `This week is up ${diff}% compared to last week` };
    return { icon: "trending-down", text: `This week is down ${Math.abs(diff)}% compared to last week` };
  }

  function weakestCategoryInsight() {
    const today = toDateStr(new Date());
    const stats = {};
    categories.forEach(cat => { stats[cat.name] = { scheduled: 0, completed: 0 }; });

    tasks.forEach(t => {
      if (!stats[t.category]) return;
      if (!t.recurrence || t.recurrence.type === "none") {
        if (t.date <= today) {
          stats[t.category].scheduled++;
          if (t.done) stats[t.category].completed++;
        }
      } else {
        const start = new Date(t.date + "T00:00:00");
        const end = new Date((t.endDate || today) + "T00:00:00");
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = toDateStr(d);
          if (ds > today) break;
          if (occursOn(t, d)) {
            stats[t.category].scheduled++;
            if ((t.completedDates || []).includes(ds)) stats[t.category].completed++;
          }
        }
      }
    });

    let weakest = null;
    let eligibleCount = 0;
    Object.keys(stats).forEach(catName => {
      const s = stats[catName];
      if (s.scheduled >= 5) {
        eligibleCount++;
        const rate = s.completed / s.scheduled;
        if (!weakest || rate < weakest.rate) weakest = { catName, rate };
      }
    });

    if (eligibleCount < 2 || !weakest) return null;
    const pct = Math.round(weakest.rate * 100);
    return { icon: "trending-down", text: `${weakest.catName} tasks get completed least often, at ${pct}%` };
  }

  function computeLongestStreakEver(task) {
    const today = toDateStr(new Date());
    const start = new Date(task.date + "T00:00:00");
    const end = new Date((task.endDate || today) + "T00:00:00");
    let scheduledDays = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (occursOn(task, d)) scheduledDays.push(toDateStr(d));
    }
    let longest = 0, current = 0;
    scheduledDays.forEach(ds => {
      if ((task.completedDates || []).includes(ds)) {
        current++;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    });
    return longest;
  }

  function longestStreakEverInsight() {
    const goalTasks = tasks.filter(t => t.isGoal);
    let best = null;
    goalTasks.forEach(g => {
      const streak = computeLongestStreakEver(g);
      if (!best || streak > best.streak) best = { streak, name: g.name };
    });
    if (!best || best.streak < 3) return null;
    return { icon: "trophy", text: `Your longest streak ever was ${best.streak} days, on ${best.name}` };
  }

  function reflectionStreakInsight() {
    const today = toDateStr(new Date());
    const anchorDate = lockedDays.includes(today) ? today : (lockedDays.length ? lockedDays.slice().sort().reverse()[0] : null);
    if (!anchorDate) return null;

    let streak = 0;
    let d = new Date(anchorDate + "T00:00:00");
    while (true) {
      const ds = toDateStr(d);
      const entry = reflections[ds];
      if (entry && (entry.wentWell || entry.improve)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    if (streak < 2) return null;
    return { icon: "flame", text: `You've reflected ${streak} days in a row` };
  }

  function resurfacedReflectionInsight() {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const entry = reflections[toDateStr(d)];
    if (!entry || !entry.wentWell) return null;
    let text = entry.wentWell;
    if (text.length > 100) text = text.slice(0, 100) + "…";
    return { icon: "book-open", text: `A week ago you wrote: '${text}'` };
  }

  function timeOfDaySplitInsight() {
    const today = toDateStr(new Date());
    let beforeTotal = 0, beforeDone = 0, afterTotal = 0, afterDone = 0;

    tasks.forEach(t => {
      if (!t.time) return;
      const isBefore = t.time < "12:00";

      if (!t.recurrence || t.recurrence.type === "none") {
        if (t.date <= today) {
          if (isBefore) { beforeTotal++; if (t.done) beforeDone++; }
          else { afterTotal++; if (t.done) afterDone++; }
        }
      } else {
        const start = new Date(t.date + "T00:00:00");
        const end = new Date((t.endDate || today) + "T00:00:00");
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = toDateStr(d);
          if (ds > today) break;
          if (occursOn(t, d)) {
            const done = (t.completedDates || []).includes(ds);
            if (isBefore) { beforeTotal++; if (done) beforeDone++; }
            else { afterTotal++; if (done) afterDone++; }
          }
        }
      }
    });

    if (beforeTotal < 5 || afterTotal < 5) return null;

    const beforeRate = Math.round((beforeDone / beforeTotal) * 100);
    const afterRate = Math.round((afterDone / afterTotal) * 100);
    const diff = beforeRate - afterRate;
    if (Math.abs(diff) < 5) return null;

    if (diff > 0) {
      return { icon: "sunrise", text: `You complete tasks scheduled before noon ${diff} percentage points more often than ones after noon` };
    }
    return { icon: "sunset", text: `You complete tasks scheduled after noon ${Math.abs(diff)} percentage points more often than ones before noon` };
  }

  function bestWeekdayInsight() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let earliest = today;
    tasks.forEach(t => {
      const d = new Date(t.date + "T00:00:00");
      if (d < earliest) earliest = d;
    });
    const daysBack = Math.min(Math.round((today - earliest) / 86400000), 365);

    const weekdaySums = [0, 0, 0, 0, 0, 0, 0];
    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i <= daysBack; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const p = dayPct(d);
      if (p !== null) {
        const wd = d.getDay();
        weekdaySums[wd] += p;
        weekdayCounts[wd]++;
      }
    }

    const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let best = null;
    let eligibleCount = 0;
    for (let wd = 0; wd < 7; wd++) {
      if (weekdayCounts[wd] >= 3) {
        eligibleCount++;
        const avg = weekdaySums[wd] / weekdayCounts[wd];
        if (!best || avg > best.avg) best = { wd, avg };
      }
    }
    if (eligibleCount < 2 || !best) return null;
    return { icon: "star", text: `Your best day of the week is ${WEEKDAY_NAMES_FULL[best.wd]}, averaging ${Math.round(best.avg)}%` };
  }

  function weekendCategorySkewInsight() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let earliest = today;
    tasks.forEach(t => {
      const d = new Date(t.date + "T00:00:00");
      if (d < earliest) earliest = d;
    });
    const daysBack = Math.min(Math.round((today - earliest) / 86400000), 365);

    let elapsedWeekendDays = 0, elapsedWeekdays = 0;
    for (let i = 0; i <= daysBack; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) elapsedWeekendDays++; else elapsedWeekdays++;
    }
    if (elapsedWeekendDays === 0 || elapsedWeekdays === 0) return null;

    const todayStr = toDateStr(today);
    const stats = {};
    categories.forEach(cat => { stats[cat.name] = { weekendCompleted: 0, weekdayCompleted: 0, totalCompleted: 0 }; });

    tasks.forEach(t => {
      if (!stats[t.category]) return;
      if (!t.recurrence || t.recurrence.type === "none") {
        if (t.date <= todayStr && t.done) {
          const wd = new Date(t.date + "T00:00:00").getDay();
          if (wd === 0 || wd === 6) stats[t.category].weekendCompleted++; else stats[t.category].weekdayCompleted++;
          stats[t.category].totalCompleted++;
        }
      } else {
        const start = new Date(t.date + "T00:00:00");
        const end = new Date((t.endDate || todayStr) + "T00:00:00");
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = toDateStr(d);
          if (ds > todayStr) break;
          if (occursOn(t, d) && (t.completedDates || []).includes(ds)) {
            const wd = d.getDay();
            if (wd === 0 || wd === 6) stats[t.category].weekendCompleted++; else stats[t.category].weekdayCompleted++;
            stats[t.category].totalCompleted++;
          }
        }
      }
    });

    let best = null;
    Object.keys(stats).forEach(catName => {
      const s = stats[catName];
      if (s.totalCompleted < 6) return;
      const weekendAvg = s.weekendCompleted / elapsedWeekendDays;
      const weekdayAvg = s.weekdayCompleted / elapsedWeekdays;
      let relDiff;
      if (weekdayAvg === 0) {
        if (weekendAvg === 0) return;
        relDiff = Infinity;
      } else {
        relDiff = (weekendAvg - weekdayAvg) / weekdayAvg;
      }
      if (relDiff >= 0.3) {
        if (!best || relDiff > best.relDiff) best = { catName, relDiff };
      }
    });

    if (!best) return null;
    return { icon: "calendar-days", text: `You do more ${best.catName} tasks on weekends than weekdays` };
  }

  function missedCategoryThisWeekInsight() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const missed = {};
    categories.forEach(cat => { missed[cat.name] = 0; });

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const dayTasks = getTasksForDate(d, "All");
      dayTasks.forEach(t => {
        if (missed[t.category] === undefined) return;
        if (!t.occurrenceDone) missed[t.category]++;
      });
    }

    let worst = null;
    Object.keys(missed).forEach(catName => {
      if (!worst || missed[catName] > worst.count) worst = { catName, count: missed[catName] };
    });

    if (!worst || worst.count < 1) return null;
    return { icon: "alert-circle", text: `You've missed ${worst.catName} tasks ${worst.count} time${worst.count === 1 ? "" : "s"} this week` };
  }

  function identityInsight() {
    const identity = getUserIdentity();
    if (!identity) return null;
    const goalTasks = tasks.filter(t => t.isGoal);
    let bestStreak = 0;
    goalTasks.forEach(g => {
      const streak = computeStreak(g);
      if (streak > bestStreak) bestStreak = streak;
    });
    if (bestStreak < 3) return null;
    const identityLower = identity.charAt(0).toLowerCase() + identity.slice(1);
    return { icon: "sparkles", text: `You said you're becoming ${identityLower}. That's showing up as a ${bestStreak}-day streak.` };
  }

  const INSIGHT_GENERATORS = [
    weeklyTrendInsight,
    weakestCategoryInsight,
    longestStreakEverInsight,
    reflectionStreakInsight,
    resurfacedReflectionInsight,
    timeOfDaySplitInsight,
    bestWeekdayInsight,
    weekendCategorySkewInsight,
    missedCategoryThisWeekInsight,
    identityInsight
  ];

  function getActiveInsights() {
    return INSIGHT_GENERATORS.map(fn => fn()).filter(Boolean);
  }

  let currentInsightIndex = 0;
  let activeInsightsCache = [];

  function renderInsightContent() {
    const card = document.getElementById("insightsCard");
    if (activeInsightsCache.length === 0) {
      card.innerHTML = `
        <div style="text-align:center;">
          <i data-lucide="sparkles" class="icon" style="width:28px;height:28px;color:var(--text-muted);display:block;margin:0 auto 0.5rem;"></i>
          <div style="font-size:var(--text-base);color:var(--text-muted);line-height:1.5;">Not enough history yet. Keep going and insights will show up here.</div>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    const insight = activeInsightsCache[currentInsightIndex];
    const multi = activeInsightsCache.length > 1;
    const dots = multi ? activeInsightsCache.map((_, i) => `<span class="insight-dot${i === currentInsightIndex ? " active" : ""}"></span>`).join("") : "";

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.5rem;">
        ${multi ? `<button id="insightPrev" class="insight-nav-btn"><i data-lucide="chevron-left" class="icon"></i></button>` : ""}
        <div id="insightContent" style="flex:1;text-align:center;transition:opacity 150ms ease;">
          <i data-lucide="${insight.icon}" class="icon icon-lg" style="color:var(--accent);display:block;margin:0 auto 0.5rem;"></i>
          <div style="font-size:var(--text-base);color:var(--text-primary);line-height:1.5;">${insight.text}</div>
        </div>
        ${multi ? `<button id="insightNext" class="insight-nav-btn"><i data-lucide="chevron-right" class="icon"></i></button>` : ""}
      </div>
      ${multi ? `<div style="text-align:center;margin-top:0.6rem;">${dots}</div>` : ""}
    `;
    lucide.createIcons();

    if (multi) {
      document.getElementById("insightPrev").addEventListener("click", () => stepInsight(-1));
      document.getElementById("insightNext").addEventListener("click", () => stepInsight(1));
    }
  }

  function stepInsight(dir) {
    const content = document.getElementById("insightContent");
    content.style.opacity = "0";
    setTimeout(() => {
      currentInsightIndex = (currentInsightIndex + dir + activeInsightsCache.length) % activeInsightsCache.length;
      renderInsightContent();
      const newContent = document.getElementById("insightContent");
      newContent.style.opacity = "0";
      requestAnimationFrame(() => { newContent.style.opacity = "1"; });
    }, 150);
  }

  function renderInsights() {
    activeInsightsCache = getActiveInsights();
    currentInsightIndex = 0;
    renderInsightContent();
  }

  function renderFocusScore() {
    const todayTasks = getTasksForDate(new Date(), "All");
    const completionPct = todayTasks.length
      ? (todayTasks.filter(t => t.occurrenceDone).length / todayTasks.length) * 100
      : 0;

    const goalTasks = tasks.filter(t => t.isGoal);
    let consistencyPct = 100;
    if (goalTasks.length > 0) {
      const aliveStreaks = goalTasks.filter(g => computeStreak(g) > 0).length;
      consistencyPct = (aliveStreaks / goalTasks.length) * 100;
    }

    const score = Math.round(completionPct * 0.7 + consistencyPct * 0.3);

    const el = document.getElementById("focusScoreBox");
    let color = "var(--danger)";
    if (score >= 80) color = "var(--accent)";
    else if (score >= 50) color = "var(--warning)";

    el.innerHTML = `
      <div id="focusScoreNum" style="font-size:var(--text-2xl);font-weight:600;color:${color};">0</div>
      <div style="font-size:var(--text-sm);color:var(--text-muted);"><i data-lucide="activity" class="icon"></i> Focus Score</div>
    `;
    lucide.createIcons();
    animateCountUp(document.getElementById("focusScoreNum"), score, 550);
  }

  function avgPctForRange(startDaysAgo, endDaysAgo) {
    const today = new Date(); today.setHours(0,0,0,0);
    let sum = 0, count = 0;
    for (let i = startDaysAgo; i >= endDaysAgo; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const p = dayPct(d);
      if (p !== null) { sum += p; count++; }
    }
    return count ? sum / count : null;
  }

  function renderMomentum() {
    const thisWeek = avgPctForRange(6, 0);
    const lastWeek = avgPctForRange(13, 7);
    const el = document.getElementById("momentumBox");

    if (thisWeek === null || lastWeek === null) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:var(--text-base);">Not enough history yet to show momentum.</div>`;
      return;
    }

    const diff = Math.round(thisWeek - lastWeek);
    let icon = "minus", label = "Steady", color = "var(--text-muted)";
    if (diff > 3) { icon = "trending-up"; label = "You're improving"; color = "var(--accent)"; }
    else if (diff < -3) { icon = "trending-down"; label = "Momentum dropping"; color = "var(--danger)"; }

    el.innerHTML = `
      <div style="font-size:var(--text-xl);color:${color};"><i data-lucide="${icon}" class="icon icon-lg" style="color:inherit;"></i></div>
      <div style="font-weight:500;color:${color};">${label}</div>
      <div style="font-size:var(--text-sm);color:var(--text-muted);"><span id="momentumThisWeek">0</span>% this week vs <span id="momentumLastWeek">0</span>% last week</div>
    `;
    lucide.createIcons();
    animateCountUp(document.getElementById("momentumThisWeek"), Math.round(thisWeek), 550);
    animateCountUp(document.getElementById("momentumLastWeek"), Math.round(lastWeek), 550);
  }

  // "Last 30 days" means the 30 days before this week, so it doesn't
  // double-count days already reflected in the this-week average.
  function computeMonthComparison() {
    const thisWeek = avgPctForRange(6, 0);
    const monthAvg = avgPctForRange(36, 7);
    const diff = (thisWeek === null || monthAvg === null) ? null : thisWeek - monthAvg;
    return { thisWeek, monthAvg, diff };
  }

  function renderMonthComparison() {
    const el = document.getElementById("monthComparisonBox");
    if (!el) return;
    if (!isPremiumUser()) { el.style.display = "none"; return; }
    el.style.display = "block";

    const comp = computeMonthComparison();
    if (comp.thisWeek === null || comp.monthAvg === null) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:var(--text-base);">Not enough history yet to compare.</div>`;
      return;
    }

    const diff = Math.round(comp.diff);
    let icon = "minus", label = "In line with your last 30 days", color = "var(--text-muted)";
    if (diff > 3) { icon = "trending-up"; label = "Trending above your last 30 days"; color = "var(--accent)"; }
    else if (diff < -3) { icon = "trending-down"; label = "Trending below your last 30 days"; color = "var(--danger)"; }

    el.innerHTML = `
      <div style="font-size:var(--text-xl);color:${color};"><i data-lucide="${icon}" class="icon icon-lg" style="color:inherit;"></i></div>
      <div style="font-weight:500;color:${color};">${label}</div>
      <div style="font-size:var(--text-sm);color:var(--text-muted);">This week: <span id="monthCompThisWeek">0</span>% · Last 30 days average: <span id="monthCompMonthAvg">0</span>%</div>
    `;
    lucide.createIcons();
    animateCountUp(document.getElementById("monthCompThisWeek"), Math.round(comp.thisWeek), 550);
    animateCountUp(document.getElementById("monthCompMonthAvg"), Math.round(comp.monthAvg), 550);
  }

  function renderRingChart() {
    const today = new Date();
    const todayTasks = getTasksForDate(today, "All");
    const total = todayTasks.length;
    const done = todayTasks.filter(t => t.occurrenceDone).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const byCat = {};
    todayTasks.forEach(t => {
      if (!byCat[t.category]) byCat[t.category] = { done: 0, total: 0 };
      byCat[t.category].total++;
      if (t.occurrenceDone) byCat[t.category].done++;
    });

    const svg = document.getElementById("ringChart");
    svg.innerHTML = "";
    const cx = 100, cy = 100, r = 80;
    const circumference = 2 * Math.PI * r;
    const ns = "http://www.w3.org/2000/svg";

    const bg = document.createElementNS(ns, "circle");
    bg.setAttribute("cx", cx); bg.setAttribute("cy", cy); bg.setAttribute("r", r);
    bg.setAttribute("fill", "none"); bg.setAttribute("stroke", "var(--border)"); bg.setAttribute("stroke-width", "20");
    svg.appendChild(bg);

    let cumulative = 0;
    const catKeys = Object.keys(byCat);
    catKeys.forEach((catName, idx) => {
      const info = byCat[catName];
      const segPct = total ? (info.done / total) * 100 : 0;
      if (segPct <= 0) return;
      const segLen = (segPct / 100) * circumference;
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", categoryColor(catName));
      circle.setAttribute("stroke-width", "20");
      circle.setAttribute("stroke-dasharray", `0 ${circumference}`);
      circle.setAttribute("stroke-dashoffset", -((cumulative / 100) * circumference));
      circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
      circle.style.transition = "stroke-dasharray 700ms cubic-bezier(0.16, 1, 0.3, 1)";
      svg.appendChild(circle);
      const finalDasharray = `${segLen} ${circumference - segLen}`;
      const delay = catKeys.length > 1 ? idx * 60 : 0;
      requestAnimationFrame(() => {
        setTimeout(() => circle.setAttribute("stroke-dasharray", finalDasharray), delay);
      });
      cumulative += segPct;
    });

    const text1 = document.createElementNS(ns, "text");
    text1.setAttribute("x", cx); text1.setAttribute("y", cy - 6); text1.setAttribute("text-anchor", "middle");
    text1.setAttribute("font-size", "var(--text-sm)"); text1.setAttribute("fill", "var(--text-secondary)");
    text1.textContent = "Locked in";
    svg.appendChild(text1);

    const text2 = document.createElementNS(ns, "text");
    text2.setAttribute("x", cx); text2.setAttribute("y", cy + 22); text2.setAttribute("text-anchor", "middle");
    text2.setAttribute("font-size", "var(--text-2xl)"); text2.setAttribute("font-weight", "600"); text2.setAttribute("fill", "var(--text-primary)");
    text2.textContent = "0%";
    svg.appendChild(text2);
    animateCountUp(text2, pct, 550, "%");

    const legend = document.getElementById("ringLegend");
    legend.innerHTML = "";
    if (Object.keys(byCat).length === 0) {
      legend.innerHTML = "<div style='color:var(--text-muted)'>No tasks scheduled today.</div>";
    }
    Object.keys(byCat).forEach(catName => {
      const info = byCat[catName];
      const row = document.createElement("div");
      row.className = "ring-legend-row";
      const dot = document.createElement("div");
      dot.className = "ring-legend-dot";
      dot.style.background = categoryColor(catName);
      const label = document.createElement("span");
      label.textContent = `${catName}: ${info.done} / ${info.total} tasks completed`;
      row.appendChild(dot);
      row.appendChild(label);
      legend.appendChild(row);
    });
  }

  function dayPct(d) {
    const dayTasks = getTasksForDate(d, "All");
    if (dayTasks.length === 0) return null;
    const done = dayTasks.filter(t => t.occurrenceDone).length;
    return Math.round((done / dayTasks.length) * 100);
  }

  function renderBarChart(range) {
    const container = document.getElementById("barChart");
    container.innerHTML = "";
    let dataPoints = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);

    if (range === "week") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        dataPoints.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), pct: dayPct(d) });
      }
    } else if (range === "month") {
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), i);
        if (d > today) { dataPoints.push({ label: i.toString(), pct: null }); continue; }
        dataPoints.push({ label: i.toString(), pct: dayPct(d) });
      }
    } else if (range === "year") {
      for (let m = 0; m < 12; m++) {
        const monthDate = new Date(today.getFullYear(), m, 1);
        const daysInMonth = new Date(today.getFullYear(), m + 1, 0).getDate();
        let sum = 0, count = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const d = new Date(today.getFullYear(), m, day);
          if (d > today) continue;
          const p = dayPct(d);
          if (p !== null) { sum += p; count++; }
        }
        dataPoints.push({ label: monthDate.toLocaleDateString(undefined, { month: "short" }), pct: count ? Math.round(sum / count) : null });
      }
    }

    const skipStagger = dataPoints.length > 20;
    dataPoints.forEach((dp, idx) => {
      const col = document.createElement("div");
      col.className = "bar-col";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.height = "0%";
      if (dp.pct === null) fill.style.background = "var(--border)";
      const label = document.createElement("div");
      label.className = "bar-label";
      label.textContent = dp.label;
      col.appendChild(fill);
      col.appendChild(label);
      container.appendChild(col);

      const targetHeight = (dp.pct ?? 0) + "%";
      const delay = skipStagger ? 0 : idx * 20;
      requestAnimationFrame(() => {
        setTimeout(() => { fill.style.height = targetHeight; }, delay);
      });
    });

    const valid = dataPoints.filter(dp => dp.pct !== null);
    const bestWorstEl = document.getElementById("bestWorst");
    bestWorstEl.innerHTML = "";
     if (valid.length > 0) {
      const best = valid.reduce((a, b) => b.pct > a.pct ? b : a);
      const worst = valid.reduce((a, b) => b.pct < a.pct ? b : a);
      bestWorstEl.innerHTML = `<div class="box"><i data-lucide="flame" class="icon"></i> Best: ${best.label} (${best.pct}%)</div><div class="box"><i data-lucide="trending-down" class="icon"></i> Toughest: ${worst.label} (${worst.pct}%)</div>`;
      lucide.createIcons();
    }
  }

  document.querySelectorAll(".range-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRange = btn.dataset.range;
      renderBarChart(currentRange);
    });
  });
  const SESSIONS = [
    { name: "Sprint", icon: "zap", time: "25 / 5", work: 25, breakMinutes: 5 },
    { name: "Flow", icon: "waves", time: "50 / 10", work: 50, breakMinutes: 10 },
    { name: "Ultra", icon: "flame", time: "90 / 20", work: 90, breakMinutes: 20 },
    { name: "Micro", icon: "zap-off", time: "10 / 2", work: 10, breakMinutes: 2 },
    { name: "Marathon", icon: "mountain", time: "120 / 30", work: 120, breakMinutes: 30 },
    { name: "Custom", icon: "settings", time: "Choose", work: null, breakMinutes: null }
  ];
  let selectedSession = 0;
  let customPresets = JSON.parse(localStorage.getItem("customPresets")) || [];

  function saveCustomPresets() {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      window.firestoreBridge.syncCustomPresets(customPresets);
      return;
    }
    localStorage.setItem("customPresets", JSON.stringify(customPresets));
  }

  function addCustomPreset(name, minutes, breakMinutes) {
    const resolvedBreak = (breakMinutes === null || breakMinutes === undefined || isNaN(breakMinutes))
      ? Math.round(minutes / 5)
      : breakMinutes;
    customPresets.push({ id: Date.now().toString() + Math.random().toString(36).slice(2, 7), name, workMinutes: minutes, breakMinutes: resolvedBreak });
    saveCustomPresets();
    selectedSession = SESSIONS.length + customPresets.length - 1;
  }

  // Built-in sessions plus any saved custom presets, in one combined list so
  // the grid, selection index, and timer logic all treat them uniformly.
  // The built-in "Custom" slot is identified by work === null (not by a
  // fixed array index), so it stays correct regardless of how many presets
  // come before or after it.
  function getSessionOptions() {
    return SESSIONS.concat(customPresets.map(p => ({
      name: p.name, icon: "star", time: p.workMinutes + " min", work: p.workMinutes,
      // Presets saved before breakMinutes existed won't have it — fall back
      // to the same work/5 default used when creating a new preset.
      breakMinutes: p.breakMinutes != null ? p.breakMinutes : Math.round(p.workMinutes / 5),
      isCustomPreset: true, id: p.id
    })));
  }

  // Stable identity for a session option across getSessionOptions() calls,
  // since preset entries are freshly re-mapped (new object references) each
  // time — used to re-locate the selected session after the options list
  // shifts (e.g. a preset before it gets deleted).
  function sessionKey(s) {
    if (s.isCustomPreset) return "preset:" + s.id;
    if (s.work === null) return "custom";
    return "builtin:" + s.name;
  }

  function getTrialStartDate() {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn() && window.firestoreBridge.getAccountInfo) {
      const account = window.firestoreBridge.getAccountInfo();
      const raw = account && account.trialStartDate;
      if (!raw) return null;
      return raw.toDate ? raw.toDate() : new Date(raw);
    }
    const raw = localStorage.getItem(LOCAL_TRIAL_START_KEY);
    return raw ? new Date(raw) : null;
  }

  function trialDaysRemaining() {
    const start = getTrialStartDate();
    if (!start) return 0;
    const elapsedMs = Date.now() - start.getTime();
    const remainingMs = TRIAL_DURATION_DAYS * 86400000 - elapsedMs;
    return Math.max(0, Math.ceil(remainingMs / 86400000));
  }

  function isTrialActive() {
    return trialDaysRemaining() > 0;
  }

  // Called from the Day 1 seal moment (see reflSaveBtn's handler below) —
  // a no-op if a trial has already been started, so sealing every
  // subsequent day doesn't reset the clock. Safe to call unconditionally
  // on every seal rather than needing to separately track "is this
  // actually Day 1".
  function startTrialOnDayOneSeal() {
    if (getTrialStartDate()) return;
    const now = new Date();
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn() && window.firestoreBridge.setTrialStartDate) {
      window.firestoreBridge.setTrialStartDate(now);
    } else {
      localStorage.setItem(LOCAL_TRIAL_START_KEY, now.toISOString());
    }
  }

  function isPremiumUser() {
    // "Real" premium is still just a client-editable localStorage flag —
    // roadmap #8 moves this to users/{uid}/billing/status, written only by
    // a Cloud Function. Kept here as a manual-testing escape hatch and the
    // eventual seam for an actual paid subscription; the trial above is
    // the real, timestamp-checked path every new user actually goes
    // through today.
    const reallyPremium = localStorage.getItem("isPremium") === "true";
    return reallyPremium || isTrialActive();
  }

  // No cached variable existed for this before — every read/write hit
  // localStorage directly (5 separate literal reads). Signed-in users read
  // the live Firestore mirror via window.firestoreBridge; signed-out users
  // keep using this local cache, loaded from localStorage exactly as
  // before. Firestore writes land in the follow-up chunk — this chunk is
  // read-side only.
  let localDeepWorkSessions = JSON.parse(localStorage.getItem("deepWorkSessions")) || [];

  function getDeepWorkSessions() {
    return (window.firestoreBridge && window.firestoreBridge.isSignedIn())
      ? window.firestoreBridge.getDeepWorkSessions()
      : localDeepWorkSessions;
  }

  // Returns an opaque identifier threaded through to saveDeepWorkSessionNote
  // later — an array index when signed out, a Firestore doc id (string)
  // when signed in. Neither caller in between (showSessionCompleteScreen/
  // showSessionNoteScreen) inspects it, just passes it along.
  function logDeepWorkSession(session, workMinutes) {
    const sessionData = { date: toDateStr(new Date()), sessionName: session.name, durationMinutes: workMinutes, note: "" };
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      return window.firestoreBridge.logDeepWorkSession(sessionData);
    }
    localDeepWorkSessions.push(sessionData);
    localStorage.setItem("deepWorkSessions", JSON.stringify(localDeepWorkSessions));
    return localDeepWorkSessions.length - 1;
  }

  function saveDeepWorkSessionNote(sessionId, note) {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      window.firestoreBridge.saveDeepWorkSessionNote(sessionId, note);
      return;
    }
    if (localDeepWorkSessions[sessionId]) {
      localDeepWorkSessions[sessionId].note = note;
      localStorage.setItem("deepWorkSessions", JSON.stringify(localDeepWorkSessions));
    }
  }

  function renderDeepWorkStats() {
    const el = document.getElementById("deepWorkStats");
    if (!isPremiumUser()) {
      el.innerHTML = `<div class="deep-work-stats-teaser">Unlock session history and stats with Premium</div>`;
      return;
    }
    const sessions = getDeepWorkSessions();
    if (sessions.length === 0) {
      el.innerHTML = `<div class="deep-work-stats-teaser">Deep Work sessions help you focus on one task without distractions. Pick a session length below and start your first one.</div>`;
      return;
    }
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = toDateStr(weekStart);
    const weekMinutes = sessions.filter(s => s.date >= weekStartStr).reduce((sum, s) => sum + s.durationMinutes, 0);
    const weekHours = (weekMinutes / 60).toFixed(1);

    const sessionDates = new Set(sessions.map(s => s.date));
    let streak = 0;
    const cursor = new Date(today);
    while (sessionDates.has(toDateStr(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    const longestSession = sessions.length ? Math.max(...sessions.map(s => s.durationMinutes)) : 0;

    el.innerHTML = `
      <div class="deep-work-stats-row">
        <div class="deep-work-stat"><div class="deep-work-stat-value">${weekHours}h</div><div class="deep-work-stat-label">This week</div></div>
        <div class="deep-work-stat"><div class="deep-work-stat-value">${streak}</div><div class="deep-work-stat-label">Day streak</div></div>
        <div class="deep-work-stat"><div class="deep-work-stat-value">${longestSession}m</div><div class="deep-work-stat-label">Longest session</div></div>
      </div>
    `;
  }

  function renderFocus() {
    // A background re-render (e.g. a Firestore snapshot update landing right
    // after logDeepWorkSession writes the just-completed session) can fire
    // while a session is running or its complete/note/repeat screens are
    // showing. Forcing the screen back to setup here would flash it over
    // whatever's actually on screen — only reset when the timer screen isn't
    // already the one showing.
    if (document.getElementById("focusTimerScreen").style.display !== "block") {
      document.getElementById("focusSetup").style.display = "block";
      document.getElementById("focusTimerScreen").style.display = "none";
    }
    renderDeepWorkStats();

    const options = getSessionOptions();
    if (selectedSession !== null && selectedSession >= options.length) selectedSession = 0;

    const grid = document.getElementById("focusSessionGrid");
    grid.innerHTML = "";
    options.forEach((s, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "focus-session pressable" + (i === selectedSession ? " selected" : "");
      card.innerHTML = `<div class="session-name"><i data-lucide="${s.icon}" class="icon"></i> ${s.name}</div><div class="session-time">${s.time}</div>`;
      card.addEventListener("click", () => { selectedSession = i; renderFocus(); });
      if (s.isCustomPreset) {
        const edit = document.createElement("span");
        edit.className = "focus-session-edit";
        edit.title = "Edit preset";
        edit.innerHTML = '<i data-lucide="edit-3" class="icon"></i>';
        edit.addEventListener("click", (e) => {
          e.stopPropagation();
          const preset = customPresets.find(p => p.id === s.id);
          if (preset) openEditPresetModal(preset);
        });
        card.appendChild(edit);

        const del = document.createElement("span");
        del.className = "focus-session-delete";
        del.title = "Remove preset";
        del.innerHTML = '<i data-lucide="x" class="icon"></i>';
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          const prevSelectedKey = selectedSession !== null && options[selectedSession] ? sessionKey(options[selectedSession]) : null;
          const deletedKey = sessionKey(s);
          card.classList.add("focus-session-removing");
          void card.offsetHeight;
          requestAnimationFrame(() => {
            card.style.opacity = "0";
            card.style.transform = "scale(0.9)";
          });
          setTimeout(() => {
            customPresets = customPresets.filter(p => p.id !== s.id);
            saveCustomPresets();
            if (prevSelectedKey === null || prevSelectedKey === deletedKey) {
              selectedSession = null;
            } else {
              const newIndex = getSessionOptions().findIndex(o => sessionKey(o) === prevSelectedKey);
              selectedSession = newIndex === -1 ? null : newIndex;
            }
            renderFocus();
          }, 180);
        });
        card.appendChild(del);
      }
      grid.appendChild(card);
    });
    if (isPremiumUser()) {
      const addCard = document.createElement("button");
      addCard.type = "button";
      addCard.className = "focus-session focus-session-add pressable";
      addCard.innerHTML = `<div class="session-name"><i data-lucide="plus" class="icon"></i> Add preset</div><div class="session-time">Create your own</div>`;
      addCard.addEventListener("click", () => openAddPresetModal());
      grid.appendChild(addCard);
    }
    lucide.createIcons();

    const isCustomSlot = options[selectedSession] && options[selectedSession].work === null;
    document.getElementById("customMinutesRow").style.display = isCustomSlot ? "block" : "none";
    document.getElementById("customMinutesInput").value = "";
    document.getElementById("customBreakInput").value = "";
    document.getElementById("customMinutesError").classList.remove("show");

    const container = document.getElementById("focusTopTasks");
    container.innerHTML = "";
    const todayTasks = getTasksForDate(new Date(), "All").filter(t => !t.occurrenceDone).slice(0, 3);

    if (todayTasks.length === 0) {
      container.innerHTML = '<div class="focus-empty"><i data-lucide="check-circle-2" class="icon icon-accent"></i> Everything is done today</div>';
      lucide.createIcons();
      return;
    }
    todayTasks.forEach(task => {
      const row = document.createElement("div");
      row.className = "focus-task-row";
      row.textContent = task.checkoffLabel || task.name;
      container.appendChild(row);
    });
  }
  let timerInterval = null;
  let remainingSeconds = 0;
  let totalSeconds = 0;
  let timerRunning = false;
  // How far (ms) into the current whole-second window the countdown had
  // gotten when it was last paused, and when that window last started —
  // together these let resume pick up exactly where pause left off instead
  // of always waiting a fresh full second (see pauseResumeBtn handler).
  let tickElapsedMs = 0;
  let lastTickAt = 0;

  function scheduleTick(delayMs) {
    timerInterval = setTimeout(tick, delayMs);
  }
  let timerPhase = "work"; // "work" | "break"
  let currentCompletedSession = null;
  let lastSessionWorkMinutes = 0;
  // Only meaningful for the ad-hoc Custom slot (session.breakMinutes is
  // always null there, unlike built-ins/presets which carry their own) —
  // set from #customBreakInput when a Custom timer starts, null meaning
  // "use the work/5 default", same as an unset preset break value.
  let customSlotBreakMinutes = null;

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  const TIMER_RING_R = 90;
  const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * TIMER_RING_R;

  // Reuses the same bg/fg <circle> elements across calls instead of
  // rebuilding the SVG every tick — rebuilding meant a brand-new fg element
  // each second with no prior state to transition from, so the CSS
  // transition never actually had anything to animate and the ring visibly
  // stepped instead of sweeping smoothly.
  function drawTimerRing(pctRemaining, ringColor) {
    const svg = document.getElementById("timerRing");
    const ns = "http://www.w3.org/2000/svg";
    const cx = 100, cy = 100;
    let bg = svg.querySelector(".timer-ring-bg");
    let fg = svg.querySelector(".timer-ring-fg");

    if (!bg || !fg) {
      svg.innerHTML = "";
      bg = document.createElementNS(ns, "circle");
      bg.setAttribute("class", "timer-ring-bg");
      bg.setAttribute("cx", cx); bg.setAttribute("cy", cy); bg.setAttribute("r", TIMER_RING_R);
      bg.setAttribute("fill", "none"); bg.setAttribute("stroke", "var(--border)"); bg.setAttribute("stroke-width", "10");
      svg.appendChild(bg);

      fg = document.createElementNS(ns, "circle");
      fg.setAttribute("class", "timer-ring-fg");
      fg.setAttribute("cx", cx); fg.setAttribute("cy", cy); fg.setAttribute("r", TIMER_RING_R);
      fg.setAttribute("fill", "none"); fg.setAttribute("stroke-width", "10");
      fg.setAttribute("stroke-linecap", "round");
      fg.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
      fg.style.transition = TIMER_RING_TRANSITION;
      svg.appendChild(fg);
    }

    const dashLen = (pctRemaining / 100) * TIMER_RING_CIRCUMFERENCE;
    fg.setAttribute("stroke-dasharray", `${dashLen} ${TIMER_RING_CIRCUMFERENCE - dashLen}`);
    fg.setAttribute("stroke", ringColor || "var(--accent)");
  }

  const TIMER_RING_TRANSITION = "stroke-dasharray 1s linear, stroke 300ms ease";

  // The ring's fg circle has its own CSS transition (see drawTimerRing) that
  // keeps gliding toward its last-set target on its own clock — clearing the
  // tick interval stops future targets from being set, but doesn't cancel an
  // already-in-flight transition. Snap it to wherever it currently sits and
  // disable the transition so pause is visually instant too.
  function freezeTimerRing() {
    const fg = document.getElementById("timerRing").querySelector(".timer-ring-fg");
    if (!fg) return;
    const current = getComputedStyle(fg).strokeDasharray
      .split(",")
      .map(parseFloat);
    fg.style.transition = "none";
    fg.setAttribute("stroke-dasharray", current.join(" "));
    void fg.getBoundingClientRect();
  }

  function unfreezeTimerRing() {
    const fg = document.getElementById("timerRing").querySelector(".timer-ring-fg");
    if (!fg) return;
    fg.style.transition = TIMER_RING_TRANSITION;
  }

  function updateTimerDisplay() {
    document.getElementById("timerTime").textContent = formatTime(remainingSeconds);
    drawTimerRing((remainingSeconds / totalSeconds) * 100, timerPhase === "break" ? "var(--warning)" : "var(--accent)");
  }

  function crossfadeFocusScreens(hideEl, showEl) {
    hideEl.classList.add("fs-hidden");
    setTimeout(() => {
      hideEl.style.display = "none";
      hideEl.classList.remove("fs-hidden");
      showEl.style.display = "block";
      showEl.classList.add("fs-hidden");
      void showEl.offsetWidth;
      requestAnimationFrame(() => {
        showEl.classList.remove("fs-hidden");
      });
    }, 150);
  }

  const AFFIRMATION_VARIANTS = [
    "Nice work.",
    "That's a solid block.",
    "Locked in.",
    "Deep work, done right.",
    "Head down, task done."
  ];
  let affirmationRotationIndex = 0;

  function ordinal(n) {
    const suffixes = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }

  // Prefers a specific, true line over the generic rotation whenever
  // deepWorkSessions history actually supports one — a real personal
  // record beats a stock compliment.
  function computeAffirmation(workMinutes) {
    const sessions = getDeepWorkSessions();
    const todayStr = toDateStr(new Date());
    const todayCount = sessions.filter(s => s.date === todayStr).length;
    const priorSessions = sessions.slice(0, -1); // exclude the one just logged
    // Strictly greater, not >= — a tied duration (very common when repeating
    // the same preset via "Start another") shouldn't claim a new record on
    // every single repeat and crowd out the "Nth session today" line.
    const isLongestEver = priorSessions.length > 0 && workMinutes > Math.max(...priorSessions.map(s => s.durationMinutes));

    if (isLongestEver) return "Longest session yet.";
    if (todayCount >= 2) return `${ordinal(todayCount)} session today.`;

    const line = AFFIRMATION_VARIANTS[affirmationRotationIndex % AFFIRMATION_VARIANTS.length];
    affirmationRotationIndex++;
    return line;
  }

  function showSessionCompleteScreen(session, workMinutes, sessionIndex, onDone) {
    const screen = document.getElementById("sessionCompleteScreen");
    document.getElementById("sessionCompleteInfo").textContent = `${session.name} session, ${workMinutes} minutes`;
    document.getElementById("sessionCompleteAffirmation").textContent = computeAffirmation(workMinutes);
    screen.classList.add("visible");
    springScaleReveal(screen.querySelector(".session-complete-icon"), 0.8);
    document.getElementById("sessionCompleteContinueBtn").addEventListener("click", () => {
      screen.classList.remove("visible");
      if (isPremiumUser()) {
        showSessionNoteScreen(sessionIndex, onDone);
      } else {
        onDone();
      }
    }, { once: true });
  }

  function showSessionNoteScreen(sessionIndex, onDone) {
    const overlay = document.getElementById("sessionNoteOverlay");
    const input = document.getElementById("sessionNoteInput");
    input.value = "";
    document.getElementById("sessionNoteSaveBtn").disabled = true;
    openModal(overlay);
    setTimeout(() => input.focus(), 50);

    function finish(note) {
      if (note !== null) saveDeepWorkSessionNote(sessionIndex, note);
      closeModal(overlay);
      onDone();
    }
    document.getElementById("sessionNoteSaveBtn").addEventListener("click", () => finish(input.value.trim()), { once: true });
    document.getElementById("sessionNoteSkipBtn").addEventListener("click", () => finish(null), { once: true });
  }

  function tick() {
    if (!timerRunning) return;
    remainingSeconds--;
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      updateTimerDisplay();
      // Calling finishWorkPhase/finishBreakPhase synchronously here means the
      // "0:00" display update above and the completion screen covering it up
      // both happen within the same tick, before the browser ever paints —
      // so "0" is never actually seen, and it looks like completion fires a
      // second early. A short deferral lets "0:00" genuinely render first.
      const phase = timerPhase;
      setTimeout(() => {
        if (!document.body.classList.contains("timer-active")) return; // user backed out (e.g. tapped End) during the pause-at-zero
        if (phase === "break") {
          finishBreakPhase();
        } else {
          finishWorkPhase();
        }
      }, 500);
      return;
    }
    updateTimerDisplay();
    lastTickAt = Date.now();
    tickElapsedMs = 0;
    scheduleTick(1000);
  }

  function finishWorkPhase() {
    const session = getSessionOptions()[selectedSession];
    const workMinutes = Math.round(totalSeconds / 60);
    const breakMinutes = session.breakMinutes != null ? session.breakMinutes
      : customSlotBreakMinutes != null ? customSlotBreakMinutes
      : Math.round(workMinutes / 5);
    const sessionIndex = logDeepWorkSession(session, workMinutes);
    currentCompletedSession = session;
    lastSessionWorkMinutes = workMinutes;
    showSessionCompleteScreen(session, workMinutes, sessionIndex, () => {
      if (breakMinutes > 0) {
        startBreakTimer(session, breakMinutes);
      } else {
        showRepeatScreen(session);
      }
    });
  }

  function finishBreakPhase() {
    timerRunning = false;
    showRepeatScreen(currentCompletedSession);
  }

  function setTimerLabelIcon(iconName) {
    const iconEl = document.querySelector("#focusTimerScreen .timer-label i");
    if (!iconEl) return;
    iconEl.setAttribute("data-lucide", iconName);
    lucide.createIcons();
  }

  // Shared by both the setup-screen "Start Session" path and the post-break
  // "Start another" path, so restarting reuses the exact same duration
  // rather than re-deriving it (which would break for ad-hoc Custom minutes).
  function beginTimer(session, workMinutes) {
    timerPhase = "work";
    totalSeconds = workMinutes * 60;
    remainingSeconds = totalSeconds;
    timerRunning = true;

    document.getElementById("focusTimerScreen").classList.remove("break-mode", "repeat-mode");
    document.getElementById("skipBreakBtn").style.display = "none";
    document.getElementById("timerRepeatActions").style.display = "none";
    document.getElementById("timerLabel").textContent = session.name + " session";
    setTimerLabelIcon("timer");
    setIcon(document.getElementById("pauseResumeBtn"), "pause");
    document.getElementById("pauseResumeBtn").style.display = ""; // undo the break screen's hide, if coming from one
    document.body.classList.add("timer-active");

    updateTimerDisplay();
    clearInterval(timerInterval);
    lastTickAt = Date.now();
    tickElapsedMs = 0;
    scheduleTick(1000);
  }

  function startBreakTimer(session, breakMinutes) {
    timerPhase = "break";
    totalSeconds = breakMinutes * 60;
    remainingSeconds = totalSeconds;
    timerRunning = true;

    document.getElementById("focusTimerScreen").classList.add("break-mode");
    document.getElementById("timerLabel").textContent = "Break";
    setTimerLabelIcon("coffee");
    document.getElementById("skipBreakBtn").style.display = "block";
    // Pause and Skip break both just stop the break from continuing
    // normally, which is redundant — Skip break already covers that use
    // case here, so Pause (unlike on the work screen) has no real purpose.
    document.getElementById("pauseResumeBtn").style.display = "none";

    updateTimerDisplay();
    clearInterval(timerInterval);
    lastTickAt = Date.now();
    tickElapsedMs = 0;
    scheduleTick(1000);
  }

  function showRepeatScreen(session) {
    timerRunning = false;
    clearInterval(timerInterval);
    document.body.classList.remove("timer-active");
    document.getElementById("focusTimerScreen").classList.remove("break-mode");
    document.getElementById("focusTimerScreen").classList.add("repeat-mode");
    document.getElementById("skipBreakBtn").style.display = "none";
    document.getElementById("timerLabel").textContent = "What's next?";
    setTimerLabelIcon("timer");
    document.getElementById("startAnotherBtn").textContent = `Start another ${session.name}`;
    document.getElementById("timerRepeatActions").style.display = "flex";
  }

  function restartSameSession() {
    if (!currentCompletedSession) return;
    const idx = getSessionOptions().findIndex(o => sessionKey(o) === sessionKey(currentCompletedSession));
    if (idx !== -1) selectedSession = idx;
    beginTimer(currentCompletedSession, lastSessionWorkMinutes);
  }

  function startTimer() {
    const session = getSessionOptions()[selectedSession];
    if (!session) {
      showToast("Select a session first", "warning");
      return;
    }
    let workMinutes = session.work;
    if (session.work === null) {
      const customInput = document.getElementById("customMinutesInput");
      const breakInput = document.getElementById("customBreakInput");
      const err = document.getElementById("customMinutesError");
      workMinutes = parseInt(customInput.value);
      if (!workMinutes || workMinutes < 1) {
        err.textContent = "Enter custom minutes first.";
        err.classList.add("show");
        return;
      }
      const breakRaw = breakInput.value.trim();
      const breakVal = breakRaw === "" ? null : parseInt(breakRaw);
      if (breakRaw !== "" && (isNaN(breakVal) || breakVal < 0)) {
        err.textContent = "Break minutes can't be negative.";
        err.classList.add("show");
        return;
      }
      customSlotBreakMinutes = breakVal;
      customInput.value = "";
      breakInput.value = "";
    } else {
      customSlotBreakMinutes = null;
    }
    document.getElementById("customMinutesError").classList.remove("show");
    crossfadeFocusScreens(document.getElementById("focusSetup"), document.getElementById("focusTimerScreen"));
    beginTimer(session, workMinutes);
  }

  function endTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    document.body.classList.remove("timer-active");
    document.getElementById("focusTimerScreen").classList.remove("break-mode", "repeat-mode");
    document.getElementById("skipBreakBtn").style.display = "none";
    document.getElementById("timerRepeatActions").style.display = "none";
    renderDeepWorkStats();
    crossfadeFocusScreens(document.getElementById("focusTimerScreen"), document.getElementById("focusSetup"));
  }

  document.getElementById("customMinutesInput").addEventListener("input", () => {
    document.getElementById("customMinutesError").classList.remove("show");
  });
  document.getElementById("customBreakInput").addEventListener("input", () => {
    document.getElementById("customMinutesError").classList.remove("show");
  });

  document.getElementById("sessionNoteInput").addEventListener("input", () => {
    document.getElementById("sessionNoteSaveBtn").disabled = document.getElementById("sessionNoteInput").value.trim() === "";
  });

  function blockNonWholeNumberKeys(e) {
    if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
  }
  document.getElementById("customMinutesInput").addEventListener("keydown", blockNonWholeNumberKeys);
  document.getElementById("customBreakInput").addEventListener("keydown", blockNonWholeNumberKeys);
  document.getElementById("addPresetMinutesInput").addEventListener("keydown", blockNonWholeNumberKeys);
  document.getElementById("addPresetBreakInput").addEventListener("keydown", blockNonWholeNumberKeys);

  const addPresetOverlay = document.getElementById("addPresetModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(addPresetOverlay);
  // null while creating a new preset; set to the preset's id while the modal
  // is open in edit mode, so the shared save handler knows which path to take.
  let editingPresetId = null;

  function openAddPresetModal() {
    editingPresetId = null;
    document.getElementById("addPresetModalTitle").textContent = "Add preset";
    document.getElementById("addPresetSaveBtn").textContent = "Save preset";
    document.getElementById("addPresetNameInput").value = "";
    document.getElementById("addPresetMinutesInput").value = "";
    document.getElementById("addPresetBreakInput").value = "";
    document.getElementById("addPresetError").classList.remove("show");
    openModal(addPresetOverlay);
    setTimeout(() => document.getElementById("addPresetNameInput").focus(), 50);
  }

  function openEditPresetModal(preset) {
    editingPresetId = preset.id;
    document.getElementById("addPresetModalTitle").textContent = "Edit preset";
    document.getElementById("addPresetSaveBtn").textContent = "Save changes";
    document.getElementById("addPresetNameInput").value = preset.name;
    document.getElementById("addPresetMinutesInput").value = preset.workMinutes;
    document.getElementById("addPresetBreakInput").value = preset.breakMinutes != null ? preset.breakMinutes : "";
    document.getElementById("addPresetError").classList.remove("show");
    openModal(addPresetOverlay);
    setTimeout(() => document.getElementById("addPresetNameInput").focus(), 50);
  }

  document.getElementById("addPresetCancelBtn").addEventListener("click", () => closeModal(addPresetOverlay));

  document.getElementById("addPresetSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("addPresetNameInput").value.trim();
    const minutes = parseInt(document.getElementById("addPresetMinutesInput").value);
    const breakInputRaw = document.getElementById("addPresetBreakInput").value.trim();
    const breakMinutes = breakInputRaw === "" ? null : parseInt(breakInputRaw);
    const err = document.getElementById("addPresetError");
    if (!name) {
      err.textContent = "Enter a name for this preset.";
      err.classList.add("show");
      return;
    }
    if (!minutes || minutes < 1) {
      err.textContent = "Enter minutes for this preset.";
      err.classList.add("show");
      return;
    }
    if (breakInputRaw !== "" && (isNaN(breakMinutes) || breakMinutes < 0)) {
      err.textContent = "Break minutes can't be negative.";
      err.classList.add("show");
      return;
    }
    if (editingPresetId) {
      const preset = customPresets.find(p => p.id === editingPresetId);
      if (preset) {
        preset.name = name;
        preset.workMinutes = minutes;
        preset.breakMinutes = breakInputRaw === "" ? Math.round(minutes / 5) : breakMinutes;
        saveCustomPresets();
      }
      closeModal(addPresetOverlay);
      renderFocus();
      showToast(`Updated "${name}"`, "success");
    } else {
      addCustomPreset(name, minutes, breakMinutes);
      closeModal(addPresetOverlay);
      renderFocus();
      showToast(`Saved "${name}" as a preset`, "success");
    }
  });

  document.getElementById("startFocusBtn").addEventListener("click", startTimer);

  document.getElementById("pauseResumeBtn").addEventListener("click", () => {
    timerRunning = !timerRunning;
    const btn = document.getElementById("pauseResumeBtn");
    setIcon(btn, timerRunning ? "pause" : "play");
    // Pausing must stop the countdown the instant it's tapped, not just flip
    // a flag that tick() only checks on its next already-scheduled fire —
    // clearInterval() is what actually freezes the display right where it
    // is. The ring also needs its in-flight CSS transition killed
    // (freezeTimerRing), since clearInterval alone doesn't stop an already-
    // animating stroke-dasharray from gliding on to its last-set target.
    //
    // Resuming must feel instant, not wait out however much of the current
    // whole-second window is left (that could be up to ~1s if pause landed
    // right after a tick, which reads as exactly the "delay" this is fixing).
    // Cap the wait for the very next tick short regardless of tickElapsedMs
    // (captured on pause, below) — it costs a shaved fraction of a second off
    // one countdown step per pause/resume, imperceptible for a focus timer,
    // in exchange for resume always feeling immediate. Normal 1s cadence
    // resumes right after that first tick (see tick()'s own reschedule).
    clearInterval(timerInterval);
    if (timerRunning) {
      unfreezeTimerRing();
      const remainderMs = Math.min(Math.max(0, 1000 - tickElapsedMs), 150);
      lastTickAt = Date.now();
      scheduleTick(remainderMs);
    } else {
      tickElapsedMs = Date.now() - lastTickAt;
      freezeTimerRing();
    }
  });

  document.getElementById("stopSessionBtn").addEventListener("click", () => {
    showConfirm({
      title: "End session",
      message: "End this session early?",
      confirmLabel: "End Session",
      danger: true,
      onConfirm: endTimer
    });
  });

  document.getElementById("skipBreakBtn").addEventListener("click", () => {
    clearInterval(timerInterval);
    finishBreakPhase();
  });

  document.getElementById("startAnotherBtn").addEventListener("click", restartSameSession);
  document.getElementById("backToSetupBtn").addEventListener("click", endTimer);
  let reflectionDate = new Date();
  let reflectionReadOnly = false;
  let reflections = JSON.parse(localStorage.getItem("reflections")) || {};
  let lockedDays = JSON.parse(localStorage.getItem("lockedDays")) || [];

  function saveLockedDays() {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      // No separate write here — the only call site always immediately
      // follows with saveReflections(dateStr) for the same date, which
      // syncs the combined {wentWell, improve, locked} doc in one go
      // (the schema merges lock state onto the reflection doc).
      return;
    }
    localStorage.setItem("lockedDays", JSON.stringify(lockedDays));
  }

  function isDayLocked(dateStr) {
    return lockedDays.includes(dateStr);
  }

  function saveReflections(dateStr) {
    if (window.firestoreBridge && window.firestoreBridge.isSignedIn()) {
      if (dateStr) {
        window.firestoreBridge.syncReflection(dateStr, reflections[dateStr] || {}, lockedDays.includes(dateStr));
      }
      return;
    }
    localStorage.setItem("reflections", JSON.stringify(reflections));
  }

  function renderReflection() {
    document.getElementById("reflWeekday").textContent = reflectionDate.toLocaleDateString(undefined, { weekday: "long" });
    document.getElementById("reflFulldate").textContent = reflectionDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

    const dateStr = toDateStr(reflectionDate);
    const entry = reflections[dateStr] || { wentWell: "", improve: "" };
    document.getElementById("reflWentWell").value = entry.wentWell;
    document.getElementById("reflImprove").value = entry.improve;
    document.getElementById("reflFormError").classList.remove("show");

    document.getElementById("reflWentWell").disabled = reflectionReadOnly;
    document.getElementById("reflImprove").disabled = reflectionReadOnly;
    document.getElementById("reflSaveBtn").style.display = reflectionReadOnly ? "none" : "block";
    document.getElementById("reflBackBtn").style.display = reflectionReadOnly ? "block" : "none";
    document.getElementById("reflPrevDay").style.visibility = (reflectionReadOnly || pendingLockDate) ? "hidden" : "visible";
    document.getElementById("reflNextDay").style.visibility = (reflectionReadOnly || pendingLockDate) ? "hidden" : "visible";

    document.getElementById("reflEmptyIntro").style.display = Object.keys(reflections).length === 0 ? "block" : "none";
  }

  function startReflectionReveal() {
    const wentWellGroup = document.getElementById("reflWentWellGroup");
    const improveGroup = document.getElementById("reflImproveGroup");
    wentWellGroup.classList.add("reveal-pending");
    improveGroup.classList.add("reveal-pending");
    requestAnimationFrame(() => {
      wentWellGroup.classList.remove("reveal-pending");
    });
    setTimeout(() => {
      improveGroup.classList.remove("reveal-pending");
    }, 400);
  }

  document.getElementById("reflPrevDay").addEventListener("click", () => {
    reflectionDate.setDate(reflectionDate.getDate() - 1);
    renderReflection();
  });
  document.getElementById("reflNextDay").addEventListener("click", () => {
    reflectionDate.setDate(reflectionDate.getDate() + 1);
    renderReflection();
  });
  document.getElementById("reflWentWell").addEventListener("input", () => {
    document.getElementById("reflFormError").classList.remove("show");
  });
  document.getElementById("reflImprove").addEventListener("input", () => {
    document.getElementById("reflFormError").classList.remove("show");
  });
  document.getElementById("reflBackBtn").addEventListener("click", () => switchView("planner"));

  document.getElementById("viewReflectionLink").addEventListener("click", (e) => {
    e.stopPropagation();
    reflectionReadOnly = true;
    reflectionDate = new Date(currentDate);
    document.getElementById("reflectionView").style.transitionDuration = "";
    switchView("reflection");
    renderReflection();
  });

  // --- Reflection search (premium) ---
  function updateSearchReflectionsBtnVisibility() {
    document.getElementById("searchReflectionsBtn").style.display = isPremiumUser() ? "flex" : "none";
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatReflectionDate(dateStr) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }

  // Builds an ~80-100 char snippet centered on the match, with the match
  // itself wrapped in <mark>. Falls back to a plain leading snippet if the
  // query can't be found (shouldn't happen given the caller already matched).
  function buildReflectionSnippet(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) {
      const plain = escapeHtml(text.slice(0, 90));
      return plain + (text.length > 90 ? "…" : "");
    }
    const radius = 40;
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    const relIdx = idx - start;
    const before = escapeHtml(text.slice(start, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length, end));
    return (start > 0 ? "…" : "") + before + `<mark>${match}</mark>` + after + (end < text.length ? "…" : "");
  }

  function searchReflections(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    Object.keys(reflections).sort().reverse().forEach(dateStr => {
      const entry = reflections[dateStr] || {};
      const wentWell = entry.wentWell || "";
      const improve = entry.improve || "";
      const matchText = wentWell.toLowerCase().includes(q) ? wentWell
        : improve.toLowerCase().includes(q) ? improve
        : null;
      if (matchText !== null) {
        results.push({ dateStr, snippet: buildReflectionSnippet(matchText, query.trim()) });
      }
    });
    return results;
  }

  function openReflectionFromSearch(dateStr) {
    closeModal(reflectionSearchOverlay);
    reflectionReadOnly = true;
    reflectionDate = new Date(dateStr + "T00:00:00");
    document.getElementById("reflectionView").style.transitionDuration = "";
    switchView("reflection");
    renderReflection();
  }

  function renderReflectionSearchResults(query) {
    const wrap = document.getElementById("reflectionSearchResults");
    wrap.innerHTML = "";
    const trimmed = query.trim();
    if (!trimmed) {
      wrap.innerHTML = `<div class="reflection-search-empty">Type to search your past reflections.</div>`;
      return;
    }
    const results = searchReflections(trimmed);
    if (results.length === 0) {
      wrap.innerHTML = `<div class="reflection-search-empty">No reflections found for "${escapeHtml(trimmed)}".</div>`;
      return;
    }
    results.forEach(r => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "reflection-search-result pressable";
      row.innerHTML = `
        <div class="reflection-search-result-date">${formatReflectionDate(r.dateStr)}</div>
        <div class="reflection-search-result-snippet">${r.snippet}</div>
      `;
      row.addEventListener("click", () => openReflectionFromSearch(r.dateStr));
      wrap.appendChild(row);
    });
  }

  const reflectionSearchOverlay = document.getElementById("reflectionSearchModalOverlay");
  // Same drag-to-dismiss as the Add Task modal — enableModalDragDismiss()
  // is written against a generic overlay/modal pair, so this is just
  // another call, no changes to the function itself.
  enableModalDragDismiss(reflectionSearchOverlay);
  document.getElementById("searchReflectionsBtn").addEventListener("click", () => {
    if (!isPremiumUser()) return;
    const input = document.getElementById("reflectionSearchInput");
    input.value = "";
    renderReflectionSearchResults("");
    openModal(reflectionSearchOverlay);
    setTimeout(() => input.focus(), 50);
  });
  document.getElementById("reflectionSearchInput").addEventListener("input", (e) => {
    renderReflectionSearchResults(e.target.value);
  });
  document.getElementById("reflectionSearchCloseBtn").addEventListener("click", () => closeModal(reflectionSearchOverlay));
  reflectionSearchOverlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(reflectionSearchOverlay); });

  function showSealScreen(dateForDisplay, onDone) {
    const sealScreen = document.getElementById("sealScreen");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const check = new Date(dateForDisplay); check.setHours(0, 0, 0, 0);
    const diffDays = Math.round((check - today) / 86400000);
    let prefix = "";
    if (diffDays === 0) prefix = "Today, ";
    else if (diffDays === 1) prefix = "Tomorrow, ";
    else if (diffDays === -1) prefix = "Yesterday, ";
    const weekday = prefix + dateForDisplay.toLocaleDateString(undefined, { weekday: "long" });
    const fulldate = dateForDisplay.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    document.getElementById("sealDate").textContent = `${weekday}, ${fulldate}`;

    sealScreen.classList.add("visible");
    springScaleReveal(sealScreen.querySelector(".seal-icon"), 0.8);
    setTimeout(() => {
      sealScreen.classList.remove("visible");
      onDone();
    }, 1100);
  }

  function animateBannerIn() {
    const banner = document.getElementById("lockedBanner");
    banner.style.opacity = "0";
    banner.style.transform = "translateY(6px)";
    void banner.offsetWidth;
    requestAnimationFrame(() => {
      banner.style.opacity = "1";
      banner.style.transform = "translateY(0)";
    });
  }

  document.getElementById("reflSaveBtn").addEventListener("click", () => {
    const dateStr = toDateStr(reflectionDate);
    const wentWell = document.getElementById("reflWentWell").value.trim();
    const improve = document.getElementById("reflImprove").value.trim();

    if (dateStr === pendingLockDate) {
      if (!wentWell || !improve) {
        const err = document.getElementById("reflFormError");
        err.textContent = "Fill in both fields to end the day.";
        err.classList.add("show");
        return;
      }
      document.getElementById("reflFormError").classList.remove("show");
      triggerHaptic();
      lockedDays.push(dateStr);
      saveLockedDays();
      startTrialOnDayOneSeal();
      reflections[dateStr] = { wentWell, improve };
      saveReflections(dateStr);
      document.getElementById("reflWentWell").value = "";
      document.getElementById("reflImprove").value = "";

      showSealScreen(new Date(reflectionDate), () => {
        pendingLockDate = null;
        updateExportBtnVisibility();
        updateThemesBtnVisibility();
        updateSearchReflectionsBtnVisibility();
        renderAll();
        switchView("planner");
        setTimeout(animateBannerIn, 150);
      });
    } else {
      reflections[dateStr] = { wentWell, improve };
      saveReflections(dateStr);
      document.getElementById("reflWentWell").value = wentWell;
      document.getElementById("reflImprove").value = improve;
      showToast("Saved.", "info");
    }
  });
  let pendingLockDate = null;

  document.getElementById("endDayBtn").addEventListener("click", () => {
    const dateStr = toDateStr(currentDate);
    const dayTasks = getTasksForDate(currentDate, "All");
    const total = dayTasks.length;
    const done = dayTasks.filter(t => t.occurrenceDone).length;
    const unfinished = total - done;

    const statsHtml = `
      <div style="text-align:center;margin:0.75rem 0;">
        <div style="font-size:var(--text-2xl);font-weight:600;color:var(--text-primary);">${done} / ${total}</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">tasks completed</div>
        ${unfinished > 0 ? `<div style="font-size:var(--text-base);color:var(--warning);margin-top:0.5rem;">${unfinished} unfinished task${unfinished === 1 ? "" : "s"}</div>` : ""}
      </div>
    `;

    showConfirm({
      title: "End today?",
      message: "You can't check anything off after this.",
      statsHtml,
      confirmLabel: "End Day",
      danger: false,
      onConfirm: () => {
        pendingLockDate = dateStr;
        document.getElementById("exportDataBtn").style.display = "none";
        document.getElementById("themesBtn").style.display = "none";
        document.getElementById("searchReflectionsBtn").style.display = "none";
        reflectionReadOnly = false;
        document.getElementById("reflectionView").style.transitionDuration = "400ms";
        switchView("reflection");
        reflectionDate = new Date(currentDate);
        renderReflection();
        startReflectionReveal();
        document.getElementById("reflWentWell").focus();
        setTimeout(() => {
          document.getElementById("reflectionView").style.transitionDuration = "";
        }, 450);
      }
    });
  });

  // --- Onboarding ---
  const ONBOARDING_CATEGORY_PRESETS = ["Fitness", "Building/Business", "School/Work", "Deep Work", "Personal"];
  const ONBOARDING_AGE_OPTIONS = ["Under 16", "16–18", "19–24", "25+"];
  const ONBOARDING_IDENTITY_OPTIONS = [
    "Someone who shows up, even on the bad days",
    "Someone who finishes what they start",
    "Someone who can actually sit with one thing",
    "Someone who trusts their own systems, not their mood"
  ];

  let currentOnboardingStep = 1;
  let onboardingName = "";
  let onboardingCategories = [];
  let onboardingSeedTasks = [];
  let onboardingIdentity = "";
  let onboardingAgeBracket = "";
  let onboardingGoalName = "";
  let onboardingGoalCategory = "";
  let onboardingGoalCheckoff = "";
  let onboardingGoalWhy = "";
  let onboardingGoalPlan = "";
  let onboardingDailyTaskName = "";
  // Guards finalizeOnboardingData() against running more than once. Without
  // it, going back from the account-creation/verification step to the
  // synthesis step ("here's what we set up") and pressing "Let's go" again
  // re-pushed a fresh copy of every seed task and the goal task (categories
  // were already duplicate-guarded by name, tasks weren't) — real,
  // synced-to-Firestore duplicate data, not just a display glitch.
  let onboardingDataFinalized = false;
  // Single in-memory bag for onboarding's Firestore payload, built by
  // finalizeOnboardingData() and flushed by auth-ui.js right after account
  // creation succeeds (writeOnboardingData() in migrate.js). Never touches
  // localStorage.
  let onboardingDraft = null;

  function setMainAppVisible(visible) {
    document.querySelector(".container").style.display = visible ? "" : "none";
    document.getElementById("openAdd").style.display = visible ? "" : "none";
    document.getElementById("openAddGoal").style.display = visible ? "" : "none";
    document.getElementById("micBtn").style.display = visible ? "" : "none";
    document.getElementById("todayBtn").style.display = visible ? "" : "none";
  }

  // No haptic system existed in the app prior to this — navigator.vibrate is the real
  // web-platform API for this, and no-ops safely on devices/browsers without support.
  function triggerHaptic(intensity) {
    if (navigator.vibrate) navigator.vibrate(intensity === "light" ? 8 : 15);
  }

  function onboardingCategoryColor(catName) {
    const idx = ONBOARDING_CATEGORY_PRESETS.indexOf(catName);
    return PALETTE[idx % PALETTE.length];
  }

  const ONBOARDING_OPTION_ICONS = {
    "Under 16": "user",
    "16–18": "user",
    "19–24": "user",
    "25+": "user",
    "Someone who shows up, even on the bad days": "sunrise",
    "Someone who finishes what they start": "flag",
    "Someone who can actually sit with one thing": "anchor",
    "Someone who trusts their own systems, not their mood": "settings"
  };

  function styleOnboardingChip(row, selected) {
    row.classList.toggle("selected", selected);
  }

  function renderOnboardingChips(container, options, isSelected, onToggle) {
    container.innerHTML = "";
    options.forEach(option => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ob-row pressable";
      const iconWrap = document.createElement("span");
      iconWrap.className = "ob-row-icon";
      iconWrap.innerHTML = `<i data-lucide="${ONBOARDING_OPTION_ICONS[option] || "circle"}" class="icon"></i>`;
      const label = document.createElement("span");
      label.className = "ob-row-name";
      label.textContent = option;
      const check = document.createElement("span");
      check.className = "ob-row-check";
      row.appendChild(iconWrap);
      row.appendChild(label);
      row.appendChild(check);
      styleOnboardingChip(row, isSelected(option));
      row.addEventListener("click", () => {
        triggerHaptic("light");
        iconWrap.style.transform = "scale(1.12)";
        setTimeout(() => { iconWrap.style.transform = "scale(1)"; }, 200);
        onToggle(option);
        [...container.children].forEach((c, i) => styleOnboardingChip(c, isSelected(options[i])));
      });
      container.appendChild(row);
    });
    lucide.createIcons();
  }

  function updateOnboardingProgress() {
    const wrap = document.getElementById("onboardingProgressWrap");
    const stepIndicator = document.getElementById("onboardingStepIndicator");
    // The streak preview deliberately remains presentation-only, without a
    // progress indicator; all other setup steps show their real position.
    // Step 6 ("A couple more details") is itself skipped entirely when no
    // goal was entered on step 5, so it's dropped from the count too —
    // those users see "Step X of 7" instead of "Step X of 8".
    const PROGRESS_STEPS = onboardingGoalName ? [3, 4, 5, 6, 7, 8, 9, 10, 12] : [3, 4, 5, 7, 8, 9, 10, 12];
    const currentStepNum = PROGRESS_STEPS.indexOf(currentOnboardingStep) + 1;
    const showProgress = currentStepNum > 0;
    wrap.style.display = showProgress ? "block" : "none";
    if (showProgress) {
      const totalSteps = PROGRESS_STEPS.length;
      const pct = Math.round((currentStepNum / totalSteps) * 100);
      document.getElementById("onboardingProgressFill").style.width = pct + "%";
      stepIndicator.textContent = `Step ${currentStepNum} of ${totalSteps}`;
    }
  }

  function updateOnboardingBackButton() {
    const wrap = document.getElementById("onboardingBackWrap");
    const showBack = currentOnboardingStep > 1;
    wrap.style.display = showBack ? "block" : "none";
  }

  function goToOnboardingStep(n) {
    const content = document.getElementById("onboardingContent");
    content.style.opacity = "0";
    setTimeout(() => {
      currentOnboardingStep = n;
      renderOnboardingStep();
      content.style.opacity = "0";
      requestAnimationFrame(() => { content.style.opacity = "1"; });
    }, 180);
  }

  document.getElementById("onboardingBackBtn").addEventListener("click", () => {
    if (currentOnboardingStep <= 1) return;
    let target = currentOnboardingStep - 1;
    if (target === 6 && !onboardingGoalName) target = 5;
    goToOnboardingStep(target);
  });

  // Reads window.firebaseAuth (firebase-init.js) directly rather than
  // window.authBridge — authBridge is only assigned once auth-ui.js's
  // DOMContentLoaded handler runs, and this function is called from
  // app.js's "auth-state-resolved" listener, which fires as the very first
  // line inside onAuthStateChanged, with no DOMContentLoaded guarantee
  // ahead of it. A DOMContentLoaded race there previously made this
  // function see no bridge yet, silently return false, and let the
  // verification screen get skipped in favor of onboarding's default step
  // 1. firebaseAuth is set at firebase-init.js's module-evaluation time,
  // strictly before auth.js's onAuthStateChanged can ever fire, so it has
  // no equivalent race.
  function onboardingAccountNeedsEmailVerification() {
    const authInstance = window.firebaseAuth;
    if (!authInstance) return false;
    const user = authInstance.currentUser;
    if (!user) return false;
    const hasPasswordProvider = user.providerData.some(p => p.providerId === "password");
    return !user.emailVerified && hasPasswordProvider;
  }

  function advanceOnboardingAfterAccountStep() {
    if (onboardingAccountNeedsEmailVerification()) {
      renderOnboardingStep();
      return;
    }
    goToOnboardingStep(14);
  }

  document.addEventListener("onboarding-auth-changed", () => {
    if (currentOnboardingStep === 13) renderOnboardingStep();
  });

  function renderOnboardingStep() {
    updateOnboardingProgress();
    updateOnboardingBackButton();
    document.getElementById("onboardingView").classList.toggle("ob-emphasis-bg", currentOnboardingStep === 1 || currentOnboardingStep === 11);
    const content = document.getElementById("onboardingContent");
    const step = currentOnboardingStep;

    if (step === 1) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:5rem;text-align:center;">
          <div class="onboarding-hook-headline" id="obHookLine1">Hey.</div>
          <div class="onboarding-reveal" id="obHookLine2" style="font-size:var(--text-xl);font-weight:600;line-height:1.5;margin-bottom:0.5rem;">Most people don't have a real system for managing their time.</div>
          <div class="onboarding-reveal" id="obHookLine2Caption" style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:2.5rem;">A finding repeated across multiple independent workplace studies (Acuity Training and others).</div>
          <div class="onboarding-reveal" id="obHookPrompt">
            <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:1rem;">Feel like that's you?</div>
            <button type="button" id="obHookYeah" class="cat-pill">Let's fix that.</button>
          </div>
          <div class="onboarding-hook-subtext" id="obHookLine3">You're building something real. Most days, there's no system keeping track of it.</div>
          <button id="obContinue" class="start-focus-btn onboarding-reveal">Continue</button>
          <button type="button" id="obSignInEscape" style="display:block;margin:1.25rem auto 0;background:none;border:none;color:var(--text-muted);font-size:var(--text-xs);text-decoration:underline;cursor:pointer;font-family:inherit;">Already have an account? Sign in</button>
        </div>
      `;
      // obHookLine1 (.onboarding-hook-headline) and obHookLine3
      // (.onboarding-hook-subtext) are a different, out-of-scope category
      // of reveal — left on their existing CSS .ob-in transition, untouched.
      requestAnimationFrame(() => { document.getElementById("obHookLine1").classList.add("ob-in"); });
      setTimeout(() => {
        obRevealIn(document.getElementById("obHookLine2"));
        obRevealIn(document.getElementById("obHookLine2Caption"));
      }, 900);
      setTimeout(() => {
        obRevealIn(document.getElementById("obHookPrompt"));
      }, 3000);
      document.getElementById("obHookYeah").addEventListener("click", () => {
        const prompt = document.getElementById("obHookPrompt");
        obRevealOut(prompt);
        setTimeout(() => {
          prompt.style.display = "none";
          document.getElementById("obHookLine3").classList.add("ob-in");
          obRevealIn(document.getElementById("obContinue"));
        }, 250);
      });
      document.getElementById("obContinue").addEventListener("click", () => goToOnboardingStep(2));
      document.getElementById("obSignInEscape").addEventListener("click", () => {
        if (typeof window.openOnboardingSignInModal === "function") window.openOnboardingSignInModal();
      });

    } else if (step === 2) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:0.5rem;font-weight:500;">What should we call you?</label>
          <input type="text" id="obName" placeholder="Your name" value="${onboardingName}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:2rem;">
          <button id="obContinue" class="start-focus-btn"${onboardingName ? "" : " disabled"}>Continue</button>
        </div>
      `;
      const input = document.getElementById("obName");
      const btn = document.getElementById("obContinue");
      input.addEventListener("input", () => { btn.disabled = !input.value.trim(); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !btn.disabled) btn.click(); });
      btn.addEventListener("click", () => {
        onboardingName = input.value.trim();
        if (!onboardingName) return;
        goToOnboardingStep(3);
      });
      setTimeout(() => input.focus(), 50);

    } else if (step === 3) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;">How old are you?</div>
          <div id="obAgeChips" class="ob-row-list"></div>
          <button id="obContinue" class="start-focus-btn"${onboardingAgeBracket ? "" : " disabled"}>Continue</button>
        </div>
      `;
      const ageBtn = document.getElementById("obContinue");
      renderOnboardingChips(
        document.getElementById("obAgeChips"),
        ONBOARDING_AGE_OPTIONS,
        (option) => onboardingAgeBracket === option,
        (option) => {
          onboardingAgeBracket = option;
          ageBtn.disabled = !onboardingAgeBracket;
        }
      );
      ageBtn.addEventListener("click", () => { if (onboardingAgeBracket) goToOnboardingStep(4); });

    } else if (step === 4) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;">What kind of person do you want to become?</div>
          <div id="obIdentityChips" class="ob-row-list"></div>
          <button id="obContinue" class="start-focus-btn"${onboardingIdentity ? "" : " disabled"}>Continue</button>
        </div>
      `;
      const identityBtn2 = document.getElementById("obContinue");
      renderOnboardingChips(
        document.getElementById("obIdentityChips"),
        ONBOARDING_IDENTITY_OPTIONS,
        (option) => onboardingIdentity === option,
        (option) => {
          onboardingIdentity = option;
          identityBtn2.disabled = !onboardingIdentity;
        }
      );
      identityBtn2.addEventListener("click", () => { if (onboardingIdentity) goToOnboardingStep(5); });

    } else if (step === 5) {
      const identityLower = onboardingIdentity ? (onboardingIdentity.charAt(0).toLowerCase() + onboardingIdentity.slice(1)) : "someone new";
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;">You said you're becoming ${identityLower}. Time to make it real: one goal.</div>
          <input type="text" id="obGoalName" placeholder="What's one goal that would prove it?" value="${onboardingGoalName}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:1.5rem;">
          <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:0.5rem;font-weight:500;">What will you check off each day?</label>
          <input type="text" id="obGoalCheckoff" placeholder="e.g. Watch one episode" value="${onboardingGoalCheckoff}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:1.5rem;">
          <div id="obGoalCategoryChips" class="ob-row-list"></div>
          <button id="obContinue" class="start-focus-btn">${onboardingGoalName ? "Continue" : "Skip for now"}</button>
        </div>
      `;
      const goalNameInput = document.getElementById("obGoalName");
      const goalCheckoffInput = document.getElementById("obGoalCheckoff");
      const catChipsWrap = document.getElementById("obGoalCategoryChips");
      const goalContinueBtn = document.getElementById("obContinue");
      goalNameInput.addEventListener("input", () => {
        goalContinueBtn.textContent = goalNameInput.value.trim() ? "Continue" : "Skip for now";
      });
      ONBOARDING_CATEGORY_PRESETS.forEach(name => {
        const color = onboardingCategoryColor(name);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ob-row pressable";
        const swatch = document.createElement("span");
        swatch.className = "ob-row-swatch";
        swatch.style.background = color;
        const label = document.createElement("span");
        label.className = "ob-row-name";
        label.textContent = name;
        const check = document.createElement("span");
        check.className = "ob-row-check";
        row.appendChild(swatch);
        row.appendChild(label);
        row.appendChild(check);
        const styleSelf = () => {
          row.classList.toggle("selected", onboardingGoalCategory === name);
        };
        styleSelf();
        row.addEventListener("click", () => {
          onboardingGoalCategory = name;
          triggerHaptic("light");
          swatch.style.transform = "scale(1.15)";
          setTimeout(() => { swatch.style.transform = "scale(1)"; }, 200);
          [...catChipsWrap.children].forEach(r => r.classList.toggle("selected", r === row));
        });
        catChipsWrap.appendChild(row);
      });
      goalContinueBtn.addEventListener("click", () => {
        onboardingGoalName = goalNameInput.value.trim();
        onboardingGoalCheckoff = onboardingGoalName ? goalCheckoffInput.value.trim() : "";
        if (!onboardingGoalName) onboardingGoalCategory = "";
        goToOnboardingStep(onboardingGoalName ? 6 : 7);
      });

    } else if (step === 6) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;">A couple more details.</div>
          <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:0.5rem;font-weight:500;">Why does this goal matter to you?</label>
          <input type="text" id="obGoalWhy" placeholder="Be specific" value="${onboardingGoalWhy}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:1.5rem;">
          <label style="display:block;font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:0.5rem;font-weight:500;">How do you plan on achieving it?</label>
          <input type="text" id="obGoalPlan" placeholder="Be specific" value="${onboardingGoalPlan}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:1.5rem;">
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:1.5rem;">This becomes your first tracked goal, a daily repeat you can adjust anytime in the Goals tab.</div>
          <button id="obContinue" class="start-focus-btn">Continue</button>
        </div>
      `;
      const goalWhyInput = document.getElementById("obGoalWhy");
      const goalPlanInput = document.getElementById("obGoalPlan");
      document.getElementById("obContinue").addEventListener("click", () => {
        onboardingGoalWhy = onboardingGoalName ? goalWhyInput.value.trim() : "";
        onboardingGoalPlan = onboardingGoalName ? goalPlanInput.value.trim() : "";
        goToOnboardingStep(7);
      });

    } else if (step === 7) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div class="onboarding-reveal" id="obTrackLeadIn" style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:0.5rem;">Now let's set up a few tasks.</div>
          <div class="onboarding-reveal" id="obTrackHeadline" style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;">What do you want to track?</div>
          <div id="obCategoryChips" class="ob-row-list"></div>
          <button id="obContinue" class="start-focus-btn" ${onboardingCategories.length ? "" : "disabled"}>Continue</button>
        </div>
      `;
      requestAnimationFrame(() => { obRevealIn(document.getElementById("obTrackLeadIn")); });
      setTimeout(() => { obRevealIn(document.getElementById("obTrackHeadline")); }, 200);
      const chipsWrap = document.getElementById("obCategoryChips");
      const btn = document.getElementById("obContinue");
      ONBOARDING_CATEGORY_PRESETS.forEach(name => {
        const color = onboardingCategoryColor(name);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ob-row pressable";
        const swatch = document.createElement("span");
        swatch.className = "ob-row-swatch";
        swatch.style.background = color;
        const label = document.createElement("span");
        label.className = "ob-row-name";
        label.textContent = name;
        const check = document.createElement("span");
        check.className = "ob-row-check";
        row.appendChild(swatch);
        row.appendChild(label);
        row.appendChild(check);
        const styleSelf = () => {
          row.classList.toggle("selected", onboardingCategories.includes(name));
        };
        styleSelf();
        row.addEventListener("click", () => {
          const idx = onboardingCategories.indexOf(name);
          if (idx === -1) onboardingCategories.push(name); else onboardingCategories.splice(idx, 1);
          triggerHaptic("light");
          swatch.style.transform = "scale(1.15)";
          setTimeout(() => { swatch.style.transform = "scale(1)"; }, 200);
          styleSelf();
          btn.disabled = !onboardingCategories.length;
        });
        chipsWrap.appendChild(row);
      });
      btn.addEventListener("click", () => {
        if (onboardingCategories.length) goToOnboardingStep(8);
      });

    } else if (step === 8) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.5rem;">Let's get specific.</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:1.5rem;">One per category. You can always add more later.</div>
          <div id="obSeedRows"></div>
          <button id="obContinue" class="start-focus-btn" style="margin-top:1rem;">Skip for now</button>
        </div>
      `;
      const rowsWrap = document.getElementById("obSeedRows");
      const continueBtn = document.getElementById("obContinue");
      const updateSeedContinueLabel = () => {
        const hasText = [...rowsWrap.querySelectorAll(".ob-seed-row")].some(row => {
          const skipBtn = row.querySelector(".ob-skip-row");
          const input = row.querySelector(".ob-seed-input");
          return skipBtn.dataset.skipped !== "true" && input.value.trim();
        });
        continueBtn.textContent = hasText ? "Continue" : "Skip for now";
      };
      onboardingCategories.forEach(catName => {
        const color = onboardingCategoryColor(catName);
        const existing = onboardingSeedTasks.find(t => t.category === catName);
        const row = document.createElement("div");
        row.className = "ob-seed-row";
        row.dataset.cat = catName;
        row.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;transition:opacity 0.15s ease;";
        row.innerHTML = `
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <input type="text" class="ob-seed-input" placeholder="something you'd do for ${catName}" value="${existing ? existing.taskName : ""}" style="flex:1;padding:0.55rem 0.7rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;">
          <button type="button" class="ob-skip-row" style="background:none;border:none;color:var(--text-muted);font-size:var(--text-xs);text-decoration:underline;cursor:pointer;font-family:inherit;white-space:nowrap;">skip this one</button>
        `;
        rowsWrap.appendChild(row);

        const skipBtn = row.querySelector(".ob-skip-row");
        const input = row.querySelector(".ob-seed-input");
        skipBtn.dataset.skipped = "false";
        skipBtn.addEventListener("click", () => {
          const nowSkipped = skipBtn.dataset.skipped === "true";
          skipBtn.dataset.skipped = nowSkipped ? "false" : "true";
          skipBtn.textContent = nowSkipped ? "skip this one" : "skipped";
          input.disabled = !nowSkipped;
          row.style.opacity = nowSkipped ? "1" : "0.5";
          updateSeedContinueLabel();
        });
        input.addEventListener("input", updateSeedContinueLabel);
      });
      updateSeedContinueLabel();

      continueBtn.addEventListener("click", () => {
        onboardingSeedTasks = [];
        rowsWrap.querySelectorAll(".ob-seed-row").forEach(row => {
          const skipBtn = row.querySelector(".ob-skip-row");
          const input = row.querySelector(".ob-seed-input");
          if (skipBtn.dataset.skipped === "true") return;
          const val = input.value.trim();
          if (val) onboardingSeedTasks.push({ category: row.dataset.cat, taskName: val });
        });
        goToOnboardingStep(9);
      });

    } else if (step === 9) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;line-height:1.8;margin-bottom:2.5rem;">
            <div id="obSolvesHeader" class="onboarding-reveal" style="font-size:var(--text-2xl);color:var(--accent);margin-bottom:1rem;"></div>
            <div id="obSolvesLines" class="onboarding-reveal">
              <div id="obSolvesLine1" style="margin-bottom:1rem;"></div>
              <div id="obSolvesLine2" style="margin-bottom:1rem;"></div>
              <div id="obSolvesLine3"></div>
            </div>
          </div>
          <button id="obContinue" class="start-focus-btn">Continue</button>
        </div>
      `;
      requestAnimationFrame(() => { obRevealIn(document.getElementById("obSolvesHeader")); });
      setTimeout(() => { obRevealIn(document.getElementById("obSolvesLines")); }, 200);
      const genericLines = [
        "The streak reflects what you actually complete, a real record, not a plan.",
        "Deep Work locks out everything but one task.",
        "Reflection ends the day. No editing after."
      ];
      const firstSeedTask = onboardingSeedTasks.find(t => t.taskName && t.taskName.trim());
      let headerText = "";
      let lines = genericLines;
      if (firstSeedTask) {
        headerText = `You just added "${firstSeedTask.taskName}" under ${firstSeedTask.category}.`;
        lines = [
          "Complete it today, and it counts toward a streak.",
          "Run a Deep Work session on it, and everything else disappears until it's done.",
          "Reflect tonight, and today locks in. No editing after."
        ];
      } else if (onboardingCategories.length) {
        headerText = `You set up ${onboardingCategories.join(", ")}. Here's what happens from here:`;
      }
      const headerEl = document.getElementById("obSolvesHeader");
      if (headerText) {
        headerEl.textContent = headerText;
      } else {
        headerEl.style.display = "none";
      }
      document.getElementById("obSolvesLine1").textContent = lines[0];
      document.getElementById("obSolvesLine2").textContent = lines[1];
      document.getElementById("obSolvesLine3").textContent = lines[2];
      document.getElementById("obContinue").addEventListener("click", () => goToOnboardingStep(10));

    } else if (step === 10) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.75rem;">Build your first habit.</div>
          <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:1.5rem;line-height:1.6;">Pick one thing to do every day. Completing it keeps your streak alive.</div>
          <input type="text" id="obDailyTask" placeholder="e.g. Read for 20 minutes" value="${onboardingDailyTaskName}" style="width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-size:var(--text-base);font-family:inherit;margin-bottom:0.5rem;">
          <div class="field-error" id="obDailyTaskError">Enter something. Even one small habit counts.</div>
          <button id="obContinue" class="start-focus-btn" style="margin-top:1rem;">Continue</button>
        </div>
      `;
      const dailyInput = document.getElementById("obDailyTask");
      const dailyContinueBtn = document.getElementById("obContinue");
      const dailyError = document.getElementById("obDailyTaskError");
      dailyInput.addEventListener("input", () => {
        onboardingDailyTaskName = dailyInput.value;
        if (dailyInput.value.trim()) dailyError.classList.remove("show");
      });
      dailyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") dailyContinueBtn.click(); });
      dailyContinueBtn.addEventListener("click", () => {
        const trimmed = dailyInput.value.trim();
        if (!trimmed) {
          dailyError.classList.add("show");
          return;
        }
        onboardingDailyTaskName = trimmed;
        goToOnboardingStep(11);
      });
      setTimeout(() => dailyInput.focus(), 50);

    } else if (step === 11) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;text-align:center;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.75rem;">Your first streak starts tonight.</div>
          <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:1.5rem;">Complete at least one task each day to keep your streak alive.</div>
          <div id="obDemoDots" style="display:flex;gap:6px;justify-content:center;margin-bottom:0.75rem;"></div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:2.5rem;">Day 1 unlocks after your first completed day.</div>
          <button id="obContinue" class="start-focus-btn">Continue</button>
        </div>
      `;
      const dotsWrap = document.getElementById("obDemoDots");
      for (let i = 0; i < 7; i++) {
        const dot = document.createElement("div");
        // No dot is ever pre-filled as done here — nothing's been earned
        // yet. The first dot (today) gets a distinct "ready to start"
        // outline/pulse instead, same honesty standard as streak freeze:
        // never show progress before it's real.
        dot.className = i === 0 ? "goal-dot today-ready" : "goal-dot future";
        dotsWrap.appendChild(dot);
      }
      document.getElementById("obContinue").addEventListener("click", () => goToOnboardingStep(12));

    } else if (step === 12) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;text-align:center;">
          <div id="obSynthesisHeading" style="font-size:var(--text-xl);font-weight:600;margin-bottom:1.5rem;"></div>
          <div style="text-align:left;">
            <div class="ob-section-label">Your setup</div>
            <div id="obSynthesisCategories"></div>
          </div>
          <button id="obContinue" class="start-focus-btn" style="margin-top:2rem;">Let's go</button>
        </div>
      `;
      document.getElementById("obSynthesisHeading").textContent = `${onboardingName}, here's what we set up:`;
      const catsWrap = document.getElementById("obSynthesisCategories");
      onboardingCategories.forEach(catName => {
        const seedTask = onboardingSeedTasks.find(t => t.category === catName);
        const row = document.createElement("div");
        row.className = "ob-readonly-row";
        const swatch = document.createElement("span");
        swatch.className = "ob-readonly-swatch";
        swatch.style.background = onboardingCategoryColor(catName);
        const info = document.createElement("div");
        info.className = "ob-readonly-info";
        const label = document.createElement("span");
        label.className = "ob-readonly-name";
        label.textContent = catName;
        const sub = document.createElement("span");
        sub.className = "ob-readonly-sub";
        sub.textContent = seedTask ? seedTask.taskName : "No task added yet. Add one in the Planner.";
        info.appendChild(label);
        info.appendChild(sub);
        row.appendChild(swatch);
        row.appendChild(info);
        catsWrap.appendChild(row);
      });
      document.getElementById("obContinue").addEventListener("click", () => {
        finalizeOnboardingData();
        goToOnboardingStep(13);
      });

    } else if (step === 13) {
      // Reuses the exact same #authModalOverlay/openAuthModal("signup")
      // Settings already uses (window.openOnboardingAuthModal, exposed by
      // auth-ui.js) rather than rebuilding a Google/email form here.
      // auth-ui.js flushes finalizeOnboardingData()'s in-memory draft
      // (getOnboardingDraft(), a window-exposed top-level function) straight
      // to Firestore right after signup succeeds — runMigrationIfNeeded() is
      // deliberately skipped for this sign-in (see auth.js's
      // skipNextMigration()), since there's no localStorage draft for it to
      // import.
      const authUser = window.authBridge && window.authBridge.getCurrentUser ? window.authBridge.getCurrentUser() : null;
      if (authUser && !onboardingAccountNeedsEmailVerification()) {
        goToOnboardingStep(14);
        return;
      }
      if (authUser && onboardingAccountNeedsEmailVerification()) {
        content.innerHTML = `
          <div class="onboarding-container" style="padding-top:4rem;">
            <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.75rem;">Verify your email.</div>
            <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:1.5rem;line-height:1.6;">We sent a verification link to <strong id="obVerifyEmail" style="color:var(--text-primary);"></strong>. Open it, then come back here and tap the button below.</div>
            <div id="obVerifyStatus" style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:1rem;min-height:1.25rem;"></div>
            <button id="obCheckVerifiedBtn" class="start-focus-btn">I've verified my email</button>
            <button id="obResendVerifyBtn" class="auth-mode-toggle" style="margin-top:1rem;">Resend verification email</button>
            <button id="obWrongEmailBtn" class="auth-mode-toggle" style="margin-top:0.5rem;color:var(--text-muted);font-size:var(--text-xs);">Wrong email? Start over</button>
          </div>
        `;
        document.getElementById("obVerifyEmail").textContent = authUser.email || "your email";
        const statusEl = document.getElementById("obVerifyStatus");
        document.getElementById("obCheckVerifiedBtn").addEventListener("click", async () => {
          const btn = document.getElementById("obCheckVerifiedBtn");
          btn.disabled = true;
          statusEl.textContent = "Checking…";
          try {
            const fresh = await window.authBridge.reloadCurrentUser();
            if (fresh && fresh.emailVerified) {
              showToast("Email verified. You're all set.", "success");
              goToOnboardingStep(14);
            } else {
              statusEl.textContent = "Not verified yet. Check your inbox (and spam), click the link, then try again.";
            }
          } catch (err) {
            statusEl.textContent = "Couldn't check verification status. Try again in a moment.";
          } finally {
            btn.disabled = false;
          }
        });
        document.getElementById("obResendVerifyBtn").addEventListener("click", async () => {
          const btn = document.getElementById("obResendVerifyBtn");
          btn.disabled = true;
          statusEl.textContent = "";
          try {
            await window.authBridge.sendVerificationEmail();
            showToast("Verification email sent.", "success");
          } catch (err) {
            const code = err && err.code ? err.code : "";
            statusEl.textContent = code === "auth/too-many-requests"
              ? "Too many attempts. Wait a few minutes, then try again."
              : "Couldn't send the email. Try again shortly.";
          } finally {
            btn.disabled = false;
          }
        });
        document.getElementById("obWrongEmailBtn").addEventListener("click", async () => {
          const btn = document.getElementById("obWrongEmailBtn");
          btn.disabled = true;
          statusEl.textContent = "";
          try {
            // deleteCurrentUser() handles session cleanup itself (Firebase
            // signs the user out as part of deleting them) — no explicit
            // sign-out needed, and none should happen first, since that
            // would leave the account behind undeleted.
            await window.authBridge.deleteCurrentUser();
            if (typeof window.authBridge.clearAuthCredentialFields === "function") {
              window.authBridge.clearAuthCredentialFields();
            }
            // Only the auth credentials are reset here — onboardingDraft
            // and every other in-memory onboarding field (name, identity,
            // ageBracket, categories, tasks, goal/anchor task) are left
            // exactly as finalizeOnboardingData() built them on step 12, so
            // step 13 re-renders as a fresh account-creation prompt with the
            // rest of onboarding untouched.
            goToOnboardingStep(13);
          } catch (err) {
            statusEl.textContent = "Could not remove account, please try again.";
            btn.disabled = false;
          }
        });
      } else {
        content.innerHTML = `
          <div class="onboarding-container" style="padding-top:4rem;">
            <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.75rem;">Save your progress.</div>
            <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:2rem;line-height:1.6;">Create an account so today's setup (tasks, goals, streaks) is backed up and available on any device.</div>
            <button id="obCreateAccountBtn" class="start-focus-btn">Create account</button>
          </div>
        `;
        document.getElementById("obCreateAccountBtn").addEventListener("click", () => {
          if (typeof window.openOnboardingAuthModal === "function") window.openOnboardingAuthModal();
        });
      }

    } else if (step === 14) {
      content.innerHTML = `
        <div class="onboarding-container" style="padding-top:4rem;">
          <div style="font-size:var(--text-xl);font-weight:600;margin-bottom:0.75rem;">Your first 7 days are on us.</div>
          <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:1rem;line-height:1.6;">Every premium feature (themes, deep work history, weekly recaps, and more) is unlocked for 7 days once you complete Day 1.</div>
          <div style="font-size:var(--text-md);color:var(--text-secondary);margin-bottom:2rem;line-height:1.6;">No card required to start.</div>
          <button id="obContinue" class="start-focus-btn">Continue</button>
        </div>
      `;
      document.getElementById("obContinue").addEventListener("click", () => completeOnboarding());
    }
  }

  function finalizeOnboardingData() {
    if (onboardingDataFinalized) return;
    onboardingDataFinalized = true;

    const draftCategories = onboardingCategories.map(catName => (
      { name: catName, color: onboardingCategoryColor(catName) }
    ));

    const draftTasks = [];
    const today = toDateStr(new Date());
    onboardingSeedTasks.forEach(({ category, taskName }) => {
      draftTasks.push({
        name: taskName, category, time: "", duration: "", date: today, endDate: "",
        done: false, order: draftTasks.length, recurrence: { type: "none" }, completedDates: [], isGoal: false
      });
    });

    if (onboardingGoalName) {
      if (onboardingGoalCategory && !draftCategories.some(c => c.name === onboardingGoalCategory)) {
        draftCategories.push({ name: onboardingGoalCategory, color: onboardingCategoryColor(onboardingGoalCategory) });
      }
      const goalCategory = onboardingGoalCategory || (draftCategories[0] ? draftCategories[0].name : "");
      const endD = new Date(today + "T00:00:00");
      endD.setDate(endD.getDate() + 30);
      draftTasks.push({
        name: onboardingGoalName, category: goalCategory, time: "", duration: "",
        date: today, endDate: toDateStr(endD),
        done: false, order: draftTasks.length, recurrence: { type: "daily" }, completedDates: [],
        isGoal: true, checkoffLabel: onboardingGoalCheckoff || onboardingGoalName, why: onboardingGoalWhy, plan: onboardingGoalPlan
      });
    }

    if (onboardingDailyTaskName && onboardingDailyTaskName.trim()) {
      draftTasks.push({
        name: onboardingDailyTaskName.trim(),
        category: draftCategories[0] ? draftCategories[0].name : "",
        time: "", duration: "", date: today, endDate: "",
        done: false, order: draftTasks.length, recurrence: { type: "daily" }, completedDates: [], isGoal: false
      });
    }

    // Held in memory only. auth-ui.js reads this via getOnboardingDraft()
    // and writes it straight to Firestore right after account creation
    // succeeds (writeOnboardingData() in migrate.js) — nothing here ever
    // touches localStorage.
    onboardingDraft = {
      name: onboardingName,
      identity: onboardingIdentity,
      ageBracket: onboardingAgeBracket,
      categories: draftCategories,
      tasks: draftTasks
    };
  }

  function getOnboardingDraft() {
    return onboardingDraft;
  }

  function completeOnboarding() {
    localStorage.setItem("onboardingComplete", "true");
    onboardingDraft = null;
    document.getElementById("onboardingView").classList.remove("visible");
    document.body.classList.remove("onboarding-active");
    renderAll();
    switchView("planner");
  }

  // --- Firestore sync (signed-in users only) ---
  // app.js is a classic script and always finishes running — including the
  // localStorage-based bootstrap render below — before firestore-sync.js
  // (a deferred module script) even starts, so auth state is never known
  // yet at that point. These listeners are registered now (safe regardless
  // of load order — dispatch always happens later) and swap in the real
  // data once firestore-sync.js knows it.
  function rerenderCurrentView() {
    renderAll();
    if (currentView === "goals") renderGoals();
    else if (currentView === "analysis") renderAnalysis();
    else if (currentView === "reflection") renderReflection();
    else if (currentView === "focus") renderFocus();
  }

  function hydrateFromFirestore() {
    if (!window.firestoreBridge || !window.firestoreBridge.isSignedIn()) return;
    hasBeenSignedInThisSession = true;
    tasks = window.firestoreBridge.getTasks();
    categories = window.firestoreBridge.getCategories();
    reflections = window.firestoreBridge.getReflections();
    lockedDays = window.firestoreBridge.getLockedDays();
    customPresets = window.firestoreBridge.getCustomPresets();
    localSelectedTheme = window.firestoreBridge.getSelectedTheme();
    applySelectedTheme();
    // deepWorkSessions isn't a cached top-level variable — getDeepWorkSessions()
    // still branches live off window.firestoreBridge, so there's nothing to
    // reassign here for it.

    // A signed-in-but-unverified user must never reach the planner — not
    // even via a stale currentOnboardingStep. That variable lives in memory
    // only and resets to 1 on every page load/refresh, so a mid-verification
    // refresh (or an existing unverified account signing in from step 1's
    // escape hatch) would otherwise miss the `=== 13` check below entirely
    // and fall straight into the "onboarding complete" branch, flipping
    // onboardingComplete to true and routing to the planner while
    // emailVerified is still false. Checking the real Firebase state here
    // instead of the step counter closes that hole regardless of which step
    // the in-memory counter happens to be on.
    if (onboardingAccountNeedsEmailVerification()) {
      document.body.classList.add("onboarding-active");
      document.getElementById("onboardingView").classList.add("visible");
      currentOnboardingStep = 13;
      renderOnboardingStep();
      return;
    }

    const wasOnboarding = document.body.classList.contains("onboarding-active");
    if (wasOnboarding && categories.length > 0) {
      // Signing up on the account-creation step (13) migrates this
      // session's local data in, landing right here with categories now
      // populated. Let step 13's own logic decide whether that means
      // advancing to the trial-explainer step (14) or showing the
      // verification screen first, instead of the general case below,
      // which would otherwise skip past both.
      if (currentOnboardingStep === 13) {
        advanceOnboardingAfterAccountStep();
      } else {
        localStorage.setItem("onboardingComplete", "true");
        onboardingDraft = null;
        document.getElementById("onboardingView").classList.remove("visible");
        document.body.classList.remove("onboarding-active");
        switchView("planner");
      }
    }

    rerenderCurrentView();
  }

  // Only true once we've actually seen a signed-in state this session —
  // guards clearLocalDataOnSignOut() so it never fires for someone who was
  // simply never signed in (every fresh, account-less visit would otherwise
  // wipe local data on load, since "signed out" is also the default state
  // before any sign-in has happened).
  let hasBeenSignedInThisSession = false;

  function clearLocalDataOnSignOut() {
    tasks = [];
    categories = [];
    reflections = {};
    lockedDays = [];
    customPresets = [];
    localDeepWorkSessions = [];
    localSelectedTheme = null;
    localStorage.removeItem("tasks");
    localStorage.removeItem("categories");
    localStorage.removeItem("reflections");
    localStorage.removeItem("lockedDays");
    localStorage.removeItem("customPresets");
    localStorage.removeItem("deepWorkSessions");
    localStorage.removeItem("selectedTheme");
    // TEMPORARY: isPremium is still a client-editable localStorage flag
    // (roadmap #8 moves this to users/{uid}/billing/status, server-written
    // only). Until then, sign-out must clear it here too, or a signed-out
    // user keeps whatever premium state they last had. When #8 ships, this
    // reset needs to carry over to whatever clears the real billing doc's
    // local mirror on sign-out — don't let it get dropped in that migration.
    localStorage.removeItem("isPremium");
    applySelectedTheme();
    rerenderCurrentView();
  }

  // Set by auth-ui.js immediately before calling signInWithGoogle() on the
  // onboarding create-account screen, cleared right after it determines
  // whether the resulting account is actually new. Firestore's onSnapshot
  // listeners can resolve (often from local cache, near-instantly for an
  // account that's been signed into on this device before) and dispatch
  // firestore-data-changed — repeatedly, once per collection, well before
  // auth-ui.js's own await chain gets a chance to react to the same sign-in
  // — without this guard on BOTH listeners below, an existing-account
  // collision could hydrate real account data and advance/exit onboarding
  // before auth-ui.js's isNewUser check and sign-out ever run. Guarding only
  // firestore-auth-ready isn't enough: firestore-data-changed fires first
  // and far more often (once per collection, up to 8 times), so it wins
  // this race every time if left unguarded.
  window.pendingGoogleAccountCheck = false;

  // Removes the CSS-only "app-loading" gate (styles.css) that keeps both
  // .container and #onboardingView invisible from first paint — added so
  // the synchronous, localStorage-only bootstrap render below never has a
  // chance to be seen before auth state resolves it needs correcting.
  // Idempotent, so every call site below can call it unconditionally.
  let appRevealed = false;
  function revealApp() {
    if (appRevealed) return;
    appRevealed = true;
    document.body.classList.remove("app-loading");
  }

  // auth.js's "auth-state-resolved" (see auth.js) fires synchronously as
  // soon as Firebase itself resolves — before auth.js's own migration check
  // (a real getDoc() network read) and well before firestore-sync's 6
  // Firestore listeners below have a chance to fire, which is what was
  // previously leaving the app invisible for several seconds on every load.
  // This is the ONLY signal fast enough to correct the one case that must
  // never flash step 1: a signed-in, unverified user refreshing mid-
  // verification. onboardingAccountNeedsEmailVerification() depends only on
  // Firebase Auth state (not Firestore data), so it's safe to decide and
  // render here immediately. Every other bootstrap guess (fresh onboarding,
  // already-onboarded planner) is correct as constructed or self-corrects
  // later via hydrateFromFirestore() once real data arrives — per product
  // decision, only the verification screen needs refresh-restoration.
  document.addEventListener("auth-state-resolved", () => {
    if (onboardingAccountNeedsEmailVerification()) {
      document.body.classList.add("onboarding-active");
      document.getElementById("onboardingView").classList.add("visible");
      currentOnboardingStep = 13;
      renderOnboardingStep();
    }
    revealApp();
  });

  document.addEventListener("firestore-auth-ready", (e) => {
    if (e.detail.signedIn) {
      if (window.pendingGoogleAccountCheck) return;
      hydrateFromFirestore();
    } else if (hasBeenSignedInThisSession) {
      hasBeenSignedInThisSession = false;
      clearLocalDataOnSignOut();
    }
    revealApp();
  });
  document.addEventListener("firestore-data-changed", () => {
    if (window.pendingGoogleAccountCheck) return;
    hydrateFromFirestore();
    revealApp();
  });

  // These four overlays' own open/close/field logic lives entirely in
  // auth-ui.js, which deliberately stays self-contained from app.js's
  // globals (see its own top-of-file comment) — so this drag-dismiss
  // wiring lives here instead of adding a new app.js dependency into that
  // file. enableModalDragDismiss() only needs the overlay element itself
  // (the shared .modal-overlay/.modal/h3 structure and .open class
  // convention), so this is safe without touching auth-ui.js at all. Same
  // generic overlay/modal pair the function is already written against, no
  // changes to the function itself.
  enableModalDragDismiss(document.getElementById("settingsModalOverlay"));
  enableModalDragDismiss(document.getElementById("changePasswordModalOverlay"));
  enableModalDragDismiss(document.getElementById("reauthModalOverlay"));
  enableModalDragDismiss(document.getElementById("authModalOverlay"));

  if (localStorage.getItem("onboardingComplete") !== "true" && categories.length === 0) {
    document.body.classList.add("onboarding-active");
    document.getElementById("onboardingView").classList.add("visible");
    renderOnboardingStep();
  } else {
    renderAll();
    maybeShowWeeklyRecapBanner();
  }
  lucide.createIcons();
