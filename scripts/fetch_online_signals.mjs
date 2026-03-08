#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "../src/lib/online_signals.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const configPath = path.join(root, "config/config.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));

const sources = config.onlineSources || [];
const signals = [];
const sourceNotes = [];

for (const source of sources) {
  try {
    const headers = {};
    if (source.authEnv) {
      const token = process.env[source.authEnv];
      if (!token) {
        sourceNotes.push(`${source.name}: skipped (missing env ${source.authEnv})`);
        continue;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const payload = await fetchJson(source.url, headers);
    const rows = Array.isArray(payload.signals) ? payload.signals : [];

    for (const row of rows) {
      signals.push({
        golfer: row.golfer,
        projectedEarnings: row.projectedEarnings,
        projectedDupCount: row.projectedDupCount,
        futureValue: row.futureValue,
        historicalStrength: row.historicalStrength,
        courseHistoryScore: row.courseHistoryScore,
        last4Finishes: row.last4Finishes,
        sourceRefs: [source.name, source.url],
      });
    }

    sourceNotes.push(`${source.name}: ${rows.length} golfer signals loaded`);
  } catch (error) {
    sourceNotes.push(`${source.name}: failed (${error.message})`);
  }
}

const output = {
  fetchedAt: new Date().toISOString(),
  sourceNotes,
  signals,
};

await fs.writeFile(path.join(root, "data/online_signals.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Saved ${signals.length} online signals.`);
