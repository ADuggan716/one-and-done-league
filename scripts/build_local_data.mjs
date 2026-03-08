#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const payload = {
  league: {
    id: "local",
    name: "Local One and Done",
    totalEntrants: 150,
    yourRank: 40,
    latestEventId: "event-1"
  },
  events: [
    {
      id: "event-1",
      name: "Sample Open",
      tier: "regular",
      startDate: "2026-03-05",
      subgroupResults: [
        { "member": "Andrew", "pick": "Scottie Scheffler", "earnings": 500000, "finish": 3 },
        { "member": "Paul", "pick": "Xander Schauffele", "earnings": 120000, "finish": 12 },
        { "member": "Dakota", "pick": "Wyndham Clark", "earnings": 0, "finish": 60 },
        { "member": "Mike", "pick": "Ludvig Aberg", "earnings": 280000, "finish": 5 }
      ],
      picks: []
    }
  ],
  projections: [
    { "golfer": "Rory McIlroy", "projectedEarnings": 640000, "projectedDupCount": 2, "futureValue": 700000, "vegasRank": 2 },
    { "golfer": "Collin Morikawa", "projectedEarnings": 520000, "projectedDupCount": 1, "futureValue": 500000, "vegasRank": 7 },
    { "golfer": "Viktor Hovland", "projectedEarnings": 450000, "projectedDupCount": 0, "futureValue": 350000, "vegasRank": 14 }
  ],
  warnings: [],
  lastSyncedAt: new Date().toISOString()
};

await fs.writeFile(path.join(root, "data/local_upstream_snapshot.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log("Created data/local_upstream_snapshot.json");
