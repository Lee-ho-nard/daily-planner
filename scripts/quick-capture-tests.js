// Manual test harness for the Quick Capture JS bridge (see app.js's
// "--- Quick Capture JS bridge (iOS Share Extension) ---" section:
// createTaskFromShare).
//
// Same usage as scripts/siri-bridge-tests.js: paste this whole file into
// the browser devtools console (or a javascript_exec call) while the app
// is loaded at localhost. Reads/writes the same `tasks`/`categories`
// globals app.js itself uses (classic <script>, shared global scope — not
// window.-prefixed), so it must run in that same page.
//
// Snapshots real app state first and restores it (with a final save())
// when done, so it's safe to run against a real signed-in/local dataset.

function runQuickCaptureTests() {
  const results = [];
  function check(label, condition) {
    results.push({ label, pass: !!condition });
  }

  const snapshot = {
    tasks: JSON.parse(JSON.stringify(tasks)),
    categories: JSON.parse(JSON.stringify(categories)),
    customPresets: JSON.parse(JSON.stringify(customPresets))
  };
  function restoreSnapshot() {
    tasks = snapshot.tasks;
    categories = snapshot.categories;
    customPresets = snapshot.customPresets;
    save();
  }

  try {
    categories = [
      { name: "Inbox", color: "#4f8cff" },
      { name: "Work", color: "#ff6b6b" }
    ];

    // --- title + url: name = title, sourceUrl stored ---
    tasks = [];
    const r1 = createTaskFromShare({ title: "Great Article", url: "https://example.com/article" });
    check("title+url: success", r1.success === true);
    check("title+url: name is title", r1.name === "Great Article");
    check("title+url: category falls back to first category", r1.category === "Inbox");
    check("title+url: sourceUrl returned", r1.sourceUrl === "https://example.com/article");
    const t1 = tasks.find(t => t.id === r1.taskId);
    check("title+url: sourceUrl stored on task", !!t1 && t1.sourceUrl === "https://example.com/article");
    check("title+url: date is today", !!t1 && t1.date === toDateStr(new Date()));
    check("title+url: no time/duration set", !!t1 && t1.time === "" && t1.duration === "");

    // --- text only: name = text, no sourceUrl ---
    tasks = [];
    const r2 = createTaskFromShare({ text: "Remember to call the dentist" });
    check("text only: success", r2.success === true);
    check("text only: name is text", r2.name === "Remember to call the dentist");
    check("text only: sourceUrl omitted cleanly (null)", r2.sourceUrl === null);
    const t2 = tasks.find(t => t.id === r2.taskId);
    check("text only: sourceUrl stored as empty string", !!t2 && t2.sourceUrl === "");

    // --- url only: name = raw url, sourceUrl also stored ---
    tasks = [];
    const r3 = createTaskFromShare({ url: "https://example.com/no-title-no-text" });
    check("url only: success", r3.success === true);
    check("url only: name falls back to raw url", r3.name === "https://example.com/no-title-no-text");
    check("url only: sourceUrl still stored even though it's also the name", r3.sourceUrl === "https://example.com/no-title-no-text");

    // --- all three present: title wins for name, url always goes to sourceUrl ---
    tasks = [];
    const r4 = createTaskFromShare({ title: "Page Title", text: "Selected paragraph text", url: "https://example.com/all-three" });
    check("all three: name prioritizes title over text/url", r4.name === "Page Title");
    check("all three: sourceUrl still captured", r4.sourceUrl === "https://example.com/all-three");

    // --- text + url (no title): name = text ---
    tasks = [];
    const r5 = createTaskFromShare({ text: "Selected text, no title", url: "https://example.com/text-and-url" });
    check("text+url no title: name is text", r5.name === "Selected text, no title");
    check("text+url no title: sourceUrl captured", r5.sourceUrl === "https://example.com/text-and-url");

    // --- nothing shared at all: graceful error, no task created ---
    tasks = [];
    const r6 = createTaskFromShare({});
    check("empty share: rejected cleanly, not a crash", r6.success === false && !!r6.error);
    check("empty share: no task created", tasks.length === 0);

    const r6b = createTaskFromShare({ text: "   ", url: "   ", title: "   " });
    check("whitespace-only share: rejected cleanly", r6b.success === false && !!r6b.error);

    // --- no categories at all: graceful error, not a crash ---
    const savedCategories = categories;
    categories = [];
    tasks = [];
    const r7 = createTaskFromShare({ text: "Some task" });
    check("no categories: rejected cleanly", r7.success === false && !!r7.error);
    categories = savedCategories;

    // --- regression: createTaskRecord() reuse — Siri bridge unaffected ---
    tasks = [];
    const siriResult = createTaskFromSiri({ name: "Siri-created task" });
    check("regression: Siri bridge still works after createTaskRecord's new sourceUrl param", siriResult.success === true);
    const siriTask = tasks.find(t => t.id === siriResult.taskId);
    check("regression: Siri-created task gets a harmless empty sourceUrl default", !!siriTask && siriTask.sourceUrl === "");

    // --- regression: manual Add Task modal still works ---
    tasks = [];
    renderAll();
    openAddModal();
    document.getElementById("modalName").value = "Manual task";
    document.getElementById("modalCategory").value = "Work";
    document.getElementById("saveAdd").click();
    const manualTask = tasks.find(t => t.name === "Manual task");
    check("regression: manual Add Task modal still creates tasks correctly", !!manualTask && manualTask.category === "Work");
    check("regression: manual task also gets a harmless empty sourceUrl default", !!manualTask && manualTask.sourceUrl === "");

  } finally {
    restoreSnapshot();
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`Quick Capture tests: ${passed}/${results.length} passed`);
  failed.forEach(f => console.error("FAILED:", f.label));
  return { passed, total: results.length, failed: failed.map(f => f.label) };
}

if (typeof window !== "undefined") window.runQuickCaptureTests = runQuickCaptureTests;
