const state = {
  selectedId: "product_blackwell_gpu",
  selectedKind: "node",
  showCandidates: false,
  graphMode: "focus",
  activeDrawerTab: "nodes",
  drawerOpen: false,
  activeTypes: new Set(["product", "technology", "company", "metric"]),
  activeCategories: new Set(),
  search: "",
  focusedCategory: null,
  inboxMessage: null,
  drawerMessage: null
};

let nodes = [];
let nodeById = new Map();
let relations = [];
let relationById = new Map();
let relationByTuple = new Map();
let referencesById = new Map();

const apiState = {
  available: false,
  loading: false
};

const categoryLabels = {
  compute: "Compute",
  memory: "Memory",
  packaging: "Packaging",
  networking: "Networking",
  power: "Power",
  cooling: "Cooling",
  server: "Server / ODM",
  cloud: "Cloud",
  system: "Systems",
  foundry_packaging: "Foundry",
  power_cooling: "Power / Cooling",
  optical: "Optical",
  server_odm: "Server ODM"
};

const typeLabels = {
  theme: "Theme",
  module: "Module",
  product: "Product",
  technology: "Technology",
  company: "Company",
  metric: "Metric"
};

const typeGlyphs = {
  theme: "B",
  module: "M",
  product: "P",
  technology: "T",
  company: "C",
  metric: "$"
};

const canvas = document.getElementById("graphCanvas");
const detailPanel = document.getElementById("detailPanel");
const drawerContent = document.getElementById("drawerContent");
const drawerStatus = document.getElementById("drawerStatus");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
document.body.appendChild(searchResults);
const STORAGE_KEY = "nodenet.blackwell.prototype.v1";

function setGraphData(nextGraphData) {
  graphData.nodes = nextGraphData.nodes || [];
  graphData.relations = (nextGraphData.relations || []).map((relation) => ({
    ...relation,
    properties: relation.properties || {},
    tupleId: relation.tupleId || `${relation.source}:${relation.type}:${relation.target}`
  }));
  graphData.references = nextGraphData.references || [];
  graphData.evidenceLinks = nextGraphData.evidenceLinks || nextGraphData.evidence_links || [];

  nodes = graphData.nodes;
  nodeById = new Map(nodes.map((node) => [node.id, node]));
  relations = graphData.relations;
  relationById = new Map(relations.map((relation) => [relation.id, relation]));
  relationByTuple = new Map(relations.map((relation) => [relation.tupleId, relation]));
  referencesById = new Map(graphData.references.map((reference) => [reference.id, reference]));
}

async function loadApiGraph() {
  apiState.loading = true;
  try {
    const response = await fetch("/api/graph", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`API unavailable: ${response.status}`);
    const payload = await response.json();
    setGraphData(payload);
    apiState.available = true;
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    apiState.available = false;
    restoreLocalState();
  } finally {
    apiState.loading = false;
  }
}

async function syncApi(path, options = {}) {
  if (!apiState.available) return false;
  try {
    const response = await fetch(path, {
      method: options.method || "POST",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    const payload = await response.json();
    setGraphData(payload);
    return payload;
  } catch (error) {
    console.warn("Unable to sync with API; keeping local state", error);
    apiState.available = false;
    return false;
  }
}

function setDrawerMessage(message) {
  state.drawerMessage = message;
  if (drawerStatus) drawerStatus.textContent = message || "";
}

function relationDisplay(relation) {
  const source = nodeById.get(relation.source);
  const target = nodeById.get(relation.target);
  return `${source?.title || relation.source} -> ${relation.type} -> ${target?.title || relation.target}`;
}

function getConnectedRelations(nodeId, options = {}) {
  return relations.filter((relation) => {
    const statusOk = options.includeCandidates || relation.status !== "candidate";
    return statusOk && (relation.source === nodeId || relation.target === nodeId);
  });
}

function getCandidateRelations(nodeId) {
  return relations.filter((relation) => relation.status === "candidate" && (relation.source === nodeId || relation.target === nodeId));
}

function getEvidenceForTarget(kind, targetId) {
  return graphData.evidenceLinks.filter((evidence) => evidence.target_type === kind && evidence.target_id === targetId);
}

function visibleStatuses() {
  const statuses = new Set();
  if (document.getElementById("statusConfirmed").checked) statuses.add("confirmed");
  if (document.getElementById("statusDisputed").checked) statuses.add("disputed");
  if (state.showCandidates || document.getElementById("statusCandidate").checked) statuses.add("candidate");
  return statuses;
}

function nodeMatchesFilters(node) {
  if (!state.activeTypes.has(node.type)) return false;
  if (!visibleStatuses().has(node.status)) return false;
  if (state.focusedCategory && node.properties?.category !== state.focusedCategory && node.id !== "theme_blackwell") return false;
  if (state.activeCategories.size > 0 && !state.activeCategories.has(node.properties?.category) && node.type !== "theme") return false;
  return true;
}

function relationMatchesFilters(relation, visibleNodeIds) {
  if (!visibleStatuses().has(relation.status)) return false;
  return visibleNodeIds.has(relation.source) && visibleNodeIds.has(relation.target);
}

function currentGraph() {
  if (state.graphMode === "focus") {
    const focused = buildFocusGraph();
    if (focused) return focused;
  }

  const visibleNodes = nodes.filter((node) => !["archived", "rejected", "merged"].includes(node.status));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleRelations = relations.filter((relation) => {
    if (["archived", "rejected", "merged"].includes(relation.status)) return false;
    return visibleNodeIds.has(relation.source) && visibleNodeIds.has(relation.target);
  });
  return { visibleNodes, visibleRelations, visibleNodeIds, positions: layoutGraph(visibleNodes, visibleRelations, { mode: "global" }) };
}

function relationIsResearchVisible(relation) {
  if (relation.status === "archived" || relation.status === "rejected" || relation.status === "merged") return false;
  if (relation.properties.evidence_priority === "grouping") return state.showCandidates;
  return true;
}

function nodeIsResearchVisible(node) {
  if (!node) return false;
  if (node.status === "archived" || node.status === "rejected" || node.status === "merged") return false;
  if (!state.activeTypes.has(node.type)) return false;
  if (state.focusedCategory && node.properties?.category !== state.focusedCategory && node.id !== state.selectedId) return false;
  if (state.activeCategories.size > 0 && !state.activeCategories.has(node.properties?.category) && node.id !== state.selectedId) return false;
  return true;
}

function buildFocusGraph() {
  if (state.selectedKind === "relation") {
    const relation = relationById.get(state.selectedId);
    if (!relation) return null;
    const visibleNodeIds = new Set([relation.source, relation.target]);
    const visibleNodes = [...visibleNodeIds].map((id) => nodeById.get(id)).filter(Boolean);
    const visibleRelations = [relation];
    return { visibleNodes, visibleRelations, visibleNodeIds, positions: layoutGraph(visibleNodes, visibleRelations) };
  }

  if (state.selectedKind !== "node" || !state.selectedId) return null;
  const selected = nodeById.get(state.selectedId);
  if (!selected || !nodeIsResearchVisible(selected)) return null;

  const visibleNodeIds = new Set([selected.id]);
  const visibleRelationIds = new Set();
  const firstHopIds = new Set();

  relations.forEach((relation) => {
    if (!relationIsResearchVisible(relation)) return;
    if (relation.source !== selected.id && relation.target !== selected.id) return;
    const otherId = relation.source === selected.id ? relation.target : relation.source;
    const other = nodeById.get(otherId);
    if (!nodeIsResearchVisible(other)) return;
    visibleNodeIds.add(otherId);
    firstHopIds.add(otherId);
    visibleRelationIds.add(relation.id);
  });

  relations.forEach((relation) => {
    if (!relationIsResearchVisible(relation)) return;
    if (!firstHopIds.has(relation.source) && !firstHopIds.has(relation.target)) return;
    const source = nodeById.get(relation.source);
    const target = nodeById.get(relation.target);
    if (!nodeIsResearchVisible(source) || !nodeIsResearchVisible(target)) return;
    const touchesProduct = source.type === "product" || target.type === "product";
    const touchesMetric = source.type === "metric" || target.type === "metric";
    const touchesCompany = source.type === "company" || target.type === "company";
    if (!touchesProduct && !touchesMetric && !touchesCompany) return;
    visibleNodeIds.add(relation.source);
    visibleNodeIds.add(relation.target);
    visibleRelationIds.add(relation.id);
  });

  const visibleNodes = [...visibleNodeIds].map((id) => nodeById.get(id)).filter(Boolean);
  const visibleRelations = relations.filter((relation) => visibleRelationIds.has(relation.id));
  return { visibleNodes, visibleRelations, visibleNodeIds, positions: layoutGraph(visibleNodes, visibleRelations) };
}

function layoutGraph(visibleNodes, visibleRelations, options = {}) {
  if (options.mode === "global") return layoutGlobalGraph(visibleNodes, visibleRelations);

  const positions = new Map();
  const center = { x: 540, y: 340 };
  const selectedNodeId = state.selectedKind === "node" ? state.selectedId : null;

  if (state.selectedKind === "relation") {
    const relation = relationById.get(state.selectedId);
    if (relation) {
      positions.set(relation.source, { x: 390, y: 340 });
      positions.set(relation.target, { x: 690, y: 340 });
    }
    return positions;
  }

  if (selectedNodeId && visibleNodes.some((node) => node.id === selectedNodeId)) {
    positions.set(selectedNodeId, center);
    const neighborIds = new Set();
    visibleRelations.forEach((relation) => {
      if (relation.source === selectedNodeId) neighborIds.add(relation.target);
      if (relation.target === selectedNodeId) neighborIds.add(relation.source);
    });
    const neighbors = [...neighborIds].map((id) => nodeById.get(id)).filter(Boolean);
    const orderedNeighbors = orderNodesForLayout(neighbors);
    const radius = orderedNeighbors.length > 6 ? 230 : 205;
    orderedNeighbors.forEach((node, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(orderedNeighbors.length, 1);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * Math.min(radius, 185)
      });
    });

    const secondHop = visibleNodes.filter((node) => node.id !== selectedNodeId && !neighborIds.has(node.id));
    orderNodesForLayout(secondHop).forEach((node, index) => {
      const anchor = findAnchorNeighbor(node.id, neighborIds, visibleRelations) || orderedNeighbors[index % Math.max(orderedNeighbors.length, 1)];
      const anchorPos = anchor ? positions.get(anchor.id) : center;
      const offset = index % 2 === 0 ? 92 : -92;
      positions.set(node.id, {
        x: Math.max(110, Math.min(980, anchorPos.x + offset)),
        y: Math.max(95, Math.min(600, anchorPos.y + 86))
      });
    });
  }

  const unpositioned = visibleNodes.filter((node) => !positions.has(node.id));
  orderNodesForLayout(unpositioned).forEach((node, index) => {
    positions.set(node.id, {
      x: 180 + (index % 5) * 180,
      y: 170 + Math.floor(index / 5) * 120
    });
  });

  return positions;
}

