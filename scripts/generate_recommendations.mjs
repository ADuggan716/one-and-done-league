#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRecommendations } from "../src/lib/recommendations.mjs";
import { synthesizeWeeklySignals } from "../src/lib/online_signals.mjs";
import { enrichProjectionsWithBettingProfiles } from "../src/lib/pga_tour_betting_profiles.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const config = JSON.parse(await fs.readFile(path.join(root, "config/config.json"), "utf8"));
const playerPool = JSON.parse(await fs.readFile(path.join(root, "data/player_pool.json"), "utf8"));
const snapshot = JSON.parse(await fs.readFile(path.join(root, "data/league_snapshot.json"), "utf8"));

const available = playerPool.members[config.me]?.available || [];
const usedByMember = new Map(
  Object.entries(playerPool.members || {}).map(([member, data]) => [
    member,
    new Set((data.used || []).map((name) => String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[.'’]/g, "").replace(/\s+/g, " ").trim().toLowerCase())),
  ])
);
const synthesized = synthesizeWeeklySignals(snapshot.projections || [], {
  nextTournamentField: playerPool.nextTournamentField || [],
  nextTournament: snapshot.nextTournament || snapshot.event,
  subgroupMembers: config.subgroupMembers,
  me: config.me,
  usedByMember,
});
let projections = synthesized.projections;
let profileSourceNotes = [];
try {
  const enrichedProfiles = await enrichProjectionsWithBettingProfiles(projections, {
    nextTournament: snapshot.nextTournament || snapshot.event,
    golfers: available,
  });
  projections = enrichedProfiles.projections;
  profileSourceNotes = enrichedProfiles.sourceNotes || [];
} catch (error) {
  profileSourceNotes = [`PGA TOUR betting profiles: failed (${error.message})`];
}

const recommendations = {
  currentEvent: snapshot.event,
  event: snapshot.nextTournament || snapshot.event,
  strategy: "balanced-weekly-pick-with-tradeoffs",
  sourceNotes: [
    ...(snapshot.sourceNotes || []),
    ...profileSourceNotes,
    ...(synthesized.synthesisSummary.fieldCandidateCount
      ? [`Weekly projection synthesis: ${synthesized.synthesisSummary.synthesizedCount} field golfers modeled during recommendation generation`]
      : []),
  ],
  ...generateRecommendations(available, projections, {
    weights: config.recommendationWeights,
    eventTier: snapshot.nextTournament?.tier || snapshot.event?.tier,
    nextTournamentField: playerPool.nextTournamentField || [],
    playerPoolGolfers: playerPool.golfers || [],
    sourceNotes: snapshot.sourceNotes || [],
  }),
};

await fs.writeFile(path.join(root, "data/recommendations.json"), `${JSON.stringify(recommendations, null, 2)}\n`);
console.log("Recommendations generated.");
