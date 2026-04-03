const dataPaths = [
  "../data/product_roadmap.json",
  "../../data/product_roadmap.json",
];

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

async function loadRoadmap() {
  const embedded = document.getElementById("embedded-roadmap-data");
  if (embedded?.textContent?.trim()) {
    try {
      return JSON.parse(embedded.textContent);
    } catch {
      // Fall through to fetch-based loading.
    }
  }

  for (const url of dataPaths) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // Try the next path.
    }
  }
  throw new Error("Roadmap data could not be loaded.");
}

function renderSignals(roadmap) {
  const strip = document.getElementById("signal-strip");
  strip.replaceChildren();

  const signals = [
    ["Current phase", roadmap?.currentPhase?.name || "Unknown"],
    ["Next phase", roadmap?.nextPhase?.name || "Unknown"],
    ["Timeline steps", String((roadmap?.buildTimeline || []).length)],
  ];

  for (const [label, value] of signals) {
    const pill = createEl("div", "signal-pill");
    pill.append(createEl("span", "", label));
    pill.append(createEl("strong", "", value));
    strip.append(pill);
  }
}

function renderPhaseCard(phase, tone, heading) {
  const card = createEl("article", `card phase-card ${tone}`);
  card.append(createEl("span", "phase-label", heading));
  card.append(createEl("h2", "", phase?.name || "Untitled phase"));
  card.append(createEl("p", "", phase?.summary || "No summary available."));

  const list = createEl("ul", "item-list");
  for (const item of phase?.items || []) {
    list.append(createEl("li", "", item));
  }
  card.append(list);
  return card;
}

function renderFoundations(items) {
  const container = document.getElementById("foundation-grid");
  container.replaceChildren();

  if (!items?.length) {
    const empty = createEl("div", "empty-state");
    empty.append(createEl("p", "", "No completed foundation items are recorded."));
    container.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = createEl("article", "card foundation-item");
    row.append(createEl("div", "foundation-index", String(index + 1).padStart(2, "0")));
    const copy = createEl("div");
    copy.append(createEl("h3", "", item));
    copy.append(createEl("p", "", "Completed capability that the product can already rely on."));
    row.append(copy);
    container.append(row);
  });
}

function renderTimeline(items) {
  const container = document.getElementById("timeline-grid");
  container.replaceChildren();

  if (!items?.length) {
    const empty = createEl("div", "empty-state");
    empty.append(createEl("p", "", "No timeline entries are recorded."));
    container.append(empty);
    return;
  }

  for (const item of items) {
    const row = createEl("article", "card timeline-card");
    row.append(createEl("div", "timeline-badge", item?.timing || "TBD"));
    const copy = createEl("div");
    copy.append(createEl("h3", "", item?.title || "Untitled milestone"));
    copy.append(createEl("p", "", item?.summary || "No summary available."));
    row.append(copy);
    container.append(row);
  }
}

function renderRoadmap(roadmap) {
  setText("product-name", roadmap?.product || "Product Roadmap");
  setText("current-summary", roadmap?.currentState?.summary || "No current state summary available.");
  setText("current-phase-name", roadmap?.currentPhase?.name || "Unknown phase");
  setText("current-phase-summary", roadmap?.currentPhase?.summary || "No current phase summary available.");
  setText("status-line", "Loaded from data/product_roadmap.json");

  renderSignals(roadmap);

  const phaseGrid = document.getElementById("phase-grid");
  phaseGrid.replaceChildren(
    renderPhaseCard(roadmap?.currentPhase, "current", "Now"),
    renderPhaseCard(roadmap?.nextPhase, "next", "Next"),
    renderPhaseCard(roadmap?.laterPhase, "later", "Later")
  );

  renderFoundations(roadmap?.completedFoundation || []);
  renderTimeline(roadmap?.buildTimeline || []);
}

function renderError(message) {
  setText("status-line", "Roadmap data failed to load.");
  const phaseGrid = document.getElementById("phase-grid");
  phaseGrid.replaceChildren();
  const error = createEl("article", "card error-state");
  error.append(createEl("h2", "", "Roadmap unavailable"));
  error.append(createEl("p", "", message));
  phaseGrid.append(error);
}

async function main() {
  try {
    const roadmap = await loadRoadmap();
    renderRoadmap(roadmap);
  } catch (error) {
    renderError(error.message);
  }
}

main();