function layoutGlobalGraph(visibleNodes, visibleRelations) {
  const positions = new Map();
  const width = 1120;
  const height = 680;
  const center = { x: width / 2, y: height / 2 };
  const categories = [...new Set(visibleNodes.map((node) => node.properties?.category || node.type))].sort();
  const anchors = new Map(categories.map((category, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(categories.length, 1);
    return [category, {
      x: center.x + Math.cos(angle) * 215,
      y: center.y + Math.sin(angle) * 165
    }];
  }));

  const simNodes = visibleNodes.map((node, index) => {
    const category = node.properties?.category || node.type;
    const anchor = anchors.get(category) || center;
    const jitterAngle = (index * 137.5 * Math.PI) / 180;
    return {
      id: node.id,
      node,
      x: anchor.x + Math.cos(jitterAngle) * 28,
      y: anchor.y + Math.sin(jitterAngle) * 28,
      vx: 0,
      vy: 0
    };
  });
  const simById = new Map(simNodes.map((item) => [item.id, item]));

  for (let tick = 0; tick < 170; tick += 1) {
    for (let i = 0; i < simNodes.length; i += 1) {
      for (let j = i + 1; j < simNodes.length; j += 1) {
        const a = simNodes[i];
        const b = simNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = 1;
          dy = 1;
          distSq = 2;
        }
        const force = 280 / distSq;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }

    visibleRelations.forEach((relation) => {
      const a = simById.get(relation.source);
      const b = simById.get(relation.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = relation.status === "candidate" ? 132 : 112;
      const force = (distance - desired) * 0.018;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    simNodes.forEach((item) => {
      const category = item.node.properties?.category || item.node.type;
      const anchor = anchors.get(category) || center;
      if (item.id === state.selectedId) {
        item.x = center.x;
        item.y = center.y;
        item.vx = 0;
        item.vy = 0;
        return;
      }
      item.vx += (anchor.x - item.x) * 0.01;
      item.vy += (anchor.y - item.y) * 0.01;
      item.vx += (center.x - item.x) * 0.0025;
      item.vy += (center.y - item.y) * 0.0025;
      item.vx *= 0.72;
      item.vy *= 0.72;
      item.x = Math.max(120, Math.min(width - 120, item.x + item.vx));
      item.y = Math.max(118, Math.min(height - 95, item.y + item.vy));
    });
  }

  simNodes.forEach((item) => {
    positions.set(item.id, { x: item.x, y: item.y });
  });
  return positions;
}

function orderNodesForLayout(items) {
  const typeOrder = { product: 1, technology: 2, company: 3, metric: 4, module: 5, theme: 6 };
  return [...items].sort((a, b) => (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99) || a.title.localeCompare(b.title));
}

function findAnchorNeighbor(nodeId, neighborIds, visibleRelations) {
  for (const relation of visibleRelations) {
    if (relation.source === nodeId && neighborIds.has(relation.target)) return nodeById.get(relation.target);
    if (relation.target === nodeId && neighborIds.has(relation.source)) return nodeById.get(relation.source);
  }
  return null;
}

function isHotRelation(relation) {
  if (state.selectedKind === "relation") return state.selectedId === relation.id;
  if (state.selectedKind === "node") return relation.source === state.selectedId || relation.target === state.selectedId;
  return false;
}

function isDimObject(objectId) {
  if (state.graphMode === "global") return false;
  if (!state.selectedId) return false;
  if (state.selectedKind === "relation") {
    const relation = relationById.get(state.selectedId);
    return relation && objectId !== relation.source && objectId !== relation.target;
  }
  if (state.selectedKind === "node") {
    const connectedIds = new Set([state.selectedId]);
    getConnectedRelations(state.selectedId, { includeCandidates: true }).forEach((relation) => {
      connectedIds.add(relation.source);
      connectedIds.add(relation.target);
    });
    return !connectedIds.has(objectId);
  }
  return false;
}

function renderFilters() {
  const moduleFilters = document.getElementById("moduleFilters");
  const categories = [...new Set(nodes.map((node) => node.properties?.category).filter(Boolean))].sort();
  moduleFilters.innerHTML = categories.map((category) => {
    const checked = state.activeCategories.size === 0 || state.activeCategories.has(category);
    const count = nodes.filter((node) => node.properties?.category === category).length;
    return `
      <label class="filter-row ${checked ? "active" : ""}">
        <input type="checkbox" data-category="${category}" ${checked ? "checked" : ""}>
        <span>${categoryLabels[category] || category}</span>
        <span class="count">${count}</span>
      </label>
    `;
  }).join("");

  moduleFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const allCategories = categories;
      if (state.activeCategories.size === 0) {
        state.activeCategories = new Set(allCategories);
      }
      if (input.checked) state.activeCategories.add(input.dataset.category);
      else state.activeCategories.delete(input.dataset.category);
      if (state.activeCategories.size === allCategories.length) state.activeCategories.clear();
      state.focusedCategory = null;
      render();
    });
  });

  const typeFilters = document.getElementById("typeFilters");
  typeFilters.innerHTML = Object.entries(typeLabels).map(([type, label]) => {
    const count = nodes.filter((node) => node.type === type).length;
    return `
      <label class="filter-row ${state.activeTypes.has(type) ? "active" : ""}">
        <input type="checkbox" data-type="${type}" ${state.activeTypes.has(type) ? "checked" : ""}>
        <span>${label}</span>
        <span class="count">${count}</span>
      </label>
    `;
  }).join("");

  typeFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.activeTypes.add(input.dataset.type);
      else state.activeTypes.delete(input.dataset.type);
      render();
    });
  });
}

