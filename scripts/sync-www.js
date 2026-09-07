// Copies the static web assets (same set Firebase Hosting serves) into
// www/, which is Capacitor's webDir. Keeps native platform folders from
// picking up node_modules, .git, docs/, and other non-web files that would
// otherwise get swept in if webDir pointed straight at the repo root.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const wwwDir = path.join(root, "www");

const WEB_FILES = [
  "index.html",
  "app.js",
  "auth.js",
  "auth-ui.js",
  "auth-action.js",
  "auth-action.html",
  "firebase-init.js",
  "firestore-sync.js",
  "migrate.js",
  "styles.css",
  // Self-hosted vendor scripts index.html now points at (see its own
  // comment) instead of jsdelivr/unpkg/gstatic CDN URLs -- without these,
  // the Android WebView would 404 on every one of them, since it has no
  // CDN fallback to fall through to the way the old absolute URLs did.
  "vendor/lucide.js",
  "vendor/sortable.min.js",
  "vendor/firebase/firebase-app.js",
  "vendor/firebase/firebase-auth.js",
  "vendor/firebase/firebase-firestore.js"
];

fs.rmSync(wwwDir, { recursive: true, force: true });
fs.mkdirSync(wwwDir, { recursive: true });

for (const file of WEB_FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) {
    console.warn(`sync-www: skipping missing file ${file}`);
    continue;
  }
  const dest = path.join(wwwDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log(`sync-www: copied ${WEB_FILES.length} files into www/`);
