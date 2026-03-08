export function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function computeSubgroupStandings(subgroupMembers, eventHistory) {
  const totals = new Map();
  const byWeek = new Map();

  for (const name of subgroupMembers) {
    totals.set(name, 0);
    byWeek.set(name, []);
  }

  for (const event of eventHistory) {
    const eventName = event.name || "Unknown Event";
    const eventResults = event.subgroupResults || [];

    for (const member of subgroupMembers) {
      const result = eventResults.find((r) => r.member === member) || {};
      const earnings = money(result.earnings);
      totals.set(member, totals.get(member) + earnings);
      byWeek.get(member).push({
        eventId: event.id,
        eventName,
        tier: event.tier || "regular",
        earnings,
        finish: result.finish ?? null,
        pick: result.pick ?? null,
      });
    }
  }

  const season = subgroupMembers.map((member) => {
    const total = totals.get(member);
    const history = byWeek.get(member);
    const lastWeek = history.at(-1)?.earnings ?? 0;
    const lastFour = history.slice(-4);
    const avgEarnings =
      history.length === 0
        ? 0
        : history.reduce((sum, week) => sum + week.earnings, 0) / history.length;

    return {
      member,
      seasonEarnings: total,
      weeklyEarnings: lastWeek,
      avgEarnings,
      lastFour,
      history,
    };
  });

  season.sort((a, b) => b.seasonEarnings - a.seasonEarnings || a.member.localeCompare(b.member));

  let currentRank = 1;
  let previousEarnings = null;
  for (let i = 0; i < season.length; i += 1) {
    if (previousEarnings !== null && season[i].seasonEarnings < previousEarnings) {
      currentRank = i + 1;
    }
    season[i].groupRank = currentRank;
    previousEarnings = season[i].seasonEarnings;
  }

  const leader = season[0]?.seasonEarnings ?? 0;
  return season.map((row) => ({
    ...row,
    toLeader: leader - row.seasonEarnings,
  }));
}

export function computeTeamSummary(standings, teams) {
  const rows = teams.map((team) => {
    const members = team.members || [];
    const memberRows = standings.filter((row) => members.includes(row.member));
    const seasonEarnings = memberRows.reduce((sum, row) => sum + row.seasonEarnings, 0);
    const weeklyEarnings = memberRows.reduce((sum, row) => sum + row.weeklyEarnings, 0);

    return {
      teamName: team.name,
      members,
      seasonEarnings,
      weeklyEarnings,
      avgMemberEarnings: members.length ? seasonEarnings / members.length : 0,
    };
  });

  rows.sort((a, b) => b.seasonEarnings - a.seasonEarnings || a.teamName.localeCompare(b.teamName));

  const leader = rows[0]?.seasonEarnings ?? 0;
  return rows.map((row, idx) => ({ ...row, rank: idx + 1, toLeader: leader - row.seasonEarnings }));
}

export function buildWeeklyComparison(subgroupMembers, eventHistory) {
  return eventHistory.map((event) => {
    const rows = subgroupMembers.map((member) => {
      const result = (event.subgroupResults || []).find((x) => x.member === member) || {};
      return {
        member,
        eventId: event.id,
        eventName: event.name,
        tier: event.tier || "regular",
        totalPurse: money(event.totalPurse),
        firstPrize: money(event.firstPrize),
        earnings: money(result.earnings),
        finish: result.finish ?? null,
        pick: result.pick ?? null,
        leagueRank: result.leagueRank ?? null,
      };
    });

    rows.sort((a, b) => b.earnings - a.earnings || a.member.localeCompare(b.member));
    return {
      eventId: event.id,
      eventName: event.name,
      tier: event.tier || "regular",
      totalPurse: money(event.totalPurse),
      firstPrize: money(event.firstPrize),
      rows,
    };
  });
}

export function calculateWhoGainedThisWeek(standings) {
  const maxWeek = Math.max(...standings.map((s) => s.weeklyEarnings), 0);
  return standings.filter((s) => s.weeklyEarnings === maxWeek && maxWeek > 0).map((s) => s.member);
}

export function computeLeaguePercentile(rank, totalEntrants) {
  if (!rank || !totalEntrants || totalEntrants <= 1) return 0;
  const pct = ((totalEntrants - rank) / (totalEntrants - 1)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function applyWeeklyPicks(playerPool, weekPicks) {
  const updated = structuredClone(playerPool);

  for (const [member, golfer] of Object.entries(weekPicks)) {
    if (!golfer) continue;
    const state = updated.members[member];
    if (!state) continue;
    if (state.used.includes(golfer)) continue;

    state.used.push(golfer);
    state.available = state.available.filter((g) => g !== golfer);
  }

  return updated;
}