function createSvg(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderGraph() {
  const { visibleNodes, visibleRelations, positions } = currentGraph();
  const globalMode = state.graphMode === "global";
  canvas.innerHTML = "";
  canvas.setAttribute("viewBox", "0 0 1120 680");

  const defs = createSvg("defs");
  const marker = createSvg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.appendChild(createSvg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#6b778d" }));
  defs.appendChild(marker);
  canvas.appendChild(defs);

  const edgeLayer = createSvg("g", { class: "edges" });
  visibleRelations.forEach((relation) => {
    const source = nodeById.get(relation.source);
    const target = nodeById.get(relation.target);
    if (!source || !target) return;
    const sourcePos = positions.get(source.id) || source;
    const targetPos = positions.get(target.id) || target;
    const lineClass = ["edge", relation.status, relation.properties.evidence_priority === "grouping" ? "grouping" : "", isHotRelation(relation) ? "hot" : "", state.selectedId && !isHotRelation(relation) ? "dim" : ""].filter(Boolean).join(" ");
    const line = createSvg("line", { class: lineClass, x1: sourcePos.x, y1: sourcePos.y, x2: targetPos.x, y2: targetPos.y });
    edgeLayer.appendChild(line);

    if (!globalMode && relation.properties.evidence_priority !== "grouping") {
      const label = createSvg("text", {
        class: `edge-label ${state.selectedId && !isHotRelation(relation) ? "dim" : ""}`,
        x: (sourcePos.x + targetPos.x) / 2,
        y: (sourcePos.y + targetPos.y) / 2 - 7,
        "text-anchor": "middle"
      });
      label.textContent = relation.type;
      edgeLayer.appendChild(label);
    }

    const hit = createSvg("line", { class: "edge-hit", x1: sourcePos.x, y1: sourcePos.y, x2: targetPos.x, y2: targetPos.y });
    hit.addEventListener("click", () => selectRelation(relation.id));
    edgeLayer.appendChild(hit);
  });
  canvas.appendChild(edgeLayer);

  const nodeLayer = createSvg("g", { class: "nodes" });
  visibleNodes.forEach((node) => {
    const nodePos = positions.get(node.id) || node;
    const width = node.type === "theme" ? 250 : node.type === "module" ? 150 : node.type === "company" ? 132 : 154;
    const height = node.type === "theme" ? 42 : 58;
    const globalRadius = nodeRadius(node);
    const group = createSvg("g", {
      class: ["node", globalMode ? "global-node" : "focus-node", node.type, node.status, state.selectedKind === "node" && state.selectedId === node.id ? "selected" : "", isDimObject(node.id) ? "dim" : ""].filter(Boolean).join(" "),
      transform: globalMode ? `translate(${nodePos.x}, ${nodePos.y})` : `translate(${nodePos.x - width / 2}, ${nodePos.y - height / 2})`,
      tabindex: "0",
      role: "button",
      "aria-label": node.title
    });
    group.addEventListener("click", () => selectNode(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectNode(node.id);
    });

    if (globalMode) {
      group.appendChild(createSvg("circle", { class: "node-dot", cx: 0, cy: 0, r: globalRadius }));
      if (shouldShowGlobalLabel(node, visibleRelations)) {
        const title = createSvg("text", { class: "node-title", x: globalRadius + 7, y: 4 });
        title.textContent = shortNodeLabel(node);
        group.appendChild(title);
      }
      if (node.id === state.selectedId && node.type === "company" && node.properties?.ticker) {
        const meta = createSvg("text", { class: "node-meta", x: globalRadius + 7, y: 19 });
        meta.textContent = node.properties.ticker;
        group.appendChild(meta);
      }
    } else {
      group.appendChild(createSvg("rect", { class: "node-card", width, height, rx: 10, ry: 10 }));

      if (node.type !== "theme") {
        group.appendChild(renderNodeSymbol(node.type, 18, node.type === "module" ? 20 : 19));
      }

      const title = createSvg("text", { class: "node-title", x: node.type === "theme" ? 14 : 34, y: node.type === "theme" ? 26 : 24 });
      title.textContent = node.title.length > 24 ? `${node.title.slice(0, 22)}...` : node.title;
      group.appendChild(title);

      if (node.type !== "theme") {
        const meta = createSvg("text", { class: "node-meta", x: 34, y: 43 });
        const ticker = node.properties?.ticker ? ` / ${node.properties.ticker}` : "";
        meta.textContent = `${typeLabels[node.type]}${ticker}`;
        group.appendChild(meta);
      }
    }

    const candidateCount = getCandidateRelations(node.id).length;
    if (!globalMode && candidateCount && !state.showCandidates) {
      const badge = createSvg("g", { transform: globalMode ? `translate(${globalRadius - 2}, ${-globalRadius - 13})` : `translate(${width - 22}, -8)` });
      badge.appendChild(createSvg("circle", { class: "badge", cx: 10, cy: 10, r: 10 }));
      const text = createSvg("text", { class: "badge-text", x: 10, y: 14, "text-anchor": "middle" });
      text.textContent = candidateCount;
      badge.appendChild(text);
      group.appendChild(badge);
    }

    nodeLayer.appendChild(group);
  });
  canvas.appendChild(nodeLayer);
}

function nodeRadius(node) {
  if (node.id === state.selectedId) return 13;
  if (node.type === "product") return 11;
  if (node.type === "technology") return 10;
  if (node.type === "company") return 8;
  if (node.type === "metric") return 7;
  return 6;
}

function shortNodeLabel(node) {
  if (node.type === "company" && node.properties?.ticker) return node.title.length > 14 ? node.properties.ticker : node.title;
  if (node.title.length > 18) return `${node.title.slice(0, 16)}...`;
  return node.title;
}

function shouldShowGlobalLabel(node, visibleRelations) {
  if (node.id === state.selectedId) return true;
  if (node.type === "product" || node.type === "technology") return true;
  if (node.type === "metric" && node.properties?.importance === "high") return true;
  if (["company_nvidia", "company_tsmc", "company_micron"].includes(node.id)) return true;
  const degree = visibleRelations.filter((relation) => relation.source === node.id || relation.target === node.id).length;
  return degree >= 3 && node.type !== "company";
}

function renderNodeSymbol(type, x, y) {
  if (type === "company") {
    return createSvg("circle", { class: `node-symbol ${type}`, cx: x, cy: y, r: 7 });
  }
  if (type === "technology") {
    return createSvg("polygon", { class: `node-symbol ${type}`, points: `${x},${y - 8} ${x + 7},${y - 4} ${x + 7},${y + 4} ${x},${y + 8} ${x - 7},${y + 4} ${x - 7},${y - 4}` });
  }
  if (type === "metric") {
    return createSvg("polygon", { class: `node-symbol ${type}`, points: `${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}` });
  }
  if (type === "module") {
    return createSvg("rect", { class: `node-symbol ${type}`, x: x - 7, y: y - 7, width: 14, height: 14, rx: 3 });
  }
  return createSvg("rect", { class: `node-symbol ${type}`, x: x - 7, y: y - 7, width: 14, height: 14, rx: 4 });
}

function renderNodeCard(node) {
  const connected = getConnectedRelations(node.id, { includeCandidates: true }).filter((relation) => relation.properties.evidence_priority !== "grouping");
  const confirmedConnected = connected.filter((relation) => relation.status !== "candidate");
  const candidateConnected = connected.filter((relation) => relation.status === "candidate");
  const evidence = getEvidenceForTarget("node", node.id);
  const properties = node.properties || {};

  const marketSnapshot = node.type === "company" && properties.market_snapshot ? `
    <section class="card-section">
      <h3>Market Snapshot</h3>
      <div class="market-grid">
        <div class="market-card"><span>1D Return</span><strong>${properties.market_snapshot.return_1d > 0 ? "+" : ""}${properties.market_snapshot.return_1d}%</strong></div>
        <div class="market-card"><span>Provider</span><strong>${properties.market_snapshot.fetch_quality}</strong></div>
        <div class="market-card"><span>Status</span><strong>latest only</strong></div>
      </div>
    </section>
  ` : "";

  detailPanel.innerHTML = `
    <div class="card-header">
      <div class="type-icon ${node.type}">${typeGlyphs[node.type] || "N"}</div>
      <div class="card-title">
        <h1>${node.title}</h1>
        <p>${node.summary || node.titleZh || "Graph object in the Blackwell workspace."}</p>
        <div class="status-row">
          <span class="tag ${node.status}"><span class="dot ${node.status}"></span>${node.status}</span>
          <span class="tag">${typeLabels[node.type]}</span>
          ${candidateConnected.length ? `<span class="tag candidate">${candidateConnected.length} candidate updates</span>` : ""}
        </div>
      </div>
    </div>
    <div class="card-tabs">
      <button class="active" type="button">Overview</button>
      <button type="button">Properties</button>
      <button type="button">Relations</button>
      <button type="button">Evidence</button>
      <button type="button">Candidate Updates</button>
    </div>
    <section class="card-section">
      <h3>Properties</h3>
      ${renderKeyValueTable({ type: node.type, ...properties })}
    </section>
    ${marketSnapshot}
    <section class="card-section priority-section">
      <h3>Evidence Status</h3>
      <div class="evidence-status-list">
        ${connected.map(renderRelationEvidenceStatus).join("") || `<div class="empty-state">No relation evidence to review.</div>`}
      </div>
    </section>
    <section class="card-section">
      <h3>Key Relations (${connected.length})</h3>
      <div class="relation-list">
        ${connected.map((relation) => renderRelationButton(relation)).join("") || `<div class="empty-state">No relations in the current graph.</div>`}
      </div>
    </section>
    <section class="card-section">
      <h3>Evidence</h3>
      <div class="evidence-list">
        ${evidence.map(renderEvidenceRow).join("") || `<div class="evidence-row"><strong>Missing direct evidence</strong><span>Confirmed nodes can exist as seed context, but relation-level evidence still needs review.</span></div>`}
      </div>
    </section>
    <section class="card-section">
      <h3>Candidate Updates (${candidateConnected.length})</h3>
      <div class="relation-list">
        ${candidateConnected.map((relation) => renderRelationButton(relation)).join("") || `<div class="empty-state">No pending candidate relations.</div>`}
      </div>
    </section>
  `;

  detailPanel.querySelectorAll("[data-relation-id]").forEach((button) => {
    button.addEventListener("click", () => selectRelation(button.dataset.relationId));
  });
}

function renderRelationCard(relation) {
  const source = nodeById.get(relation.source);
  const target = nodeById.get(relation.target);
  const evidence = relationEvidenceItems(relation);
  const evidenceState = relationEvidenceState(relation);
  const missingRequiredEvidence = evidenceState.kind === "missing";
  detailPanel.innerHTML = `
    <div class="card-header">
      <div class="type-icon ${missingRequiredEvidence ? "metric" : "product"}">R</div>
      <div class="card-title">
        <h1>${source?.title || relation.source} -> ${relation.type} -> ${target?.title || relation.target}</h1>
        <p>${evidenceState.description}</p>
        <div class="status-row">
          <span class="tag ${relation.status}"><span class="dot ${relation.status}"></span>${relation.status}</span>
          <span class="tag">confidence: ${relation.confidence}</span>
          <span class="tag ${evidenceState.kind}">${evidenceState.label}</span>
        </div>
      </div>
    </div>
    <div class="card-tabs">
      <button class="active" type="button">Overview</button>
      <button type="button">Properties</button>
      <button type="button">Evidence</button>
      <button type="button">Actions</button>
    </div>
    <section class="card-section">
      <h3>Relation</h3>
      ${renderKeyValueTable({
        source: source?.title || relation.source,
        type: relation.type,
        target: target?.title || relation.target,
        status: relation.status,
        confidence: relation.confidence,
        evidence_status: evidenceState.label,
        evidence_priority: relation.properties.evidence_priority
      })}
    </section>
    <section class="card-section">
      <h3>Evidence Links</h3>
      <div class="evidence-list">
        ${evidence.map(renderEvidenceRow).join("") || `<div class="evidence-row"><strong>No linked evidence yet</strong><span>This relation should remain candidate or visibly missing evidence until a source-backed EvidenceLink is reviewed.</span></div>`}
      </div>
    </section>
    <section class="card-section">
      <h3>Add Source Evidence</h3>
      <form class="evidence-form" data-evidence-form>
        <label>
          <span>Source title</span>
          <input name="title" type="text" placeholder="e.g. Micron earnings call excerpt" required>
        </label>
        <label>
          <span>Evidence summary</span>
          <textarea name="summary" rows="3" placeholder="What does this source support, contradict, or contextualize?" required></textarea>
        </label>
        <label>
          <span>Support level</span>
          <select name="support_level">
            <option value="supports">supports</option>
            <option value="strong_support">strong support</option>
            <option value="weak_support">weak support</option>
            <option value="contradicts">contradicts</option>
            <option value="contextualizes">contextualizes</option>
          </select>
        </label>
        <button type="submit">Add candidate evidence</button>
      </form>
    </section>
    <section class="card-section">
      <h3>Review Actions</h3>
      <div class="relation-list">
        <button class="relation-row" type="button" data-review-action="confirm"><strong>Confirm candidate</strong><span>Promote this relation and candidate evidence into confirmed state.</span></button>
        <button class="relation-row" type="button" data-review-action="reject"><strong>Reject candidate</strong><span>Keep the record out of normal graph views.</span></button>
        <button class="relation-row" type="button" data-review-action="dispute"><strong>Mark disputed</strong><span>Keep visible with warning status when trust is uncertain.</span></button>
        <button class="relation-row" type="button" data-review-action="archive"><strong>Archive</strong><span>Hide without hard deletion.</span></button>
      </div>
    </section>
  `;

  detailPanel.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => reviewRelation(relation.id, button.dataset.reviewAction));
  });

  const evidenceForm = detailPanel.querySelector("[data-evidence-form]");
  evidenceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(evidenceForm);
    addRelationEvidence(relation.id, {
      title: formData.get("title"),
      summary: formData.get("summary"),
      support_level: formData.get("support_level")
    });
  });
}

