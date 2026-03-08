#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRecommendations } from "../src/lib/recommendations.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const config = JSON.parse(await fs.readFile(path.join(root, "config/config.json"), "utf8"));
const playerPool = JSON.parse(await fs.readFile(path.join(root, "data/player_pool.json"), "utf8"));
const snapshot = JSON.parse(await fs.readFile(path.join(root, "data/league_snapshot.json"), "utf8"));

const available = playerPool.members[config.me]?.available || [];
const projections = snapshot.projections || [];

const recommendations = {
  event: snapshot.event,
  strategy: "expected-value-plus-form-history-course",
  sourceNotes: snapshot.sourceNotes || [],
  ...generateRecommendations(available, projections, {
    weights: config.recommendationWeights,
    eventTier: snapshot.event?.tier,
  }),
};

await fs.writeFile(path.join(root, "data/recommendations.json"), `${JSON.stringify(recommendations, null, 2)}\n`);
console.log("Recommendations generated.");
