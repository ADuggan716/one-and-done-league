function normalizeGolferName(name) {
  const normalized = String(name || "")
    .normalize("NFKD")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[åÅ]/g, "a")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (normalized === "matt fitzpatrick") return "matthew fitzpatrick";
  return normalized;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export { normalizeGolferName };

function lastNameKey(name) {
  return normalizeGolferName(name).split(" ").filter(Boolean).at(-1) || "";
}

function expandUsedNames(usedNames = [], golfers = []) {
  const usedSet = new Set(usedNames.map(normalizeGolferName).filter(Boolean));
  const golfersByLastName = new Map();

  for (const golfer of golfers || []) {
    const key = lastNameKey(golfer.name);
    if (!key) continue;
    const current = golfersByLastName.get(key) || [];
    current.push(normalizeGolferName(golfer.name));
    golfersByLastName.set(key, current);
  }

  for (const name of usedNames || []) {
    const normalized = normalizeGolferName(name);
    if (!normalized) continue;
    if (!normalized.includes(" ")) {
      const matches = golfersByLastName.get(normalized) || [];
      if (matches.length === 1) {
        usedSet.add(matches[0]);
      }
    }
  }

  return usedSet;
}

export function buildPlayerPool(normalized, config, options = {}) {
  const allEventRows = normalized.events.flatMap((event) => event.subgroupResults || []);
  const nextTournamentField = Array.isArray(options.nextTournamentField) ? options.nextTournamentField : [];
  const nextTournamentFieldSet = new Set(nextTournamentField.map(normalizeGolferName).filter(Boolean));

  const usedByMember = Object.fromEntries(
    config.subgroupMembers.map((member) => [
      member,
      [...new Set(allEventRows.filter((row) => row.member === member).map((row) => row.pick).filter(Boolean))],
    ])
  );

  const golferMap = new Map();
  const projectedGolfers = [...(normalized.projections || [])].map((projection) => ({
    name: String(projection.golfer || "").trim(),
    worldRank: numberOr(projection.worldRank, 999),
    fedexPoints: numberOr(projection.fedexPoints, 0),
    seasonEarnings: numberOr(projection.seasonEarnings, 0),
    inNextTournament: nextTournamentFieldSet.size
      ? nextTournamentFieldSet.has(normalizeGolferName(projection.golfer))
      : Boolean(projection.inNextTournament),
  }));
  const usedGolfers = [...new Set(allEventRows.map((row) => row.pick).filter(Boolean))].map((name) => ({
    name,
    worldRank: 999,
    fedexPoints: 0,
    seasonEarnings: 0,
    inNextTournament: nextTournamentFieldSet.has(normalizeGolferName(name)),
  }));

  for (const golfer of [...projectedGolfers, ...usedGolfers]) {
    const key = normalizeGolferName(golfer.name);
    if (!key) continue;
    const existing = golferMap.get(key);
    if (!existing) {
      golferMap.set(key, golfer);
      continue;
    }
    golferMap.set(key, {
      ...existing,
      ...golfer,
      name: existing.name || golfer.name,
      worldRank: Math.min(numberOr(existing.worldRank, 999), numberOr(golfer.worldRank, 999)),
      fedexPoints: Math.max(numberOr(existing.fedexPoints, 0), numberOr(golfer.fedexPoints, 0)),
      seasonEarnings: Math.max(numberOr(existing.seasonEarnings, 0), numberOr(golfer.seasonEarnings, 0)),
      inNextTournament: Boolean(existing.inNextTournament || golfer.inNextTournament),
    });
  }

  const golfers = [...golferMap.values()]
    .sort((a, b) => a.worldRank - b.worldRank || a.name.localeCompare(b.name))
    .slice(0, 50);

  const members = Object.fromEntries(
    config.subgroupMembers.map((member) => {
      const used = usedByMember[member] || [];
      const usedSet = expandUsedNames(used, golfers);
      return [
        member,
        {
          used,
          available: golfers.map((golfer) => golfer.name).filter((name) => !usedSet.has(normalizeGolferName(name))),
        },
      ];
    })
  );

  return {
    eventId: normalized.events.at(-1)?.id || null,
    tournamentName: normalized.nextTournament?.name || normalized.events.at(-1)?.name || null,
    eventTier: normalized.events.at(-1)?.tier || "regular",
    currentEventMeta: {
      totalPurse: normalized.events.at(-1)?.totalPurse || 0,
      firstPrize: normalized.events.at(-1)?.firstPrize || 0,
    },
    members,
    golfers,
    nextTournamentField: golfers.filter((golfer) => golfer.inNextTournament).map((golfer) => golfer.name),
    filters: {
      tiers: ["major", "signature", "regular"],
    },
    updatedAt: normalized.lastSyncedAt,
  };
}
