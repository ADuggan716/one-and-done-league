const MEMBERS = ["Andrew", "Paul", "Dakota", "Mike"];

const state = {
  seasonSort: { key: "groupRank", dir: "asc" },
  weeklySort: { key: "earnings", dir: "desc" },
  poolSort: { key: "golfer", dir: "asc" },
  selectedEventId: "",
  seasonFilter: "",
  weeklyTierFilter: "all",
  poolTierFilter: "all",
  poolSearch: "",
};

const tabButtons = [...document.querySelectorAll(".tab")];
const performancePanel = document.getElementById("performancePanel");
const poolPanel = document.getElementById("poolPanel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const showPool = btn.dataset.tab === "pool";
    performancePanel.classList.toggle("hidden", showPool);
    poolPanel.classList.toggle("hidden", !showPool);
  });
});

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function bySort(sort) {
  return (a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;

    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  };
}

function sortHeader(label, key, sortState) {
  const arrow = sortState.key === key ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
  return `<button data-sort-key="${key}">${label}${arrow}</button>`;
}

function bindSort(tableId, sortState, renderFn) {
  const table = document.getElementById(tableId);
  table.querySelectorAll("[data-sort-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sortKey;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = "asc";
      }
      renderFn();
    });
  });
}

function renderLeagueContext(snapshot) {
  const context = document.getElementById("leagueContext");
  const league = snapshot.league || {};
  context.innerHTML = `
    <p><strong>${league.name || "League"}</strong></p>
    <p>Full League Rank: ${league.yourRank || "-"} / ${league.totalEntrants || 150}</p>
    <p>Percentile: ${(league.yourPercentile || 0).toFixed(1)}%</p>
    <p>Latest Event: ${snapshot.event?.name || "N/A"}</p>
  `;
}

function renderTeamComparison(snapshot) {
  const el = document.getElementById("teamComparison");
  const teams = snapshot.teams || [];
  el.innerHTML = teams
    .map(
      (team) => `
      <p><strong>${team.teamName}</strong> (${team.members.join(" + ")})</p>
      <p>Rank #${team.rank} | Season ${formatCurrency(team.seasonEarnings)} | Weekly ${formatCurrency(team.weeklyEarnings)} | To lead ${formatCurrency(team.toLeader)}</p>
    `
    )
    .join("<hr />");
}

function renderSeasonTable(snapshot) {
  const table = document.getElementById("seasonTable");
  const filter = state.seasonFilter.trim().toLowerCase();
  const rows = (snapshot.subgroupStandings || [])
    .filter((row) => row.member.toLowerCase().includes(filter))
    .sort(bySort(state.seasonSort));

  table.innerHTML = `
    <thead>
      <tr>
        <th>${sortHeader("Member", "member", state.seasonSort)}</th>
        <th>${sortHeader("League Rank", "leagueRank", state.seasonSort)}</th>
        <th>${sortHeader("Group Rank", "groupRank", state.seasonSort)}</th>
        <th>${sortHeader("Season Earnings", "seasonEarnings", state.seasonSort)}</th>
        <th>${sortHeader("Weekly Earnings", "weeklyEarnings", state.seasonSort)}</th>
        <th>${sortHeader("To Leader", "toLeader", state.seasonSort)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `
            <tr>
              <td>${row.member}</td>
              <td>${row.leagueRank ?? "-"}</td>
              <td>${row.groupRank}</td>
              <td>${formatCurrency(row.seasonEarnings)}</td>
              <td>${formatCurrency(row.weeklyEarnings)}</td>
              <td>${formatCurrency(row.toLeader)}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  bindSort("seasonTable", state.seasonSort, () => renderSeasonTable(snapshot));
}

