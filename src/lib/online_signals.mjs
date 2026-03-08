import fs from "node:fs/promises";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function normalizeGolferName(name) {
  return String(name || "").trim();
}

export async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

export function mergeSignals(baseProjections, signals) {
  const map = new Map(baseProjections.map((p) => [normalizeGolferName(p.golfer), { ...p }]));

  for (const signal of signals) {
    const name = normalizeGolferName(signal.golfer);
    if (!name) continue;
    const existing = map.get(name) || { golfer: name };

    const last4 = Array.isArray(signal.last4Finishes) ? signal.last4Finishes.map((f) => Number(f)).filter(Number.isFinite) : existing.last4Finishes;

    map.set(name, {
      ...existing,
      projectedEarnings: signal.projectedEarnings ?? existing.projectedEarnings ?? 0,
      projectedDupCount: signal.projectedDupCount ?? existing.projectedDupCount ?? 1,
      futureValue: signal.futureValue ?? existing.futureValue ?? 250000,
      historicalStrength:
        signal.historicalStrength !== undefined
          ? clamp01(signal.historicalStrength)
          : clamp01(existing.historicalStrength ?? 0.5),
      courseHistoryScore:
        signal.courseHistoryScore !== undefined
          ? clamp01(signal.courseHistoryScore)
          : clamp01(existing.courseHistoryScore ?? 0.5),
      last4Finishes: last4 || [35, 28, 40, 22],
      sourceRefs: [...new Set([...(existing.sourceRefs || []), ...(signal.sourceRefs || [])])],
    });
  }

  return [...map.values()];
}

export async function readOnlineSignals(path) {
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.signals) ? parsed : { signals: [], sourceNotes: [] };
}
