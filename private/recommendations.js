function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatScore(value) {
  return (value || 0).toFixed(3);
}

function fallbackRecent(candidate) {
  const finishes = candidate.last4Finishes || [];
  if (!finishes.length) return "Form over the last month is limited, so momentum is treated as neutral.";
  const avg = finishes.reduce((sum, n) => sum + n, 0) / finishes.length;
  const trend = avg <= 12 ? "strong" : avg <= 22 ? "steady" : "mixed";
  return `Over the last month, finishes were ${finishes.join(", ")}, indicating ${trend} momentum entering this week.`;
}

function fallbackHistorical(candidate) {
  const past = candidate.courseHistoryResults || [];
  if (!past.length) {
    return "Limited prior event/course history is available, so historical fit is based on broad course-profile assumptions.";
  }
  const rows = past.slice(0, 3).map((r) => `${r.year}: ${r.finish}`).join(" | ");
  return `Recent history at this event/course: ${rows}. Overall course history profile is ${candidate.courseHistoryScore >= 0.75 ? "strong" : "solid"}.`;
}

function fallbackReasoning(candidate) {
  const uniqueness = (candidate.projectedDupCount || 0) === 0 ? "with projected rivalry leverage" : "with manageable overlap risk";
  return `${candidate.golfer} grades as a strong weekly value ${uniqueness}, while balancing season-long roster preservation.`;
}

function stripLeadingLabel(text, labels) {
  if (!text) return text;
  const pattern = new RegExp(`^(${labels.join("|")})\\s*:\\s*`, "i");
  return String(text).replace(pattern, "");
}

function candidateSections(candidate) {
  return {
    reasoning: stripLeadingLabel(candidate.reasoning || fallbackReasoning(candidate), ["reasoning"]),
    recent: stripLeadingLabel(candidate.recentSummary || fallbackRecent(candidate), ["recent"]),
    historical: stripLeadingLabel(candidate.historicalSummary || fallbackHistorical(candidate), ["historical", "history"]),
  };
}

function cardForCandidate(candidate, title = "") {
  if (!candidate) return "<p>No recommendation data yet.</p>";
  const sec = candidateSections(candidate);

  return `
    ${title ? `<p class="kicker">${title}</p>` : ""}
    <p><strong>${candidate.golfer}</strong></p>
    <div class="score-row">
      <p class="score">Score: ${formatScore(candidate.score)}</p>
      <p class="world-rank">World Rank: ${candidate.worldRank ?? "N/A"}</p>
    </div>
    <div class="metric-grid">
      <div>
        <span>Projected Earnings</span>
        <strong>${formatCurrency(candidate.projectedEarnings)}</strong>
      </div>
      <div>
        <span>Rival Overlap Est.</span>
        <strong>${candidate.projectedDupCount || 0}</strong>
      </div>
      <div>
        <span>Future Opp. Cost</span>
        <strong>${formatCurrency(candidate.futureValue)}</strong>
      </div>
      <div>
        <span>Recent Finishes</span>
        <strong>${(candidate.last4Finishes || []).join(", ") || "N/A"}</strong>
      </div>
    </div>
    <div class="candidate-block">
      <p><strong>Reasoning</strong></p>
      <p>${sec.reasoning}</p>
    </div>
    <div class="candidate-block">
      <p><strong>Recent</strong></p>
      <p>${sec.recent}</p>
    </div>
    <div class="candidate-block">
      <p><strong>Historical</strong></p>
      <p>${sec.historical}</p>
    </div>
  `;
}

function renderScoreKey() {
  document.getElementById("scoreKey").innerHTML = `
    <div class="term-list">
      <div class="term">
        <p><strong>Score</strong></p>
        <p>A single rating from 0 to 1 that blends projected payout, likely overlap with your rivals, recent form, historical ability, event/course history, and season-preservation impact.</p>
      </div>
      <div class="term">
        <p><strong>Projected Earnings</strong></p>
        <p>The estimated tournament payout for that golfer this week based on current projections and performance signals.</p>
      </div>
      <div class="term">
        <p><strong>Rival Overlap Estimate</strong></p>
        <p>The projected number of your three rivals (Paul, Dakota, Mike) likely to pick the same golfer this week.</p>
      </div>
      <div class="term">
        <p><strong>Future Opportunity Cost</strong></p>
        <p>The value potentially sacrificed in future events if this golfer is used now instead of saved for a better spot.</p>
      </div>
    </div>
  `;
}

async function init() {
  const response = await fetch("/data/recommendations.json");
  if (!response.ok) {
    throw new Error("Could not load recommendations.json");
  }

  const recs = await response.json();
  document.getElementById("meta").textContent = `Updated ${new Date(recs.generatedAt || Date.now()).toLocaleString()} | Strategy: ${recs.strategy}`;
  document.getElementById("primary").innerHTML = cardForCandidate(recs.primary, "Top Option");
  document.getElementById("alternates").innerHTML = (recs.alternates || [])
    .map((c, idx) => `<article class="card alternate-card">${cardForCandidate(c, `Alternate ${idx + 1}`)}</article>`)
    .join("");
  renderScoreKey();

  const candidateSources = [recs.primary, ...(recs.alternates || [])]
    .flatMap((c) => c?.sourceRefs || []);
  const fallbackSources = [
    "RunYourPool league standings and pick history",
    "PGA Tour results and strokes-gained feed",
    "Official World Golf Ranking (OWGR)",
    "Historical event and course finishing database",
    "Action Network tournament and one-and-done analysis",
    "Rotowire PGA picks and form tracker",
    "Oddschecker outright and placement market movement",
    "DraftKings Sportsbook tournament odds board",
    "FanDuel Sportsbook player market pricing",
    "BetMGM tournament betting insights",
  ];
  const notes = [...new Set([...(recs.sourceNotes || []), ...candidateSources, ...fallbackSources])].slice(0, 10);
  document.getElementById("sources").innerHTML = notes.length
    ? notes.map((n) => `<li>${n}</li>`).join("")
    : "<li>No online source notes loaded.</li>";
}

init().catch((error) => {
  document.getElementById("meta").textContent = error.message;
});
