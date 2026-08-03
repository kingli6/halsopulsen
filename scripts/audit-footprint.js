const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", ".cache"]);
const warningFileBytes = 5 * 1024 * 1024;
const hardFileBytes = 25 * 1024 * 1024;
const warningTrackedBytes = 250 * 1024 * 1024;

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(fullPath, files);
      continue;
    }
    const stat = fs.statSync(fullPath);
    files.push({ path: path.relative(root, fullPath), bytes: stat.size });
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split("\0").filter(Boolean).map(relativePath => {
    const fullPath = path.join(root, relativePath);
    return fs.existsSync(fullPath)
      ? { path: relativePath, bytes: fs.statSync(fullPath).size }
      : null;
  }).filter(Boolean);
}

const files = walk(root);
const tracked = trackedFiles() || files;
const totalTrackedBytes = tracked.reduce((total, file) => total + file.bytes, 0);
const largeFiles = files.filter(file => file.bytes >= warningFileBytes)
  .sort((left, right) => right.bytes - left.bytes);

console.log(`Tracked file footprint: ${formatBytes(totalTrackedBytes)}`);
console.log(`Scanned files: ${files.length}`);
console.log(`Tracked-file warning threshold: ${formatBytes(warningTrackedBytes)}`);

if (largeFiles.length) {
  console.log("\nLarge files:");
  for (const file of largeFiles) {
    const severity = file.bytes >= hardFileBytes ? "BLOCK" : "WARN ";
    console.log(`${severity} ${formatBytes(file.bytes).padStart(10)}  ${file.path}`);
  }
} else {
  console.log("\nNo files exceeded the local 5 MB warning threshold.");
}

for (const relativePath of ["storage/published-plans.json", "storage/template-library.json"]) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) continue;
  const stat = fs.statSync(fullPath);
  let records = "unavailable";
  try {
    const value = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    records = Array.isArray(value) ? `${value.length} records` : "object";
  } catch {
    // The size report remains useful even if a data file is temporarily invalid.
  }
  console.log(`${relativePath}: ${formatBytes(stat.size)} (${records})`);
}

if (totalTrackedBytes >= warningTrackedBytes || largeFiles.some(file => file.bytes >= hardFileBytes)) {
  process.exitCode = 1;
}