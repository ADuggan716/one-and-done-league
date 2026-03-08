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

function cardForCandidate(candidate) {
  if (!candidate) return "<p>No recommendation data yet.</p>";
  return `
    <p><strong>${candidate.golfer}</strong></p>
    <p class="score">Score: ${formatScore(candidate.score)}</p>
    <p>Projected earnings: ${formatCurrency(candidate.projectedEarnings)}</p>
    <p>Rival overlap estimate: ${candidate.projectedDupCount || 0}</p>
    <p>Future opportunity cost: ${formatCurrency(candidate.futureValue)}</p>
    <p><em>${candidate.rationale?.explanation || "No detailed rationale yet."}</em></p>
  `;
}

function renderScoredTable(scored) {
  const table = document.getElementById("scoredTable");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Golfer</th>
        <th>Score</th>
        <th>Projected Earnings</th>
        <th>Dup Risk</th>
        <th>Future Cost</th>
      </tr>
    </thead>
    <tbody>
      ${scored
        .map(
          (row) => `
          <tr>
            <td>${row.golfer}</td>
            <td>${formatScore(row.score)}</td>
            <td>${formatCurrency(row.projectedEarnings)}</td>
            <td>${row.projectedDupCount || 0}</td>
            <td>${formatCurrency(row.futureValue)}</td>
          </tr>
        `
        )
        .join("")}
    </tbody>
  `;
}

async function init() {
  const response = await fetch("/data/recommendations.json");
  if (!response.ok) {
    throw new Error("Could not load recommendations.json");
  }

  const recs = await response.json();
  document.getElementById("meta").textContent = `Updated ${new Date(recs.generatedAt || Date.now()).toLocaleString()} | Strategy: ${recs.strategy}`;
  document.getElementById("primary").innerHTML = cardForCandidate(recs.primary);
  document.getElementById("alternates").innerHTML = (recs.alternates || []).map((c) => `<article class="card">${cardForCandidate(c)}</article>`).join("");
  renderScoredTable(recs.scored || []);

  const warnings = recs.warnings || [];
  document.getElementById("warnings").innerHTML = warnings.length ? warnings.map((w) => `<li>${w}</li>`).join("") : "<li>No warnings.</li>";
  const notes = recs.sourceNotes || [];
  document.getElementById("sources").innerHTML = notes.length ? notes.map((n) => `<li>${n}</li>`).join("") : "<li>No online source notes loaded.</li>";
}

init().catch((error) => {
  document.getElementById("meta").textContent = error.message;
});
