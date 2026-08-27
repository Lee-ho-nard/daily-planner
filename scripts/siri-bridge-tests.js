// Manual test harness for the Siri Shortcuts JS bridge (see app.js's
// "--- Siri Shortcuts JS bridge ---" section: createTaskFromSiri,
// startDeepWorkFromSiri, completeTaskFromSiri, getTodaysPlanFromSiri).
//
// This isn't wired into a test runner — there isn't one in this project.
// Run it by pasting this whole file into the browser devtools console (or a
// javascript_exec call) while the app is loaded at localhost. It reads/
// writes the same `tasks`/`categories`/`customPresets` globals app.js itself
// uses (classic <script>, shared global scope — not window.-prefixed), so
// it must run in that same page, not a separate context.
//
// It snapshots real app state first and restores it (with a final save())
// when done, so it's safe to run against a real signed-in/local dataset —
// nothing it creates should be left behind afterward.

function runSiriBridgeTests() {
  const results = [];
  function check(label, condition) {
    results.push({ label, pass: !!condition });
  }

  // --- snapshot real state ---
  const snapshot = {
    tasks: JSON.parse(JSON.stringify(tasks)),
    categories: JSON.parse(JSON.stringify(categories)),
    customPresets: JSON.parse(JSON.stringify(customPresets)),
    selectedSession
  };

  function restoreSnapshot() {
    tasks = snapshot.tasks;
    categories = snapshot.categories;
    customPresets = snapshot.customPresets;
    selectedSession = snapshot.selectedSession;
    save();
  }

  try {
    categories = [
      { name: "Work", color: "#4f8cff" },
      { name: "Fitness", color: "#ff6b6b" },
      { name: "Personal", color: "#8b5cf6" }
    ];
    tasks = [];

    // --- createTaskFromSiri: full parameter set ---
    const r1 = createTaskFromSiri({
      name: "Write report",
      category: "Work",
      time: new Date(2026, 0, 1, 14, 30),
      durationMinutes: 45,
      date: new Date(2026, 0, 2),
      repeatDaily: true
    });
    check("full params: success", r1.success === true);
    check("full params: category matched exactly", r1.category === "Work" && r1.categoryWasMatched === true);
    check("full params: repeatsDaily reported", r1.repeatsDaily === true);
    const created1 = tasks.find(t => t.id === r1.taskId);
    check("full params: time formatted HH:MM", !!created1 && created1.time === "14:30");
    check("full params: duration stringified", !!created1 && created1.duration === "45");
    check("full params: date formatted", !!created1 && created1.date === "2026-01-02");
    check("full params: recurrence daily", !!created1 && created1.recurrence.type === "daily");

    // --- createTaskFromSiri: missing name errors clearly ---
    const rNoName = createTaskFromSiri({});
    check("missing name: rejected", rNoName.success === false && !!rNoName.error);

    // --- createTaskFromSiri: all optional params omitted, defaults correctly ---
    tasks = [];
    const r2 = createTaskFromSiri({ name: "Quick task" });
    check("defaults: success", r2.success === true);
    check("defaults: falls back to first category", r2.category === "Work" && r2.categoryWasMatched === false);
    const created2 = tasks.find(t => t.id === r2.taskId);
    check("defaults: time empty", !!created2 && created2.time === "");
    check("defaults: duration empty", !!created2 && created2.duration === "");
    check("defaults: date is actual today", !!created2 && created2.date === toDateStr(new Date()));
    check("defaults: recurrence none", !!created2 && created2.recurrence.type === "none");
    check("defaults: repeatsDaily false", r2.repeatsDaily === false);

    // --- fuzzy category matching: near-miss and no-match fallback ---
    tasks = [];
    const r3 = createTaskFromSiri({ name: "Run", category: "fitnes" }); // typo of "Fitness"
    check("fuzzy category: near-miss resolves", r3.category === "Fitness" && r3.categoryWasMatched === true);

    tasks = [];
    const r4 = createTaskFromSiri({ name: "Something", category: "zzz totally unrelated zzz" });
    check("fuzzy category: no-match falls back, doesn't guess", r4.categoryWasMatched === false && r4.category === "Work");

    // --- fuzzy preset matching for Deep Work ---
    const dwMatch = startDeepWorkFromSiri({ presetName: "sprnt" }); // typo of "Sprint"
    check("deep work: near-miss preset starts directly", dwMatch.started === true && dwMatch.presetName === "Sprint" && dwMatch.setupScreenOpened === false);
    endTimer();
    switchView("planner");

    const dwNoMatch = startDeepWorkFromSiri({ presetName: "zzz totally unrelated zzz" });
    check("deep work: no-match opens setup, doesn't guess", dwNoMatch.started === false && dwNoMatch.setupScreenOpened === true);
    switchView("planner");

    const dwOmitted = startDeepWorkFromSiri({});
    check("deep work: omitted preset opens setup", dwOmitted.started === false && dwOmitted.setupScreenOpened === true);
    switchView("planner");

    const dwCustom = startDeepWorkFromSiri({ presetName: "Custom" });
    check("deep work: 'Custom' slot never direct-starts (needs typed minutes)", dwCustom.started === false);
    switchView("planner");

    // --- completeTaskFromSiri: clear match ---
    const todayStr = toDateStr(new Date());
    tasks = [
      { id: "t1", name: "Piano practice", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 0, recurrence: { type: "none" }, completedDates: [] },
      { id: "t2", name: "Gym", category: "Fitness", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 1, recurrence: { type: "none" }, completedDates: [] }
    ];
    const cClear = completeTaskFromSiri({ name: "piano practice" });
    check("complete: clear match completes the right task", cClear.completed === true && cClear.taskId === "t1");
    check("complete: clear match doesn't touch other tasks", tasks.find(t => t.id === "t2").done === false);

    // --- completeTaskFromSiri: ambiguous match, never guesses ---
    tasks = [
      { id: "t3", name: "Call Mom", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 0, recurrence: { type: "none" }, completedDates: [] },
      { id: "t4", name: "Call Mike", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 1, recurrence: { type: "none" }, completedDates: [] }
    ];
    const cAmbig = completeTaskFromSiri({ name: "Call M" });
    check("complete: ambiguous match does not complete anything", cAmbig.completed === false);
    check("complete: ambiguous reason labeled correctly (not lumped in with no_match)", cAmbig.reason === "ambiguous");
    check("complete: ambiguous match reports candidates", Array.isArray(cAmbig.candidates) && cAmbig.candidates.length >= 2);
    check("complete: ambiguous match leaves both tasks untouched", !tasks.find(t => t.id === "t3").done && !tasks.find(t => t.id === "t4").done);

    // --- completeTaskFromSiri: no match at all ---
    tasks = [
      { id: "t5", name: "Read a book", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 0, recurrence: { type: "none" }, completedDates: [] }
    ];
    const cNone = completeTaskFromSiri({ name: "zzz totally unrelated zzz" });
    check("complete: no match does not guess", cNone.completed === false && cNone.reason === "no_match");

    // --- completeTaskFromSiri: only considers today's incomplete tasks ---
    const yesterday = toDateStr(new Date(Date.now() - 86400000));
    tasks = [
      { id: "t6", name: "Old task", category: "Personal", time: "", duration: "", date: yesterday, endDate: "", done: false, order: 0, recurrence: { type: "none" }, completedDates: [] },
      { id: "t7", name: "Already done", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: true, order: 1, recurrence: { type: "none" }, completedDates: [] }
    ];
    const cScope = completeTaskFromSiri({ name: "Old task" });
    check("complete: ignores tasks from other days / already-done tasks", cScope.completed === false && cScope.reason === "no_match");

    // --- getTodaysPlanFromSiri ---
    tasks = [
      { id: "t8", name: "Piano Practice", category: "Personal", time: "", duration: "", date: todayStr, endDate: "", done: true, order: 0, recurrence: { type: "none" }, completedDates: [] },
      { id: "t9", name: "Gym", category: "Fitness", time: "", duration: "", date: todayStr, endDate: "", done: false, order: 1, recurrence: { type: "none" }, completedDates: [] }
    ];
    const plan = getTodaysPlanFromSiri();
    check("plan: total count correct", plan.totalCount === 2);
    check("plan: completed count correct", plan.completedCount === 1);
    check("plan: per-task done status correct", plan.tasks.find(t => t.name === "Piano Practice").done === true && plan.tasks.find(t => t.name === "Gym").done === false);
    check("plan: no fake anchor guess", plan.anchorTaskName === null && plan.anchorDone === null);

    // --- regression: manual Add Task modal (submitTaskForm) still works ---
    tasks = [];
    renderAll(); // repopulate #modalCategory's <option>s from the fixture categories above
    openAddModal();
    document.getElementById("modalName").value = "Manual task";
    document.getElementById("modalCategory").value = "Fitness";
    document.getElementById("modalTime").value = "09:15";
    document.getElementById("saveAdd").click();
    const manualTask = tasks.find(t => t.name === "Manual task");
    check("regression: manual Add Task modal still creates tasks correctly", !!manualTask && manualTask.category === "Fitness" && manualTask.time === "09:15" && manualTask.order === 0);

  } finally {
    restoreSnapshot();
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`Siri bridge tests: ${passed}/${results.length} passed`);
  failed.forEach(f => console.error("FAILED:", f.label));
  return { passed, total: results.length, failed: failed.map(f => f.label) };
}

if (typeof window !== "undefined") window.runSiriBridgeTests = runSiriBridgeTests;