function renderRelationButton(relation) {
  const source = nodeById.get(relation.source);
  const target = nodeById.get(relation.target);
  const evidenceState = relationEvidenceState(relation);
  return `
    <button class="relation-row" type="button" data-relation-id="${relation.id}" data-relation-tuple="${relation.tupleId}">
      <strong>${source?.title || relation.source} -> ${relation.type} -> ${target?.title || relation.target}</strong>
      <span>${relation.status} / ${relation.confidence} / evidence priority: ${relation.properties.evidence_priority}</span>
      <em class="evidence-chip ${evidenceState.kind}">${evidenceState.label}</em>
    </button>
  `;
}

function relationEvidenceItems(relation) {
  return getEvidenceForTarget("relation", relation.tupleId).concat(getEvidenceForTarget("relation", relation.id));
}

function relationEvidenceState(relation) {
  const evidence = relationEvidenceItems(relation);
  const confirmed = evidence.filter((item) => item.status === "confirmed");
  const candidates = evidence.filter((item) => item.status === "candidate");
  if (confirmed.length) {
    return {
      kind: "confirmed",
      label: `${confirmed.length} confirmed evidence`,
      description: "This relation has reviewed source-backed evidence."
    };
  }
  if (candidates.length) {
    return {
      kind: "candidate",
      label: `${candidates.length} candidate evidence`,
      description: "This relation has source evidence waiting for human review."
    };
  }
  if (relation.properties.evidence_priority === "required") {
    return {
      kind: "missing",
      label: "missing required evidence",
      description: "This relation should not be confirmed until at least one EvidenceLink is reviewed."
    };
  }
  return {
    kind: "weak",
    label: "no evidence linked",
    description: "No source-backed EvidenceLink is attached yet."
  };
}

