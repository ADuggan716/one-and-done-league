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

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function missingFieldData(recs) {
  const notes = recs.sourceNotes || [];
  return (
    Number(recs.summary?.nextTournamentFieldCount || 0) === 0 &&
    notes.some((note) => /field entries:\s*0|No next-tournament field available/i.test(String(note)))
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function candidateSections(candidate) {
  return {
    reasoning: String(candidate.reasoning || "").replace(/^Reasoning:\s*/i, ""),
    recent: String(candidate.recentSummary || "").replace(/^Recent:\s*/i, ""),
    historical: String(candidate.historicalSummary || "").replace(/^Historical:\s*/i, ""),
    caution: String(candidate.cautionSummary || "").replace(/^Caution:\s*/i, ""),
  };
}

function badge(label, tone = "") {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function renderFlags(candidate) {
  const items = [];
  items.push(candidate.eligible ? badge("Confirmed field", "good") : badge("Out of field", "warn"));
  items.push(candidate.hasProjectedEarnings ? badge("Has payout projection", "good") : badge("Projection missing", "warn"));
  items.push(badge(`${candidate.confidenceLabel} confidence`, candidate.confidenceLabel === "High" ? "good" : candidate.confidenceLabel === "Medium" ? "cool" : "warn"));
  for (const flag of candidate.flags || []) {
    if (flag === "Out of field" || flag === "Missing payout projection") continue;
    items.push(badge(flag, flag === "Projected unique" ? "cool" : ""));
  }
  return items.join("");
}

function metric(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function scoreStrip(candidate, dataState = {}) {
  const projectionUnavailable = dataState.projectionPending || !candidate.hasProjectedEarnings;
  return `
    <div class="score-strip">
      ${metric("Projected upside", projectionUnavailable ? "N/A" : formatPercent(candidate.decisionScores?.expected))}
      ${metric("Leverage", formatPercent(candidate.decisionScores?.leverage))}
      ${metric("Low-regret spend", formatPercent(candidate.decisionScores?.preservation))}
      ${metric("Trust", formatPercent(candidate.confidenceScore))}
    </div>
  `;
}

function cardForCandidate(candidate, title = "", dataState = {}) {
  if (!candidate) return "<p>No recommendation data yet.</p>";
  const sec = candidateSections(candidate);
  const fieldUnavailable = dataState.fieldPending && !candidate.eligible;
  const projectionUnavailable = dataState.projectionPending && !candidate.hasProjectedEarnings;
  const scoreValue = fieldUnavailable && projectionUnavailable ? "N/A" : formatScore(candidate.score);
  const earningsValue = projectionUnavailable ? "N/A" : formatCurrency(candidate.projectedEarnings);
  const overlapValue = dataState.fieldPending ? "Pending field" : String(candidate.projectedDupCount ?? 0);

  return `
    ${title ? `<p class="sub"><strong>${escapeHtml(title)}</strong></p>` : ""}
    <div class="candidate-head">
      <div>
        <h3>${escapeHtml(candidate.golfer)}</h3>
        <p class="world-rank">World Rank: ${escapeHtml(candidate.worldRank ?? "N/A")}</p>
      </div>
      <div class="score-row">
        <span class="score ${scoreValue === "N/A" ? "score-muted" : ""}">${escapeHtml(scoreValue)}</span>
      </div>
    </div>
    <div class="badges">${renderFlags(candidate)}</div>
    ${
      fieldUnavailable || projectionUnavailable
        ? `<div class="inline-note">${
            fieldUnavailable
              ? "Next-event field is not published yet, so eligibility and rival overlap are provisional."
              : "Weekly payout projections are not available yet, so upside metrics are withheld."
          }</div>`
        : ""
    }
    <div class="metric-grid">
      ${metric("Projected earnings", earningsValue)}
      ${metric("Rival overlap", overlapValue)}
      ${metric("Future value", formatCurrency(candidate.futureValue))}
      ${metric("Recent finishes", (candidate.last4Finishes || []).join(", ") || "N/A")}
    </div>
    ${scoreStrip(candidate, dataState)}
    <div class="candidate-block">
      <p><strong>Why this can work</strong></p>
      <p>${escapeHtml(sec.reasoning || "No written rationale available.")}</p>
    </div>
    <div class="candidate-block">
      <p><strong>Recent form</strong></p>
      <p>${escapeHtml(sec.recent || "No recent-form note available.")}</p>
    </div>
    <div class="candidate-block">
      <p><strong>Course and event fit</strong></p>
      <p>${escapeHtml(sec.historical || "No history note available.")}</p>
    </div>
    <div class="candidate-block">
      <p><strong>What to watch</strong></p>
      <p>${escapeHtml(sec.caution || "No caution note available.")}</p>
    </div>
  `;
}

function viewCard(title, subtitle, candidate, metricLabel, metricValue, dataState = {}) {
  if (!candidate) {
    return `
      <article class="decision-card">
        <span>${escapeHtml(title)}</span>
        <h3>No candidate</h3>
        <p>${escapeHtml(subtitle)}</p>
      </article>
    `;
  }

  const hiddenMetric = dataState.projectionPending && /balanced score|projected upside/i.test(metricLabel);

  return `
    <article class="decision-card">
      <span>${escapeHtml(title)}</span>
      <h3>${escapeHtml(candidate.golfer)}</h3>
      <p>${escapeHtml(subtitle)}</p>
      <p><strong>${escapeHtml(metricLabel)}:</strong> ${escapeHtml(hiddenMetric ? "N/A" : metricValue)}</p>
      <p><strong>Confidence:</strong> ${escapeHtml(candidate.confidenceLabel)}</p>
    </article>
  `;
}

function renderScoreKey() {
  document.getElementById("scoreKey").innerHTML = `
    <div class="term-list">
      <div class="term">
        <p><strong>Balanced score</strong></p>
        <p>The main ranking blends weekly upside, leverage, recent form, historical strength, course fit, and preservation costs, while pushing out-of-field names down hard.</p>
      </div>
      <div class="term">
        <p><strong>Projected upside</strong></p>
        <p>This reflects this week’s payout projection only. If projections are missing, the card is explicitly marked lower-confidence.</p>
      </div>
      <div class="term">
        <p><strong>Leverage</strong></p>
        <p>Higher leverage means fewer rivals are expected to use the same golfer, improving uniqueness if the golfer hits.</p>
      </div>
      <div class="term">
        <p><strong>Low-regret spend</strong></p>
        <p>This favors golfers who still look playable this week without burning a high future-opportunity asset.</p>
      </div>
    </div>
  `;
}

function renderSummary(recs) {
  const summary = recs.summary || {};
  const eventName = recs.event?.name || "Unknown event";
  const updated = new Date(recs.generatedAt || Date.now()).toLocaleString();
  const dataState = {
    fieldPending: missingFieldData(recs),
    projectionPending: Number(summary.projectedCount || 0) === 0,
  };
  const topWarning = dataState.fieldPending
    ? "Houston field not published yet"
    : summary.warnings?.[0];

  document.getElementById("meta").textContent = `${eventName} | Updated ${updated} | Strategy: ${recs.strategy}`;
  document.getElementById("heroBar").innerHTML = [
    `<span class="hero-pill"><strong>Current event</strong> ${escapeHtml(recs.currentEvent?.name || "N/A")}</span>`,
    `<span class="hero-pill"><strong>Decision event</strong> ${escapeHtml(eventName)}</span>`,
    `<span class="hero-pill"><strong>Board confidence</strong> ${escapeHtml(summary.confidenceLabel || "N/A")}</span>`,
    topWarning ? `<span class="warning-pill"><strong>Watch</strong> ${escapeHtml(topWarning)}</span>` : "",
  ].join("");

  document.getElementById("statusPanel").innerHTML = dataState.fieldPending
    ? `
      <div class="status-panel pending">
        <strong>Weekly board is in holding mode.</strong>
        <p>The PGA TOUR field for ${escapeHtml(eventName)} is still empty upstream, so this page is suppressing weekly payout numbers instead of pretending they are zero.</p>
      </div>
    `
    : "";

  document.getElementById("summary").innerHTML = `
    <div class="summary-stat">
      <span>Available options</span>
      <strong>${summary.totalAvailable ?? 0}</strong>
      <p>Golfers still unused in your pool.</p>
    </div>
    <div class="summary-stat">
      <span>Confirmed field</span>
      <strong>${summary.eligibleCount ?? 0}</strong>
      <p>Available golfers confirmed for the upcoming event.</p>
    </div>
    <div class="summary-stat">
      <span>Projected payouts</span>
      <strong>${dataState.projectionPending ? "Pending" : summary.projectedCount ?? 0}</strong>
      <p>${dataState.projectionPending ? "Weekly payout modeling is waiting on published field data." : "Available golfers with an explicit weekly payout estimate."}</p>
    </div>
    <div class="summary-stat">
      <span>Field size tracked</span>
      <strong>${dataState.fieldPending ? "Pending" : summary.nextTournamentFieldCount ?? 0}</strong>
      <p>${dataState.fieldPending ? "PGA TOUR has not populated the next-event field yet." : "Names matched into the next-tournament field list."}</p>
    </div>
  `;

  return dataState;
}

function renderDecisionViews(recs, dataState) {
  const views = recs.views || {};
  document.getElementById("decisionViews").innerHTML = [
    viewCard("Best balanced", "Best all-around weekly option after field and trust checks.", views.balanced, "Balanced score", formatScore(views.balanced?.score), dataState),
    viewCard("Best projection", "Use this when pure weekly payout matters more than uniqueness.", views.expected, "Projected upside", formatPercent(views.expected?.decisionScores?.expected), dataState),
    viewCard("Best leverage", "Use this when you want separation from Paul, Dakota, and Mike.", views.leverage, "Leverage", formatPercent(views.leverage?.decisionScores?.leverage), dataState),
    viewCard("Best low-regret spend", "Use this when you want a playable pick without burning future ceiling.", views.preservation, "Low-regret spend", formatPercent(views.preservation?.decisionScores?.preservation), dataState),
  ].join("");
}

function renderWarnings(recs) {
  const warnings = [...(recs.summary?.warnings || [])];
  if (missingFieldData(recs)) {
    warnings.unshift(
      `The PGA TOUR field for ${recs.event?.name || "the decision event"} has not been published yet, so weekly payout metrics and field-confirmed labels are withheld.`
    );
  }
  document.getElementById("warnings").innerHTML = warnings.length
    ? warnings.map((warning) => `<div class="term"><p>${escapeHtml(warning)}</p></div>`).join("")
    : `<div class="term"><p>No major data-quality warnings were detected in the current build.</p></div>`;
}

function renderRoadmapList(targetId, items) {
  document.getElementById(targetId).innerHTML = (items || []).length
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>No roadmap items yet.</li>";
}

function renderRoadmap(roadmap) {
  if (!roadmap) return;

  document.getElementById("roadmapSummary").innerHTML = `
    <div class="summary-stat">
      <span>Current phase</span>
      <strong>${escapeHtml(roadmap.currentPhase?.name || "N/A")}</strong>
      <p>${escapeHtml(roadmap.currentState?.summary || "No current-state summary available.")}</p>
    </div>
    <div class="summary-stat">
      <span>Next phase</span>
      <strong>${escapeHtml(roadmap.nextPhase?.name || "N/A")}</strong>
      <p>${escapeHtml(roadmap.nextPhase?.summary || "No next-phase summary available.")}</p>
    </div>
    <div class="summary-stat">
      <span>Later phase</span>
      <strong>${escapeHtml(roadmap.laterPhase?.name || "N/A")}</strong>
      <p>${escapeHtml(roadmap.laterPhase?.summary || "No later-phase summary available.")}</p>
    </div>
  `;

  document.getElementById("roadmapCurrentTitle").textContent = roadmap.currentPhase?.name || "Current phase";
  document.getElementById("roadmapCurrentSummary").textContent =
    roadmap.currentPhase?.summary || "No current-phase summary available.";
  renderRoadmapList("roadmapCurrentItems", roadmap.currentPhase?.items);

  document.getElementById("roadmapNextTitle").textContent = roadmap.nextPhase?.name || "Next phase";
  document.getElementById("roadmapNextSummary").textContent =
    roadmap.nextPhase?.summary || "No next-phase summary available.";
  renderRoadmapList("roadmapNextItems", roadmap.nextPhase?.items);

  document.getElementById("roadmapLaterTitle").textContent = roadmap.laterPhase?.name || "Later phase";
  document.getElementById("roadmapLaterSummary").textContent =
    roadmap.laterPhase?.summary || "No later-phase summary available.";
  renderRoadmapList("roadmapLaterItems", roadmap.laterPhase?.items);
  renderRoadmapList("roadmapCompleted", roadmap.completedFoundation);

  document.getElementById("roadmapTimeline").innerHTML = (roadmap.buildTimeline || []).length
    ? roadmap.buildTimeline
        .map(
          (item) => `
            <div class="timeline-item">
              <div class="timeline-badge">${escapeHtml(item.timing || "Planned")}</div>
              <div class="timeline-copy">
                <strong>${escapeHtml(item.title || "Milestone")}</strong>
                <p>${escapeHtml(item.summary || "")}</p>
              </div>
            </div>
          `
        )
        .join("")
    : '<div class="term"><p>No build timeline milestones are recorded yet.</p></div>';
}

async function init() {
  const [recsResponse, roadmapResponse] = await Promise.all([
    fetch(new URL("../data/recommendations.json", import.meta.url)),
    fetch(new URL("../data/product_roadmap.json", import.meta.url)),
  ]);

  if (!recsResponse.ok) {
    throw new Error("Could not load recommendations.json");
  }

  if (!roadmapResponse.ok) {
    throw new Error("Could not load product_roadmap.json");
  }

  const [recs, roadmap] = await Promise.all([recsResponse.json(), roadmapResponse.json()]);
  const dataState = renderSummary(recs);
  renderDecisionViews(recs, dataState);
  document.getElementById("primary").innerHTML = cardForCandidate(recs.primary, "Recommended click", dataState);
  document.getElementById("alternates").innerHTML = (recs.alternates || [])
    .map((candidate, idx) => `<article class="card">${cardForCandidate(candidate, `Alternate ${idx + 1}`, dataState)}</article>`)
    .join("");
  renderWarnings(recs);
  renderScoreKey();
  renderRoadmap(roadmap);

  const candidateSources = [recs.primary, ...(recs.alternates || [])]
    .flatMap((candidate) => candidate?.sourceRefs || []);
  const notes = [...new Set([...(recs.sourceNotes || []), ...candidateSources])];
  document.getElementById("sources").innerHTML = notes.length
    ? notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
    : "<li>No online source notes loaded.</li>";
}

init().catch((error) => {
  document.getElementById("meta").textContent = error.message;
});