function renderEventSelect(snapshot) {
  const select = document.getElementById("eventSelect");
  const events = snapshot.weeklyComparison || [];
  if (!state.selectedEventId && events.length) {
    state.selectedEventId = events.at(-1).eventId;
  }

  select.innerHTML = events
    .filter((event) => state.weeklyTierFilter === "all" || event.tier === state.weeklyTierFilter)
    .map((event) => `<option value="${event.eventId}">${event.eventName} (${event.tier})</option>`)
    .join("");

  if (![...select.options].some((o) => o.value === state.selectedEventId) && select.options.length) {
    state.selectedEventId = select.options[0].value;
  }

  select.value = state.selectedEventId;
  select.addEventListener("change", () => {
    state.selectedEventId = select.value;
    renderWeeklyTable(snapshot);
  });
}

function renderWeeklyTable(snapshot) {
  const table = document.getElementById("weeklyTable");
  const event = (snapshot.weeklyComparison || []).find((row) => row.eventId === state.selectedEventId);

  if (!event) {
    table.innerHTML = "<tbody><tr><td>No weekly data</td></tr></tbody>";
    return;
  }

  const rows = [...event.rows].sort(bySort(state.weeklySort));

  table.innerHTML = `
    <thead>
      <tr>
        <th>${sortHeader("Member", "member", state.weeklySort)}</th>
        <th>${sortHeader("Pick", "pick", state.weeklySort)}</th>
        <th>${sortHeader("Finish", "finish", state.weeklySort)}</th>
        <th>${sortHeader("Earnings", "earnings", state.weeklySort)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `
            <tr>
              <td>${row.member}</td>
              <td>${row.pick || "-"}</td>
              <td>${row.finish ?? "-"}</td>
              <td>${formatCurrency(row.earnings)}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  bindSort("weeklyTable", state.weeklySort, () => renderWeeklyTable(snapshot));
}

function computeCommonRemaining(poolData) {
  const sets = MEMBERS.map((m) => new Set(poolData.members?.[m]?.available || []));
  if (sets.length === 0) return [];
  const base = [...sets[0]];
  return base.filter((golfer) => sets.every((s) => s.has(golfer))).slice(0, 30);
}

function renderCommonRemaining(poolData) {
  const common = computeCommonRemaining(poolData);
  const el = document.getElementById("commonRemaining");
  el.innerHTML = common.length ? common.map((g) => `<span class="status-pill available">${g}</span>`).join(" ") : "No shared remaining golfers.";
}

function renderEventPurse(snapshot) {
  const weekly = (snapshot.weeklyComparison || []).find((w) => w.eventId === state.selectedEventId) || snapshot.weeklyComparison?.at(-1);
  const el = document.getElementById("eventPurse");
  el.innerHTML = weekly
    ? `<p><strong>${weekly.eventName}</strong></p><p>Total purse: ${formatCurrency(weekly.totalPurse)}</p><p>First place: ${formatCurrency(weekly.firstPrize)}</p>`
    : "No event selected.";
}

