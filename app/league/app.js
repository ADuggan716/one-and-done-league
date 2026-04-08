const MEMBERS = ["Andrew", "Paul", "Dakota", "Mike"];

const state = {
  seasonSort: { key: "groupRank", dir: "asc" },
  weeklySort: { key: "earnings", dir: "desc" },
  leagueWideSort: { key: "pickCount", dir: "desc" },
  availabilitySort: { key: "worldRank", dir: "asc" },
  selectedEventId: "",
  selectedLeagueWideEventId: "",
  poolSearch: "",
  scope: "all",
};

const tabButtons = [...document.querySelectorAll(".tab")];
const standingsPanel = document.getElementById("standingsPanel");
const availabilityPanel = document.getElementById("availabilityPanel");

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function normalizeGolferName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeEventKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function canonicalDisplayEventKey(name) {
  const key = normalizeEventKey(name);
  if (key === "themasters" || key === "masterstournament") return "masterstournament";
  if (key === "theplayerschampionship" || key === "playerschampionship" || key === "theplayers" || key === "players") return "playerschampionship";
  if (key === "houstonopen" || key === "texaschildrenshoustonopen") return "texaschildrenshoustonopen";
  return key;
}

function compareDisplayEventRichness(left, right) {
  const leftRows = left?.rows || [];
  const rightRows = right?.rows || [];
  const leftSignal = leftRows.reduce((sum, row) => sum + Number(Boolean(row?.pick)) + Number(Boolean(row?.finish)) + Number(Number(row?.earnings || 0) > 0), 0);
  const rightSignal = rightRows.reduce((sum, row) => sum + Number(Boolean(row?.pick)) + Number(Boolean(row?.finish)) + Number(Number(row?.earnings || 0) > 0), 0);

  if (leftSignal !== rightSignal) return leftSignal - rightSignal;
  if (Number(Boolean(left?.startDate)) !== Number(Boolean(right?.startDate))) {
    return Number(Boolean(left?.startDate)) - Number(Boolean(right?.startDate));
  }
  return Number(left?.countsTowardSeasonTotals !== false) - Number(right?.countsTowardSeasonTotals !== false);
}

function sortComparator(sort) {
  return (a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;

    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av ?? "").localeCompare(String(bv ?? "")) * factor;
  };
}

function parseFinishRank(finish) {
  if (finish === null || finish === undefined || finish === "") return null;
  const raw = String(finish).trim().toUpperCase();
  if (!raw) return null;
  if (raw === "MC" || raw === "MDF" || raw === "WD" || raw === "DQ") return 999;
  const cleaned = raw.startsWith("T") ? raw.slice(1) : raw;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function eventRowsForDisplay(events) {
  const byName = new Map();
  for (const event of dedupeEventsById(events || [])) {
    const key = canonicalDisplayEventKey(event?.eventName || event?.name);
    if (!key) continue;
    const current = byName.get(key);
    if (!current || compareDisplayEventRichness(event, current) > 0) {
      byName.set(key, event);
    }
  }
  return [...byName.values()];
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

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const activeTab = btn.dataset.tab;
    standingsPanel.classList.toggle("hidden", activeTab !== "standings");
    availabilityPanel.classList.toggle("hidden", activeTab !== "availability");
  });
});

function renderNextTournament(snapshot) {
  const next = snapshot.nextTournament || snapshot.event || {};
  const isLive =
    snapshot.event &&
    normalizeEventKey(snapshot.event.name) === normalizeEventKey(next.name) &&
    snapshot.event.countsTowardSeasonTotals === false;
  const cardTitle = isLive ? "Current Tournament" : "Next Tournament";
  const kicker = isLive ? "Current Event" : "Upcoming Event";

  const nextTournamentMount = document.getElementById("nextTournament");
  const availabilityTournamentMount = document.getElementById("availabilityTournament");
  const nextHeading = nextTournamentMount?.closest(".card")?.querySelector("h2");
  const availabilityHeading = availabilityTournamentMount?.closest(".card")?.querySelector("h2");

  if (nextHeading) nextHeading.textContent = cardTitle;
  if (availabilityHeading) availabilityHeading.textContent = cardTitle;

  const html = `
    <div class="next-head">
      <div>
        <p class="kicker">${kicker}</p>
        <p class="event-title">${next.name || "TBD"}</p>
      </div>
      <div class="event-pills">
        ${isLive ? '<span class="live-pill">Live</span>' : ""}
        <span class="tier-pill">${next.tier || "-"}</span>
      </div>
    </div>
    <div class="next-grid">
      <div><span class="stat-label">Purse:</span><strong>${formatCurrency(next.totalPurse)}</strong></div>
      <div><span class="stat-label">1st Place:</span><strong>${formatCurrency(next.firstPrize)}</strong></div>
      <div><span class="stat-label">Last Year's Winner:</span><strong>${next.lastYearWinner || "-"}</strong></div>
    </div>
  `;

  nextTournamentMount.innerHTML = html;
  availabilityTournamentMount.innerHTML = html;
}

