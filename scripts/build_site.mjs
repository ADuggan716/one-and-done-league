#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

async function resetDir(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dst);
    } else {
      await copyFile(src, dst);
    }
  }
}

async function main() {
  await resetDir(dist);

  await copyFile(path.join(root, "public/index.html"), path.join(dist, "index.html"));
  await copyFile(path.join(root, "public/app.js"), path.join(dist, "app.js"));
  await copyFile(path.join(root, "public/styles.css"), path.join(dist, "styles.css"));
  await copyDir(path.join(root, "public/palette-options"), path.join(dist, "palette-options"));

  await copyFile(path.join(root, "private/recommendations.html"), path.join(dist, "private/index.html"));
  await copyFile(path.join(root, "private/recommendations.js"), path.join(dist, "private/recommendations.js"));

  await copyDir(path.join(root, "data"), path.join(dist, "data"));
  await fs.writeFile(path.join(dist, ".nojekyll"), "\n", "utf8");

  console.log("Built GitHub Pages site in dist/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