function renderMatrix(poolData) {
  const table = document.getElementById("availabilityMatrix");
  if (state.poolTierFilter !== "all" && poolData.eventTier !== state.poolTierFilter) {
    table.innerHTML = "<tbody><tr><td>No golfers for selected tier in current dataset.</td></tr></tbody>";
    return;
  }
  const allGolfers = new Set();

  for (const member of MEMBERS) {
    (poolData.members?.[member]?.available || []).forEach((g) => allGolfers.add(g));
    (poolData.members?.[member]?.used || []).forEach((g) => allGolfers.add(g));
  }

  let rows = [...allGolfers].map((golfer) => {
    let availableCount = 0;
    for (const member of MEMBERS) {
      const data = poolData.members?.[member] || { available: [] };
      if (data.available.includes(golfer)) availableCount += 1;
    }
    return { golfer, availableCount };
  });

  const search = state.poolSearch.trim().toLowerCase();
  if (search) rows = rows.filter((r) => r.golfer.toLowerCase().includes(search));

  rows.sort(bySort(state.poolSort));

  table.innerHTML = `
    <thead>
      <tr>
        <th>${sortHeader("Golfer", "golfer", state.poolSort)}</th>
        <th>${sortHeader("Avail Count", "availableCount", state.poolSort)}</th>
        ${MEMBERS.map((m) => `<th>${m}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((row) => {
          const cells = MEMBERS.map((member) => {
            const data = poolData.members?.[member] || { used: [], available: [] };
            const isUsed = data.used.includes(row.golfer);
            const cls = isUsed ? "used" : "available";
            return `<td><span class="status-pill ${cls}">${isUsed ? "Used" : "Avail"}</span></td>`;
          }).join("");
          return `<tr><td>${row.golfer}</td><td>${row.availableCount}</td>${cells}</tr>`;
        })
        .join("")}
    </tbody>
  `;

  bindSort("availabilityMatrix", state.poolSort, () => renderMatrix(poolData));
}

function renderWarnings(snapshot) {
  const warningsEl = document.getElementById("warnings");
  const warnings = snapshot.warnings || [];
  warningsEl.innerHTML = warnings.length ? warnings.map((w) => `<li>${w}</li>`).join("") : "<li>No warnings.</li>";
}

function renderSyncMeta(snapshot, pool) {
  document.getElementById("syncMeta").textContent = `Updated ${new Date(snapshot.updatedAt || pool.updatedAt || Date.now()).toLocaleString()}`;
}

function fallbackKey() {
  return "one-and-done-fallback";
}

function renderFallbackForm() {
  const rows = document.getElementById("fallbackRows");
  rows.innerHTML = MEMBERS.map((member) => {
    return `
      <label>
        ${member} Pick
        <input name="pick_${member}" type="text" placeholder="Golfer" />
      </label>
      <label>
        ${member} Earnings
        <input name="earnings_${member}" type="number" min="0" step="1000" placeholder="0" />
      </label>
    `;
  }).join("");

  const form = document.getElementById("fallbackForm");
  const status = document.getElementById("fallbackStatus");
  const existing = localStorage.getItem(fallbackKey());
  if (existing) {
    const parsed = JSON.parse(existing);
    for (const [key, val] of Object.entries(parsed)) {
      if (form.elements[key]) form.elements[key].value = val;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = {};
    new FormData(form).forEach((value, key) => {
      payload[key] = value;
    });
    localStorage.setItem(fallbackKey(), JSON.stringify(payload));
    status.textContent = "Fallback data saved locally.";
  });
}

function bindControls(snapshot, pool) {
  document.getElementById("seasonFilter").addEventListener("input", (event) => {
    state.seasonFilter = event.target.value;
    renderSeasonTable(snapshot);
  });

  document.getElementById("weeklyTierFilter").addEventListener("change", (event) => {
    state.weeklyTierFilter = event.target.value;
    renderEventSelect(snapshot);
    renderWeeklyTable(snapshot);
    renderEventPurse(snapshot);
  });

  document.getElementById("poolSearch").addEventListener("input", (event) => {
    state.poolSearch = event.target.value;
    renderMatrix(pool);
  });

  document.getElementById("poolTierFilter").addEventListener("change", (event) => {
    state.poolTierFilter = event.target.value;
    renderMatrix(pool);
  });
}

async function init() {
  const [snapshotRes, poolRes] = await Promise.all([
    fetch("/data/league_snapshot.json"),
    fetch("/data/player_pool.json"),
  ]);

  if (!snapshotRes.ok || !poolRes.ok) {
    throw new Error("Failed to load JSON data files.");
  }

  const [snapshot, pool] = await Promise.all([snapshotRes.json(), poolRes.json()]);

  renderLeagueContext(snapshot);
  renderTeamComparison(snapshot);
  renderSeasonTable(snapshot);
  renderEventSelect(snapshot);
  renderWeeklyTable(snapshot);
  renderEventPurse(snapshot);
  renderCommonRemaining(pool);
  renderMatrix(pool);
  renderWarnings(snapshot);
  renderSyncMeta(snapshot, pool);
  renderFallbackForm();
  bindControls(snapshot, pool);
}

init().catch((error) => {
  document.getElementById("syncMeta").textContent = `Load error: ${error.message}`;
});