function renderUltimateChampionship(snapshot) {
  const teams = [...(snapshot.teams || [])].sort((a, b) => b.seasonEarnings - a.seasonEarnings);
  const leader = teams[0];
  const trailer = teams[1];

  if (!leader) {
    document.getElementById("ultimateChampionship").innerHTML = "No team data yet.";
    return;
  }

  const behind = trailer ? leader.seasonEarnings - trailer.seasonEarnings : 0;
  document.getElementById("ultimateChampionship").innerHTML = `
    <div class="championship-row first">
      <span>#1 ${leader.teamName}</span>
      <strong>${formatCurrency(leader.seasonEarnings)}</strong>
    </div>
    <div class="championship-row second">
      <span>#2 ${trailer?.teamName || "N/A"}</span>
      <strong>${formatCurrency(trailer?.seasonEarnings || 0)}</strong>
    </div>
    <div class="gap-line">Gap: ${formatCurrency(behind)}</div>
  `;
}

function renderSeasonTable(snapshot) {
  const table = document.getElementById("seasonTable");
  const rows = [...(snapshot.subgroupStandings || [])].sort(sortComparator(state.seasonSort));

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col sticky-col-head">${sortHeader("Member", "member", state.seasonSort)}</th>
        <th>${sortHeader("League Rank", "leagueRank", state.seasonSort)}</th>
        <th>${sortHeader("Group Rank", "groupRank", state.seasonSort)}</th>
        <th>${sortHeader("Season Earnings", "seasonEarnings", state.seasonSort)}</th>
        <th>${sortHeader("Last Week's Earnings", "weeklyEarnings", state.seasonSort)}</th>
        <th>${sortHeader("$ Behind", "toLeader", state.seasonSort)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `
        <tr>
          <td class="sticky-col sticky-col-body">${row.member}</td>
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
  const events = eventRowsForDisplay(snapshot.weeklyComparison || []);
  const liveEventId = events.find(
    (event) =>
      event.countsTowardSeasonTotals === false &&
      normalizeEventKey(event.eventName) === normalizeEventKey(snapshot.nextTournament?.name)
  )?.eventId;

  if (!state.selectedEventId && events.length) {
    state.selectedEventId = liveEventId || events.at(-1).eventId;
  }

  select.innerHTML = events.map((event) => `<option value="${event.eventId}">${event.eventName}</option>`).join("");

  if (![...select.options].some((o) => o.value === state.selectedEventId) && select.options.length) {
    state.selectedEventId = liveEventId && [...select.options].some((o) => o.value === liveEventId)
      ? liveEventId
      : select.options[0].value;
  }

  select.value = state.selectedEventId;
  select.addEventListener("change", () => {
    state.selectedEventId = select.value;
    renderWeeklyTable(snapshot);
  });
}

function renderWeeklyTable(snapshot) {
  const table = document.getElementById("weeklyTable");
  const event = eventRowsForDisplay(snapshot.weeklyComparison || []).find((e) => e.eventId === state.selectedEventId);

  if (!event) {
    table.innerHTML = "<tbody><tr><td>No event data found.</td></tr></tbody>";
    return;
  }

  const selectedEventIsLive =
    event.countsTowardSeasonTotals === false &&
    normalizeEventKey(event.eventName) === normalizeEventKey(snapshot.nextTournament?.name);
  const finishLabel = selectedEventIsLive ? "Current Place" : "Finish";
  const earningsLabel = selectedEventIsLive ? "Projected Earnings" : "Earnings";
  const rows = [...event.rows].sort(sortComparator(state.weeklySort));

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col sticky-col-head">${sortHeader("Member", "member", state.weeklySort)}</th>
        <th>${sortHeader("Pick", "pick", state.weeklySort)}</th>
        <th>${sortHeader(finishLabel, "finish", state.weeklySort)}</th>
        <th>${sortHeader(earningsLabel, "earnings", state.weeklySort)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `
        <tr>
          <td class="sticky-col sticky-col-body">${row.member}</td>
          <td>${row.pick || ""}</td>
          <td>${row.finish ?? ""}</td>
          <td>${row.earnings ? formatCurrency(row.earnings) : ""}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;

  bindSort("weeklyTable", state.weeklySort, () => renderWeeklyTable(snapshot));
}

function renderLeagueWideEventSelect(snapshot) {
  const select = document.getElementById("leagueWideEventSelect");
  const events = eventRowsForDisplay(snapshot.leagueWidePickHistory || []);
  const liveEventId = events.find(
    (event) =>
      event.countsTowardSeasonTotals === false &&
      normalizeEventKey(event.eventName) === normalizeEventKey(snapshot.nextTournament?.name)
  )?.eventId;

  if (!state.selectedLeagueWideEventId && events.length) {
    state.selectedLeagueWideEventId = liveEventId || events[0].eventId;
  }

  select.innerHTML = events.map((event) => `<option value="${event.eventId}">${event.eventName}</option>`).join("");

  if (![...select.options].some((option) => option.value === state.selectedLeagueWideEventId) && select.options.length) {
    state.selectedLeagueWideEventId = liveEventId && [...select.options].some((option) => option.value === liveEventId)
      ? liveEventId
      : select.options[0].value;
  }

  select.value = state.selectedLeagueWideEventId;
  select.addEventListener("change", () => {
    state.selectedLeagueWideEventId = select.value;
    renderLeagueWideTable(snapshot);
  });
}

function renderLeagueWideTable(snapshot) {
  const table = document.getElementById("leagueWideTable");
  const summary = document.getElementById("leagueWideSummary");
  const event = eventRowsForDisplay(snapshot.leagueWidePickHistory || []).find((item) => item.eventId === state.selectedLeagueWideEventId);

  if (!event) {
    summary.innerHTML = "";
    table.innerHTML = "<tbody><tr><td>No league-wide pick data found.</td></tr></tbody>";
    return;
  }

  const selectedEventIsLive =
    event.countsTowardSeasonTotals === false &&
    normalizeEventKey(event.eventName) === normalizeEventKey(snapshot.nextTournament?.name);
  const finishLabel = selectedEventIsLive ? "Current Place" : "Finish";
  const earningsLabel = selectedEventIsLive ? "Current Earnings" : "Earnings";
  const subgroupRows = eventRowsForDisplay(snapshot.weeklyComparison || [])
    .find((item) => normalizeEventKey(item.eventName) === normalizeEventKey(event.eventName))?.rows || [];
  const subgroupPickMap = new Map();
  for (const row of subgroupRows) {
    const golferKey = normalizeGolferName(row.pick);
    if (!golferKey) continue;
    const current = subgroupPickMap.get(golferKey) || [];
    current.push(row.member);
    subgroupPickMap.set(golferKey, current);
  }
  const topPickCount = Math.max(0, ...((event.rows || []).map((row) => Number(row.pickCount || 0))));
  const rows = [...(event.rows || [])]
    .map((row) => ({
      ...row,
      finishRank: parseFinishRank(row.finish),
      isMostChosen: Number(row.pickCount || 0) > 0 && Number(row.pickCount || 0) === topPickCount,
      subgroupMembers: subgroupPickMap.get(normalizeGolferName(row.golfer)) || [],
    }))
    .sort((a, b) => {
      if (state.leagueWideSort.key === "finish") {
        const av = a.finishRank ?? 9999;
        const bv = b.finishRank ?? 9999;
        return (av - bv) * (state.leagueWideSort.dir === "asc" ? 1 : -1);
      }
      return sortComparator(state.leagueWideSort)(a, b);
    });

  summary.innerHTML = [
    `<span class="summary-pill"><strong>${event.totalEntrants || rows.reduce((sum, row) => sum + Number(row.pickCount || 0), 0)}</strong> tracked picks</span>`,
    `<span class="summary-pill"><strong>${rows.length}</strong> golfers chosen</span>`,
    rows[0] ? `<span class="summary-pill"><strong>${rows[0].golfer}</strong> most chosen at ${rows[0].pickCount}</span>` : "",
  ].join("");

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col sticky-col-head">${sortHeader("Golfer", "golfer", state.leagueWideSort)}</th>
        <th>${sortHeader("Pick Count", "pickCount", state.leagueWideSort)}</th>
        <th>${sortHeader(finishLabel, "finish", state.leagueWideSort)}</th>
        <th>${sortHeader(earningsLabel, "earnings", state.leagueWideSort)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `
        <tr class="${row.isMostChosen ? "league-wide-leader-row" : ""}">
          <td class="sticky-col sticky-col-body">
            <div class="league-wide-golfer-cell">
              <span>${row.golfer || ""}</span>
              ${row.isMostChosen ? '<span class="leader-badge">Most chosen</span>' : ""}
              ${row.subgroupMembers.map((member) => `<span class="member-badge member-badge-${member.toLowerCase()}">${member}</span>`).join("")}
            </div>
          </td>
          <td><strong>${row.pickCount || 0}</strong></td>
          <td>${row.finish ?? ""}</td>
          <td>${row.earnings ? formatCurrency(row.earnings) : ""}</td>
        </tr>
      `).join("")}
    </tbody>
  `;

  bindSort("leagueWideTable", state.leagueWideSort, () => renderLeagueWideTable(snapshot));
}

function dedupeEventsById(events) {
  const byId = new Map();
  for (const event of events || []) {
    if (!event?.eventId) continue;
    byId.set(event.eventId, event);
  }
  return [...byId.values()];
}

function updateAvailabilityMatrixHeading(poolData) {
  const heading = document.getElementById("availabilityMatrix")?.closest(".card")?.querySelector("h2");
  if (!heading) return;
  const tournamentName = poolData?.tournamentName || "TBD";
  heading.textContent =
    state.scope === "next"
      ? `Availability Matrix - ${tournamentName}`
      : "Availability Matrix - Top 50";
}

function renderSeasonWeeklyTable(snapshot) {
  const table = document.getElementById("seasonWeeklyTable");
  const currentEventId = snapshot.event?.id || null;
  const isLiveCurrentEvent = snapshot.event?.countsTowardSeasonTotals === false;
  const events = eventRowsForDisplay(snapshot.weeklyComparison || []).filter((event) => {
    if (isLiveCurrentEvent && currentEventId && event.eventId === currentEventId) return false;
    return true;
  });
  events.sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));

  function parseFinishRank(finish) {
    if (finish === null || finish === undefined || finish === "") return null;
    const raw = String(finish).trim().toUpperCase();
    if (!raw) return null;
    if (raw === "MC" || raw === "MDF") return 999;
    const cleaned = raw.startsWith("T") ? raw.slice(1) : raw;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function weekClass(entry) {
    const finishRank = parseFinishRank(entry.finish);
    const earnings = Number(entry.earnings || 0);
    const hasResult = entry.pick || entry.finish !== "" || earnings > 0;

    if (finishRank === 1) return "first-place";
    if (finishRank !== null && finishRank <= 5) return "top-five";
    if (hasResult && earnings === 0) return "missed-cut";
    return "";
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col sticky-col-head compact-event-col">Tournament</th>
        ${MEMBERS.map((m) => `<th>${m}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${events
        .map(
          (event) => `
        <tr>
          <td class="event-cell sticky-col sticky-col-body compact-event-col">
            <strong>${event.eventName}</strong>
            <div class="event-sub">${event.startDate || ""}</div>
          </td>
          ${MEMBERS.map((member) => {
            const entry = (event.rows || []).find((r) => r.member === member) || {};
            const pick = entry.pick || "";
            const finish = entry.finish ?? "";
            const earnings = entry.earnings ? formatCurrency(entry.earnings) : "";
            const cls = weekClass(entry);
            return `
              <td>
                <div class="member-week ${cls}">
                  <div><span class="label">Pick</span><span>${pick}</span></div>
                  <div><span class="label">Finish</span><span>${finish}</span></div>
                  <div><span class="label">Earnings</span><span>${earnings}</span></div>
                </div>
              </td>
            `;
          }).join("")}
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;
}

function buildAvailabilityRows(poolData) {
  const golfers = poolData.golfers || [];
  return golfers
    .filter((g) => state.scope === "all" || g.inNextTournament)
    .filter((g) => g.name.toLowerCase().includes(state.poolSearch.trim().toLowerCase()))
    .map((g) => {
      const status = {};
      for (const member of MEMBERS) {
        const memberData = poolData.members?.[member] || { used: [], available: [] };
        const usedSet = new Set((memberData.used || []).map(normalizeGolferName));
        status[member] = usedSet.has(normalizeGolferName(g.name)) ? "Used" : "Avail";
      }
      return {
        golfer: g.name,
        worldRank: g.worldRank ?? 999,
        fedexPoints: g.fedexPoints ?? 0,
        seasonEarnings: g.seasonEarnings ?? 0,
        ...status,
      };
    })
    .sort(sortComparator(state.availabilitySort));
}

function renderAvailabilityMatrix(poolData) {
  const table = document.getElementById("availabilityMatrix");
  const rows = buildAvailabilityRows(poolData);
  updateAvailabilityMatrixHeading(poolData);

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col sticky-col-head">${sortHeader("Golfer", "golfer", state.availabilitySort)}</th>
        <th>${sortHeader("World Golf Rank", "worldRank", state.availabilitySort)}</th>
        <th>${sortHeader("FedEx Points", "fedexPoints", state.availabilitySort)}</th>
        <th>${sortHeader("Season Earnings", "seasonEarnings", state.availabilitySort)}</th>
        ${MEMBERS.map((m) => `<th>${m}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `
        <tr>
          <td class="sticky-col sticky-col-body">${row.golfer}</td>
          <td>${row.worldRank}</td>
          <td>${row.fedexPoints}</td>
          <td>${formatCurrency(row.seasonEarnings)}</td>
          ${MEMBERS.map((m) => `<td><span class="status-pill ${row[m] === "Used" ? "used" : "available"}">${row[m]}</span></td>`).join("")}
        </tr>
      `
        )
        .join("")}
    </tbody>
  `;

  bindSort("availabilityMatrix", state.availabilitySort, () => renderAvailabilityMatrix(poolData));
}

function bindAvailabilityControls(poolData) {
  const scopeAll = document.getElementById("scopeAll");
  const scopeNext = document.getElementById("scopeNext");

  scopeAll.addEventListener("click", () => {
    state.scope = "all";
    scopeAll.classList.add("active");
    scopeNext.classList.remove("active");
    renderAvailabilityMatrix(poolData);
  });

  scopeNext.addEventListener("click", () => {
    state.scope = "next";
    scopeNext.classList.add("active");
    scopeAll.classList.remove("active");
    renderAvailabilityMatrix(poolData);
  });

  document.getElementById("poolSearch").addEventListener("input", (event) => {
    state.poolSearch = event.target.value;
    renderAvailabilityMatrix(poolData);
  });
}

function renderSyncMeta(snapshot, pool) {
  document.getElementById("syncMeta").textContent = `Updated ${new Date(snapshot.updatedAt || pool.updatedAt || Date.now()).toLocaleString()}`;
}

async function init() {
  const snapshotUrl = new URL("./data/league_snapshot.json", import.meta.url);
  const poolUrl = new URL("./data/player_pool.json", import.meta.url);
  const [snapshotRes, poolRes] = await Promise.all([
    fetch(snapshotUrl),
    fetch(poolUrl),
  ]);

  if (!snapshotRes.ok || !poolRes.ok) {
    throw new Error("Failed to load JSON data files.");
  }

  const [snapshot, pool] = await Promise.all([snapshotRes.json(), poolRes.json()]);

  renderSyncMeta(snapshot, pool);
  renderNextTournament(snapshot);
  renderUltimateChampionship(snapshot);
  renderSeasonTable(snapshot);
  renderEventSelect(snapshot);
  renderWeeklyTable(snapshot);
  renderLeagueWideEventSelect(snapshot);
  renderLeagueWideTable(snapshot);
  renderSeasonWeeklyTable(snapshot);
  renderAvailabilityMatrix(pool);
  bindAvailabilityControls(pool);
}

init().catch((error) => {
  document.getElementById("syncMeta").textContent = `Load error: ${error.message}`;
});