function renderRelationEvidenceStatus(relation) {
  const source = nodeById.get(relation.source);
  const target = nodeById.get(relation.target);
  const evidenceState = relationEvidenceState(relation);
  return `
    <button class="evidence-status-row" type="button" data-relation-id="${relation.id}" data-relation-tuple="${relation.tupleId}">
      <span>
        <strong>${source?.title || relation.source} -> ${relation.type} -> ${target?.title || relation.target}</strong>
        <small>${relation.status} / ${relation.confidence}</small>
      </span>
      <em class="evidence-chip ${evidenceState.kind}">${evidenceState.label}</em>
    </button>
  `;
}

async function reviewRelation(relationId, action) {
  const relation = relationById.get(relationId);
  if (!relation) return;

  const synced = await syncApi(`/api/relations/${encodeURIComponent(relationId)}/review`, { body: { action } });
  if (synced) {
    render();
    return;
  }

  if (action === "confirm") {
    relation.status = "confirmed";
    relationEvidenceItems(relation).forEach((evidence) => {
      if (evidence.status === "candidate") evidence.status = "confirmed";
    });
  }

  if (action === "reject") {
    relation.status = "rejected";
    relationEvidenceItems(relation).forEach((evidence) => {
      if (evidence.status === "candidate") evidence.status = "rejected";
    });
  }

  if (action === "dispute") {
    relation.status = "disputed";
  }

  if (action === "archive") {
    relation.status = "archived";
  }

  saveLocalState();
  render();
}

async function addRelationEvidence(relationId, values) {
  const relation = relationById.get(relationId);
  if (!relation) return;

  const synced = await syncApi(`/api/relations/${encodeURIComponent(relationId)}/evidence`, { body: values });
  if (synced) {
    render();
    return;
  }

  const now = Date.now();
  const referenceId = `user_ref_${now}`;
  const evidenceId = `user_ev_${now}`;
  graphData.references.push({
    id: referenceId,
    title: String(values.title || "Untitled source").trim(),
    source_type: "manual",
    status: "processed",
    metadata: {
      publisher: "Personal research",
      created_at: new Date(now).toISOString()
    }
  });
  referencesById.set(referenceId, graphData.references[graphData.references.length - 1]);
  graphData.evidenceLinks.push({
    id: evidenceId,
    reference_id: referenceId,
    target_type: "relation",
    target_id: relation.tupleId,
    status: "candidate",
    support_level: values.support_level || "supports",
    summary: String(values.summary || "").trim(),
    properties: { created_by: "manual_review" }
  });
  if (relation.status !== "confirmed" && relation.status !== "disputed") relation.status = "candidate";
  saveLocalState();
  render();
}

function saveLocalState() {
  const relationState = relations.map((relation) => ({
    id: relation.id,
    tupleId: relation.tupleId,
    status: relation.status,
    confidence: relation.confidence
  }));
  const evidenceState = graphData.evidenceLinks.map((evidence) => ({
    id: evidence.id,
    reference_id: evidence.reference_id,
    target_type: evidence.target_type,
    target_id: evidence.target_id,
    status: evidence.status,
    support_level: evidence.support_level,
    summary: evidence.summary,
    properties: evidence.properties || {}
  }));
  const referenceState = graphData.references.map((reference) => ({
    id: reference.id,
    title: reference.title,
    source_type: reference.source_type,
    status: reference.status,
    metadata: reference.metadata || {}
  }));
  const companyState = nodes.filter((node) => node.type === "company").map((node) => ({
    id: node.id,
    market_snapshot: node.properties?.market_snapshot || null
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ relationState, referenceState, evidenceState, companyState }));
}

function graphExportPayload() {
  return {
    exported_at: new Date().toISOString(),
    nodes,
    relations,
    references: graphData.references,
    evidence_links: graphData.evidenceLinks
  };
}

