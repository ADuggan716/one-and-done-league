#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSplashSportsData, loadCookie, readConfig, SyncError } from "../src/lib/sync.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

async function main() {
  const config = await readConfig(path.join(root, "config/config.json"));
  const cookie = await loadCookie(path.join(root, config.cookiePath));

  const snapshot = await fetchSplashSportsData({
    baseUrl: config.splash.baseUrl,
    cookie,
    leaguePath: config.splash.leaguePath,
    standingsPath: config.splash.standingsPath,
    subgroupMembers: config.subgroupMembers,
    memberAliases: config.memberAliases || {},
  });

  const latestEvent = snapshot.events?.at(-1);
  const currentPicks = latestEvent?.subgroupResults || [];
  console.log(JSON.stringify({
    ok: true,
    league: snapshot.league?.name || null,
    event: latestEvent?.name || null,
    picksFound: currentPicks.filter((row) => row.pick).length,
    members: currentPicks.map((row) => ({
      member: row.member,
      pick: row.pick,
      earnings: row.earnings,
      finish: row.finish,
      leagueRank: row.leagueRank,
    })),
  }, null, 2));
}

main().catch((error) => {
  const code = error instanceof SyncError ? error.code : "ERR";
  console.error(`${code}: ${error.message}`);
  process.exitCode = 1;
});