function downloadJsonPayload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportGraphState() {
  setDrawerMessage("Preparing backup...");

  if (apiState.available) {
    try {
      const response = await fetch("/api/export", { headers: { Accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json();
        downloadJsonPayload(payload, "blackwell-graph-backup.json");
        setDrawerMessage("Backend backup exported.");
        return;
      }
    } catch (error) {
      console.warn("Backend export unavailable; using local graph export", error);
    }
  }

  downloadJsonPayload(graphExportPayload(), "blackwell-graph-export.json");
  setDrawerMessage(apiState.available ? "Backend export unavailable; downloaded local JSON." : "Static mode: downloaded local JSON.");
}

function restoreLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    const savedRelations = new Map((saved.relationState || []).map((item) => [item.tupleId || item.id, item]));
    relations.forEach((relation) => {
      const savedRelation = savedRelations.get(relation.tupleId) || savedRelations.get(relation.id);
      if (!savedRelation) return;
      relation.status = savedRelation.status || relation.status;
      relation.confidence = savedRelation.confidence || relation.confidence;
    });

    const savedEvidence = new Map((saved.evidenceState || []).map((item) => [item.id, item]));
    (saved.referenceState || []).forEach((reference) => {
      if (referencesById.has(reference.id)) return;
      graphData.references.push(reference);
      referencesById.set(reference.id, reference);
    });
    (saved.evidenceState || []).forEach((evidence) => {
      if (graphData.evidenceLinks.some((item) => item.id === evidence.id)) return;
      graphData.evidenceLinks.push(evidence);
    });
    graphData.evidenceLinks.forEach((evidence) => {
      const item = savedEvidence.get(evidence.id);
      if (!item) return;
      evidence.status = item.status || evidence.status;
      evidence.support_level = item.support_level || evidence.support_level;
      evidence.summary = item.summary || evidence.summary;
      evidence.properties = item.properties || evidence.properties || {};
    });

    const savedCompanies = new Map((saved.companyState || []).map((item) => [item.id, item]));
    nodes.forEach((node) => {
      const item = savedCompanies.get(node.id);
      if (item?.market_snapshot && node.properties) node.properties.market_snapshot = item.market_snapshot;
    });
  } catch (error) {
    console.warn("Unable to restore local graph state", error);
  }
}

function renderEvidenceRow(evidence) {
  const reference = referencesById.get(evidence.reference_id);
  return `
    <div class="evidence-row">
      <strong>${reference?.title || evidence.reference_id}</strong>
      <span>${evidence.status} / ${evidence.support_level} - ${evidence.summary}</span>
    </div>
  `;
}

function renderKeyValueTable(values) {
  const rows = Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => {
    const printable = typeof value === "object" ? JSON.stringify(value) : value;
    return `<tr><td>${key}</td><td>${printable}</td></tr>`;
  });
  return `<table class="kv-table"><tbody>${rows.join("")}</tbody></table>`;
}

function renderDetail() {
  if (state.selectedKind === "relation") {
    const relation = relationById.get(state.selectedId);
    if (relation) renderRelationCard(relation);
    return;
  }
  const node = nodeById.get(state.selectedId) || nodeById.get("theme_blackwell");
  renderNodeCard(node);
}

function renderDrawer() {
  const { visibleNodes, visibleRelations } = currentGraph();
  const tab = state.activeDrawerTab;
  if (tab === "nodes") {
    drawerContent.innerHTML = renderTable(["Name", "Type", "Category", "Status", "Candidate Links"], visibleNodes.map((node) => [
      node.title,
      typeLabels[node.type],
      categoryLabels[node.properties?.category] || node.properties?.category || "-",
      node.status,
      getCandidateRelations(node.id).length
    ]));
  } else if (tab === "relations") {
    drawerContent.innerHTML = renderTable(["Relation", "Status", "Confidence", "Evidence Priority"], visibleRelations.map((relation) => [
      relationDisplay(relation),
      relation.status,
      relation.confidence,
      relation.properties.evidence_priority
    ]));
  } else if (tab === "references") {
    drawerContent.innerHTML = renderTable(["Title", "Type", "Status", "Detail"], graphData.references.map((reference) => [
      reference.title,
      reference.source_type,
      reference.status,
      referenceStatusDetail(reference)
    ]));
  } else if (tab === "evidence") {
    drawerContent.innerHTML = renderTable(["Reference", "Target", "Status", "Support", "Summary"], graphData.evidenceLinks.map((evidence) => [
      referencesById.get(evidence.reference_id)?.title || evidence.reference_id,
      evidence.target_id,
      evidence.status,
      evidence.support_level,
      evidence.summary
    ]));
  } else {
    drawerContent.innerHTML = renderInbox();
    bindInboxActions();
  }
}

function renderInbox() {
  const candidateEvidence = graphData.evidenceLinks.filter((evidence) => evidence.status === "candidate");
  const candidateRelations = relations.filter((relation) => relation.status === "candidate");
  const recentReferences = graphData.references.filter((reference) => reference.status !== "failed").slice(-6).reverse();
  const failedReferences = graphData.references.filter((reference) => reference.status === "failed");
  return `
    <div class="inbox-list">
      <form class="ingest-form" data-source-ingest-form>
        <div>
          <strong>Ingest Source</strong>
          <span>Paste notes, a source excerpt, or a URL. URL fetching uses the backend when available.</span>
        </div>
        <label>
          <span>Source title</span>
          <input name="title" type="text" placeholder="e.g. Micron HBM3E note" required>
        </label>
        <label>
          <span>URL</span>
          <input name="url" type="url" placeholder="https://example.com/source">
        </label>
        <label>
          <span>Source text / notes</span>
          <textarea name="text" rows="3" placeholder="Mention known nodes like Micron, HBM3E, TSMC, CoWoS..."></textarea>
        </label>
        <button type="submit">Create Candidates</button>
      </form>
      ${state.inboxMessage ? `<div class="inbox-message ${state.inboxMessage.kind}">${state.inboxMessage.text}</div>` : ""}
      <div class="inbox-subhead">References</div>
      ${recentReferences.map(renderReferenceInboxItem).join("") || `<div class="empty-state">No references ingested yet.</div>`}
      ${failedReferences.length ? `<div class="inbox-subhead">Failed ingestion</div>${failedReferences.map(renderReferenceInboxItem).join("")}` : ""}
      <div class="inbox-subhead">Candidate evidence</div>
      ${candidateEvidence.map(renderInboxEvidence).join("") || `<div class="empty-state">No candidate evidence waiting for review.</div>`}
      ${candidateRelations.length ? `<div class="inbox-subhead">Candidate relations without confirmed evidence</div>` : ""}
      ${candidateRelations.slice(0, 8).map((relation) => `
        <div class="inbox-item">
          <div>
            <strong>${relationDisplay(relation)}</strong>
            <span>${relation.confidence} confidence / ${relation.properties.evidence_priority} evidence priority</span>
          </div>
          <button type="button" data-inbox-open-relation="${relation.id}">Open</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReferenceInboxItem(reference) {
  const metadata = reference.metadata || {};
  return `
    <div class="inbox-item reference-item ${reference.status}" data-reference-id="${reference.id}">
      <div>
        <strong>${reference.title}</strong>
        <span>${reference.source_type} / ${reference.status} / ${referenceStatusDetail(reference)}</span>
        ${metadata.url ? `<p>${metadata.url}</p>` : ""}
        ${metadata.error ? `<p>${metadata.error}</p>` : ""}
      </div>
    </div>
  `;
}

function referenceStatusDetail(reference) {
  const metadata = reference.metadata || {};
  if (metadata.error) return metadata.error;
  if (metadata.url) return metadata.url;
  return metadata.publisher || "-";
}

function renderInboxEvidence(evidence) {
  const reference = referencesById.get(evidence.reference_id);
  const relation = relationByTuple.get(evidence.target_id) || relationById.get(evidence.target_id);
  return `
    <div class="inbox-item candidate-evidence" data-evidence-id="${evidence.id}">
      <div>
        <strong>${reference?.title || evidence.reference_id}</strong>
        <span>${relation ? relationDisplay(relation) : evidence.target_id}</span>
        <p>${evidence.summary}</p>
      </div>
      <div class="inbox-actions">
        ${relation ? `<button type="button" data-inbox-open-relation="${relation.id}">Open</button>` : ""}
        <button type="button" data-inbox-evidence-action="confirm" data-evidence-id="${evidence.id}">Confirm</button>
        <button type="button" data-inbox-evidence-action="reject" data-evidence-id="${evidence.id}">Reject</button>
      </div>
    </div>
  `;
}

function bindInboxActions() {
  const ingestForm = drawerContent.querySelector("[data-source-ingest-form]");
  if (ingestForm) {
    ingestForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(ingestForm);
      ingestSource({
        title: formData.get("title"),
        url: formData.get("url"),
        text: formData.get("text"),
        source_type: formData.get("url") ? "url" : "manual"
      });
    });
  }

  drawerContent.querySelectorAll("[data-inbox-open-relation]").forEach((button) => {
    button.addEventListener("click", () => selectRelation(button.dataset.inboxOpenRelation));
  });
  drawerContent.querySelectorAll("[data-inbox-evidence-action]").forEach((button) => {
    button.addEventListener("click", () => reviewEvidence(button.dataset.evidenceId, button.dataset.inboxEvidenceAction));
  });
}

async function reviewEvidence(evidenceId, action) {
  const evidence = graphData.evidenceLinks.find((item) => item.id === evidenceId);
  if (!evidence) return;

  const synced = await syncApi(`/api/evidence/${encodeURIComponent(evidenceId)}/review`, { body: { action } });
  if (synced) {
    render();
    return;
  }

  evidence.status = action === "confirm" ? "confirmed" : "rejected";
  const relation = relationByTuple.get(evidence.target_id) || relationById.get(evidence.target_id);
  if (relation && action === "confirm") relation.status = "confirmed";
  saveLocalState();
  render();
}

async function ingestSource(values) {
  const title = String(values.title || "").trim();
  const url = String(values.url || "").trim();
  const text = String(values.text || "").trim();
  if (!title || (!text && !url)) {
    state.inboxMessage = { kind: "failed", text: "Add a source title plus either URL or notes." };
    render();
    return;
  }

  if (url && !text) {
    const synced = await syncApi("/api/sources/ingest-url", { body: { title, url, source_type: "url" } });
    if (synced) {
      const ingest = synced.ingest || {};
      state.inboxMessage = ingest.status === "failed"
        ? { kind: "failed", text: `URL ingest failed: ${ingest.error || "Could not fetch source."}` }
        : { kind: "processed", text: ingest.duplicate ? "URL source already ingested recently." : "URL source ingested from backend." };
      state.activeDrawerTab = "references";
      state.drawerOpen = true;
      render();
      return;
    }

    recordFailedUrlReference({ title, url });
    saveLocalState();
    state.inboxMessage = { kind: "failed", text: "Backend unavailable. The URL reference was saved locally as failed for retry." };
    state.activeDrawerTab = "candidates";
    state.drawerOpen = true;
    render();
    return;
  }

  const synced = await syncApi("/api/sources/ingest", { body: { title, text, source_type: values.source_type || "manual" } });
  if (synced) {
    state.inboxMessage = { kind: "processed", text: url ? "Source notes ingested. URL metadata depends on backend support." : "Source notes ingested." };
    state.activeDrawerTab = "candidates";
    state.drawerOpen = true;
    render();
    return;
  }

  ingestSourceLocally({ title, url, text, source_type: values.source_type || "manual" });
  saveLocalState();
  state.inboxMessage = { kind: "processed", text: "Source notes ingested locally." };
  state.activeDrawerTab = "candidates";
  state.drawerOpen = true;
  render();
}

function recordFailedUrlReference(values) {
  const now = Date.now();
  const reference = {
    id: `failed_url_ref_${now}`,
    title: values.title,
    source_type: "url",
    status: "failed",
    metadata: {
      url: values.url,
      created_at: new Date(now).toISOString(),
      error: "URL fetch backend is not connected in this prototype."
    }
  };
  graphData.references.push(reference);
  referencesById.set(reference.id, reference);
}

function ingestSourceLocally(values) {
  const now = Date.now();
  const referenceId = `ingest_ref_${now}`;
  const haystack = `${values.title} ${values.text}`.toLowerCase();
  const matchedNodes = nodes.filter((node) => nodeAliases(node).some((alias) => aliasInText(alias, haystack)));
  const matchedIds = new Set(matchedNodes.map((node) => node.id));
  const summary = values.text.length > 220 ? `${values.text.slice(0, 217)}...` : values.text;
  graphData.references.push({
    id: referenceId,
    title: values.title,
    source_type: values.source_type,
    status: "processed",
    metadata: {
      publisher: "Manual ingest",
      url: values.url || undefined,
      created_at: new Date(now).toISOString(),
      matched_nodes: [...matchedIds],
      text: values.text
    }
  });
  referencesById.set(referenceId, graphData.references[graphData.references.length - 1]);

  let created = 0;
  const existingPairs = new Set();
  relations.forEach((relation) => {
    existingPairs.add(`${relation.source}|${relation.target}`);
    existingPairs.add(`${relation.target}|${relation.source}`);
    if (["contains", "groups"].includes(relation.type)) return;
    if (!matchedIds.has(relation.source) || !matchedIds.has(relation.target)) return;
    graphData.evidenceLinks.push(candidateEvidenceFromIngest(referenceId, relation.tupleId, summary, created));
    created += 1;
  });

  matchedNodes.forEach((source) => {
    matchedNodes.forEach((target) => {
      if (created >= 6 || source.id === target.id || existingPairs.has(`${source.id}|${target.id}`)) return;
      const type = inferLocalRelationType(source, target);
      if (!type) return;
      const relation = {
        id: `rel_${relations.length + 1}`,
        source: source.id,
        type,
        target: target.id,
        status: "candidate",
        confidence: "low",
        properties: { evidence_priority: "useful", created_by: "source_ingest" },
        tupleId: `${source.id}:${type}:${target.id}`
      };
      relations.push(relation);
      graphData.relations.push(relation);
      relationById.set(relation.id, relation);
      relationByTuple.set(relation.tupleId, relation);
      graphData.evidenceLinks.push(candidateEvidenceFromIngest(referenceId, relation.tupleId, summary, created));
      existingPairs.add(`${source.id}|${target.id}`);
      existingPairs.add(`${target.id}|${source.id}`);
      created += 1;
    });
  });
}

function candidateEvidenceFromIngest(referenceId, targetId, summary, index) {
  return {
    id: `ingest_ev_${Date.now()}_${index}`,
    reference_id: referenceId,
    target_type: "relation",
    target_id: targetId,
    status: "candidate",
    support_level: "supports",
    summary,
    properties: { created_by: "source_ingest" }
  };
}

function nodeAliases(node) {
  const aliases = [node.title, node.id.replaceAll("_", " "), node.titleZh, node.properties?.ticker, ...(node.properties?.aliases || [])];
  return aliases
    .filter((alias) => alias && String(alias).length >= 3)
    .map((alias) => String(alias).toLowerCase());
}

function aliasInText(alias, text) {
  if (/^[a-z0-9][a-z0-9 ]+[a-z0-9]$/.test(alias)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`).test(text);
  }
  return text.includes(alias);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferLocalRelationType(source, target) {
  if (source.type === "company" && target.type === "technology") return "exposed_to";
  if (source.type === "company" && target.type === "product") return "exposed_to";
  if (source.type === "product" && target.type === "technology") return "requires";
  if (source.type === "metric" && ["product", "technology"].includes(target.type)) return "affects";
  return null;
}

function renderTable(headers, rows) {
  if (!rows.length) return `<div class="empty-state">No records match the current view.</div>`;
  return `
    <table class="data-table">
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function renderCounts() {
  document.getElementById("candidateCount").textContent = relations.filter((relation) => relation.status === "candidate").length + nodes.filter((node) => node.status === "candidate").length;
  document.getElementById("inboxCount").textContent = graphData.evidenceLinks.filter((evidence) => evidence.status === "candidate").length;
}

function renderSearch() {
  const query = state.search.trim().toLowerCase();
  if (!query) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }
  const nodeMatches = nodes.filter((node) => {
    const haystack = `${node.title} ${node.titleZh || ""} ${node.summary || ""} ${JSON.stringify(node.properties)}`.toLowerCase();
    return haystack.includes(query);
  }).slice(0, 8);
  const relationMatches = relations.filter((relation) => relationDisplay(relation).toLowerCase().includes(query)).slice(0, 6);
  const evidenceMatches = graphData.evidenceLinks.filter((evidence) => evidence.summary.toLowerCase().includes(query)).slice(0, 4);
  const referenceMatches = graphData.references.filter((reference) => {
    const haystack = `${reference.title} ${reference.source_type} ${reference.status} ${referenceStatusDetail(reference)} ${JSON.stringify(reference.metadata || {})}`.toLowerCase();
    return haystack.includes(query);
  }).slice(0, 4);
  const html = [
    ...nodeMatches.map((node) => `<button class="search-result" data-kind="node" data-id="${node.id}"><strong>${node.title}</strong><span>${typeLabels[node.type]} / ${node.status}</span></button>`),
    ...relationMatches.map((relation) => `<button class="search-result" data-kind="relation" data-id="${relation.id}"><strong>${relationDisplay(relation)}</strong><span>${relation.status} / ${relation.confidence}</span></button>`),
    ...evidenceMatches.map((evidence) => `<button class="search-result" data-kind="evidence" data-id="${evidence.id}"><strong>${referencesById.get(evidence.reference_id)?.title || evidence.reference_id}</strong><span>${evidence.summary}</span></button>`),
    ...referenceMatches.map((reference) => `<button class="search-result" data-kind="reference" data-id="${reference.id}"><strong>${reference.title}</strong><span>${reference.source_type} / ${reference.status}</span></button>`)
  ].join("");
  searchResults.innerHTML = html || `<div class="empty-state">No matching graph objects.</div>`;
  searchResults.hidden = false;
  searchResults.querySelectorAll(".search-result").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.kind === "node") selectNode(button.dataset.id);
      if (button.dataset.kind === "relation") selectRelation(button.dataset.id);
      if (button.dataset.kind === "evidence") {
        state.activeDrawerTab = "evidence";
        state.drawerOpen = true;
        state.search = "";
        searchInput.value = "";
        searchResults.hidden = true;
        searchResults.innerHTML = "";
        document.querySelectorAll(".drawer-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.tab === "evidence"));
        render();
      }
      if (button.dataset.kind === "reference") {
        state.activeDrawerTab = "references";
        state.drawerOpen = true;
        state.search = "";
        searchInput.value = "";
        searchResults.hidden = true;
        searchResults.innerHTML = "";
        document.querySelectorAll(".drawer-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.tab === "references"));
        render();
      }
    });
  });
}

function selectNode(id) {
  state.selectedId = id;
  state.selectedKind = "node";
  state.search = "";
  searchInput.value = "";
  searchResults.hidden = true;
  searchResults.innerHTML = "";
  render();
}

function selectRelation(id) {
  state.selectedId = id;
  state.selectedKind = "relation";
  state.showCandidates = true;
  document.getElementById("statusCandidate").checked = true;
  document.getElementById("toggleCandidates").classList.add("active");
  document.getElementById("toggleCandidates").setAttribute("aria-pressed", "true");
  render();
}

function render() {
  document.querySelector(".app-shell").classList.toggle("drawer-expanded", state.drawerOpen);
  document.querySelector(".app-shell").dataset.graphMode = state.graphMode;
  document.querySelectorAll("[data-graph-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.graphMode === state.graphMode);
  });
  renderCounts();
  renderFilters();
  renderGraph();
  renderDetail();
  renderDrawer();
  renderSearch();
}

function bindEvents() {
  document.getElementById("toggleCandidates").addEventListener("click", (event) => {
    state.showCandidates = !state.showCandidates;
    document.getElementById("statusCandidate").checked = state.showCandidates;
    event.currentTarget.classList.toggle("active", state.showCandidates);
    event.currentTarget.setAttribute("aria-pressed", String(state.showCandidates));
    render();
  });

  document.getElementById("statusConfirmed").addEventListener("change", render);
  document.getElementById("statusDisputed").addEventListener("change", render);
  document.getElementById("statusCandidate").addEventListener("change", (event) => {
    state.showCandidates = event.target.checked;
    document.getElementById("toggleCandidates").classList.toggle("active", state.showCandidates);
    render();
  });

  document.querySelectorAll("[data-graph-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.graphMode = button.dataset.graphMode;
      render();
    });
  });

  document.querySelectorAll(".drawer-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".drawer-tabs button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.activeDrawerTab = button.dataset.tab;
      state.drawerOpen = true;
      document.querySelector(".app-shell").classList.add("drawer-expanded");
      renderDrawer();
    });
  });

  document.querySelectorAll(".saved-view").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".saved-view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.focusedCategory = button.dataset.category || null;
      if (button.dataset.focus) selectNode(button.dataset.focus);
      else render();
    });
  });

  document.getElementById("refreshMarket").addEventListener("click", async () => {
    const synced = await syncApi("/api/market/refresh");
    if (synced) {
      render();
      return;
    }

    nodes.filter((node) => node.type === "company" && node.properties.ticker).forEach((node, index) => {
      if (!node.properties.market_snapshot) node.properties.market_snapshot = {};
      node.properties.market_snapshot.return_1d = Number((((index % 7) - 3) * 0.42).toFixed(2));
      node.properties.market_snapshot.fetch_quality = "manual placeholder";
      node.properties.market_snapshot.updated_at = new Date().toISOString();
    });
    saveLocalState();
    render();
  });

  document.getElementById("openInbox").addEventListener("click", () => {
    state.activeDrawerTab = "candidates";
    state.drawerOpen = true;
    document.querySelectorAll(".drawer-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.tab === "candidates"));
    document.querySelector(".app-shell").classList.add("drawer-expanded");
    renderDrawer();
  });

  document.getElementById("exportGraph").addEventListener("click", exportGraphState);

  document.getElementById("resetLocalState").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });

  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderSearch();
  });

  document.querySelectorAll(".view-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".view-tabs button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (button.dataset.view === "map") state.drawerOpen = false;
      if (button.dataset.view === "table") {
        state.activeDrawerTab = "nodes";
        state.drawerOpen = true;
      }
      if (button.dataset.view === "evidence") {
        state.activeDrawerTab = "evidence";
        state.drawerOpen = true;
      }
      document.querySelector(".app-shell").classList.toggle("drawer-expanded", state.drawerOpen);
      document.querySelectorAll(".drawer-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeDrawerTab));
      renderDrawer();
    });
  });
}

async function init() {
  setGraphData(graphData);
  await loadApiGraph();
  bindEvents();
  render();
}

init();
