/* Front-end for the AI Fire Evacuation System.
   The browser keeps the state (grid + people) and asks Flask to run A*. */

const COST = { safe: 1, crowd: 3, smoke: 5, risk: 10, exit: 1 };
const ICON = { fire: "🔥", exit: "🚪", smoke: "💨", risk: "⚠️" };
const PALETTE = ["#ffd23f", "#3ddbd9", "#ff7ab6", "#9be564", "#ff9f45", "#b69cff", "#6ec5ff", "#f4f4f4"];
const $ = (id) => document.getElementById(id);

let grid = [], people = [], exitNames = {}, nextId = 1;
let routes = [], stats = null, focusId = null;
let tool = "person";
let revealed = Infinity;          // how many route steps are currently drawn
let exploredN = 0;                // how many expanded nodes the replay shows
let animTimer = null, replayTimer = null, clearTimer = null, simTimer = null, simBusy = false;
let evacuated = 0, trapped = 0, tick = 0;
let dragging = false, dragPaint = null;

const colorOf = (id) => PALETTE[(id - 1) % PALETTE.length];
const key = (r, c) => `${r},${c}`;
const focusRoute = () => routes.find((r) => r.person_id === focusId && r.found);

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, exit_names: exitNames }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Server error");
  return res.json();
}
function msg(text) { $("message").textContent = text; }
function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  $("log").prepend(li);
  while ($("log").children.length > 40) $("log").lastChild.remove();
}

/* ---------- building the grid ---------- */
function buildGrid() {
  const el = $("grid");
  el.innerHTML = "";
  el.style.gridTemplateColumns = `repeat(${grid[0].length}, 1fr)`;
  grid.forEach((row, r) => row.forEach((_, c) => {
    const d = document.createElement("div");
    d.dataset.r = r; d.dataset.c = c;
    el.appendChild(d);
  }));
}
const cellEl = (r, c) => $("grid").children[r * grid[0].length + c];

function render() {
  const fr = focusRoute();
  const order = {};                                  // explored node -> expansion order
  if (fr && exploredN > 0) fr.explored.slice(0, exploredN).forEach((n, i) => (order[key(n.r, n.c)] = i + 1));
  const current = fr && exploredN > 0 ? fr.explored[exploredN - 1] : null;

  grid.forEach((row, r) => row.forEach((kind, c) => {
    const el = cellEl(r, c);
    const k = key(r, c);
    let cls = `cell t-${kind}`;
    if (order[k]) cls += " explored";
    if (current && current.r === r && current.c === c) cls += " exploring";
    if (fr && exploredN === 0 && fr.exit[0] === r && fr.exit[1] === c) cls += " target";
    el.className = cls;
    el.title = `(${r}, ${c}) ${kind}` + (COST[kind] ? ` - base cost ${COST[kind]}` : " - impassable");

    let html = ICON[kind] || "";
    if (kind === "exit") html += `<span class="exit-label">${exitNames[k] || "?"}</span>`;
    if (order[k]) html += `<span class="order">${order[k]}</span>`;
    html += people.filter((p) => p.r === r && p.c === c)
      .map((p) => `<span class="person" data-pid="${p.id}" style="border-color:${colorOf(p.id)}">👤${p.id}</span>`).join("");
    const dots = routes.filter((rt) => rt.found).map((rt) => {
      const i = rt.path.findIndex((s) => s[0] === r && s[1] === c);
      if (i < 0 || i > revealed || exploredN > 0) return "";
      const dim = focusId && rt.person_id !== focusId ? " dim" : "";
      return `<span class="dot${dim}" style="background:${colorOf(rt.person_id)}"></span>`;
    }).join("");
    if (dots) html += `<div class="dots">${dots}</div>`;
    el.innerHTML = html;
  }));
}

/* ---------- right-hand panels ---------- */
function renderPanels() {
  const count = (t) => grid.flat().filter((k) => k === t).length;
  const s = stats || { risk_level: "LOW" };
  $("sPeople").textContent = people.length;
  $("sFire").textContent = count("fire");
  $("sExits").textContent = count("exit");
  $("sBlocked").textContent = count("blocked");
  $("sEvac").textContent = evacuated;
  $("sTrap").textContent = trapped;
  $("sRisk").textContent = s.risk_level;
  $("sRisk").className = "badge " + s.risk_level;

  const list = $("routeList");
  if (!routes.length) {
    list.innerHTML = '<p class="empty">Press “Find Safe Routes” to run A*.</p>';
  } else {
    list.innerHTML = routes.map((rt) => `
      <button class="route-row ${rt.person_id === focusId ? "active" : ""}" data-pid="${rt.person_id}">
        <span class="chip" style="background:${colorOf(rt.person_id)}"></span>
        Person ${rt.person_id} → ${rt.found ? "Exit " + rt.exit_label : "no safe route"}
        <span class="cost">${rt.found ? "cost " + rt.cost : ""}</span></button>`).join("");
  }

  const fr = focusRoute();
  if (fr) {
    $("routeInfo").innerHTML = [
      ["Selected exit", "Exit " + fr.exit_label], ["Total cost", fr.cost],
      ["Distance", fr.distance + " cells"], ["Risk score", fr.risk],
      ["Steps", fr.distance + " moves"],
    ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("");
    $("exitTable").innerHTML = "<tr><th>Exit</th><th>Cost</th><th>Dist</th><th>Risk</th></tr>" +
      fr.alternatives.map((a) => {
        const best = a.exit[0] === fr.exit[0] && a.exit[1] === fr.exit[1];
        return `<tr class="${best ? "best" : ""}"><td>${a.label}</td>` +
          (a.reachable ? `<td>${a.cost}</td><td>${a.distance}</td><td>${a.risk}</td>` : '<td colspan="3">unreachable</td>') + "</tr>";
      }).join("");
    $("algoInfo").textContent = `Nodes expanded: ${fr.explored.length}`;
  } else {
    $("routeInfo").innerHTML = ""; $("exitTable").innerHTML = "";
    $("algoInfo").textContent = "Nodes expanded: –";
  }
}

async function refreshStatus() {
  try { stats = (await post("/api/status", { grid, people })).stats; } catch (e) { /* ignore */ }
  renderPanels();
}

/* ---------- editing the building ---------- */
function nextLetter() {
  const used = Object.values(exitNames);
  return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((ch) => !used.includes(ch)) || "?";
}

// Applies the selected tool to one cell. Returns the terrain that was painted
// (used so a drag keeps painting the same thing).
function applyTool(r, c, paint) {
  const kind = grid[r][c];
  if (tool === "person") {
    if (paint !== null) return null;
    const i = people.findIndex((p) => p.r === r && p.c === c);
    if (i >= 0) people.splice(i, 1);
    else if (["fire", "blocked", "exit"].includes(kind)) { msg(`A person cannot stand on a ${kind} cell.`); return null; }
    else people.push({ id: nextId++, r, c });
    return "person";
  }
  const target = tool === "erase" ? "safe" : paint !== null ? paint : kind === tool ? "safe" : tool;
  if (tool === "erase") people = people.filter((p) => !(p.r === r && p.c === c));
  if (kind === target) return target;
  if (kind === "exit") delete exitNames[key(r, c)];
  if (target === "exit") exitNames[key(r, c)] = exitNames[key(r, c)] || nextLetter();
  if (target === "blocked" || target === "exit") people = people.filter((p) => !(p.r === r && p.c === c));
  grid[r][c] = target;
  return target;
}

function edited() {                      // any change makes old routes stale
  clearAnimations();
  routes = []; focusId = null; exploredN = 0; revealed = Infinity;
  render(); renderPanels(); refreshStatus();
}

function bindGrid() {
  const g = $("grid");
  const cellAt = (e) => { const t = e.target.closest("[data-r]"); return t && [+t.dataset.r, +t.dataset.c]; };
  g.addEventListener("mousedown", (e) => {
    if (e.target.closest(".person") && routes.length) { setFocus(+e.target.closest(".person").dataset.pid); return; }
    const pos = cellAt(e); if (!pos) return;
    if (simTimer) return msg("Stop the simulation before editing the building.");
    dragging = true;
    dragPaint = applyTool(pos[0], pos[1], null);
    edited();
  });
  g.addEventListener("mouseover", (e) => {
    const pos = cellAt(e);
    if (!dragging || !pos || tool === "person" || !dragPaint) return;
    applyTool(pos[0], pos[1], dragPaint);
    edited();
  });
  document.addEventListener("mouseup", () => { dragging = false; dragPaint = null; });
}

/* ---------- routes ---------- */
function clearAnimations() {
  [animTimer, replayTimer, clearTimer].forEach(clearInterval);
  clearTimeout(clearTimer);
  animTimer = replayTimer = clearTimer = null;
}

function setFocus(id) { focusId = id; exploredN = 0; render(); renderPanels(); }

function animateRoutes() {              // draw routes one step at a time
  clearAnimations();
  const longest = Math.max(...routes.filter((r) => r.found).map((r) => r.path.length), 0);
  revealed = 0;
  animTimer = setInterval(() => {
    revealed++;
    render();
    if (revealed >= longest) { clearInterval(animTimer); animTimer = null; revealed = Infinity; render(); }
  }, 140);
}

async function findRoutes() {
  if (!people.length) return msg("Add at least one person first (choose the Person tool and click the building).");
  if (!grid.flat().includes("exit")) return msg("Add at least one emergency exit first.");
  try {
    const res = await post("/api/route", { grid, people });
    routes = res.routes; stats = res.stats;
    focusId = (routes.find((r) => r.found) || routes[0]).person_id;
    exploredN = 0;
    const ok = routes.filter((r) => r.found).length;
    msg(`A* found safe routes for ${ok} of ${routes.length} people.` + (ok < routes.length ? " Some people are cut off by fire or blocked paths." : ""));
    animateRoutes(); renderPanels();
  } catch (e) { msg("Could not reach the Flask server: " + e.message); }
}

function replaySearch() {
  const fr = focusRoute();
  if (!fr) return msg("Find safe routes first, then replay the search.");
  clearAnimations(); revealed = Infinity; exploredN = 0;
  replayTimer = setInterval(() => {
    exploredN++;
    const n = fr.explored[exploredN - 1];
    $("inspector").textContent = `Expand (${n.r},${n.c})  g=${n.g} + h=${n.h} = f=${n.f}`;
    render();
    if (exploredN >= fr.explored.length) {
      clearInterval(replayTimer); replayTimer = null;
      $("inspector").textContent += `  → exit reached, route cost ${fr.cost}`;
      clearTimer = setTimeout(() => { exploredN = 0; render(); }, 3000);
    }
  }, 120);
}

/* ---------- fire simulation ---------- */
async function simStep() {
  if (simBusy) return;
  simBusy = true;
  try {
    const res = await post("/api/step", { grid, people });
    grid = res.grid; people = res.people; routes = res.routes; stats = res.stats;
    evacuated += res.evacuated.length; trapped += res.trapped.length;
    tick++;
    log(`Tick ${tick}: fire spread to ${res.changed.filter((c) => c[2] === "fire").length} cell(s).`);
    res.events.forEach(log);
    if (!routes.find((r) => r.person_id === focusId && r.found)) focusId = (routes.find((r) => r.found) || {}).person_id || null;
    exploredN = 0; revealed = Infinity;
    render(); renderPanels();
    res.changed.forEach(([r, c]) => cellEl(r, c).classList.add("flash"));
    if (res.done) stopSim(`Simulation finished: ${evacuated} evacuated, ${trapped} trapped.`);
  } catch (e) { stopSim("Simulation stopped: " + e.message); }
  simBusy = false;
}

function toggleSim() {
  if (simTimer) return stopSim("Simulation stopped.");
  if (!grid.flat().includes("fire")) return msg("Place at least one fire before starting the simulation.");
  if (!people.length) return msg("Add at least one person before starting the simulation.");
  if (!grid.flat().includes("exit")) return msg("Add at least one emergency exit first.");
  clearAnimations(); evacuated = 0; trapped = 0; tick = 0;
  $("btnSim").textContent = "Stop Simulation";
  $("btnSim").classList.add("running");
  msg("Simulation running: fire spreads, routes are recalculated and people move one cell per tick.");
  simTimer = setInterval(simStep, 1200);
  simStep();
}

function stopSim(text) {
  clearInterval(simTimer); simTimer = null;
  $("btnSim").textContent = "Start Fire Simulation";
  $("btnSim").classList.remove("running");
  if (text) { msg(text); log(text); }
}

/* ---------- reset / demo ---------- */
function setState(s) {
  stopSim(); clearAnimations();
  grid = s.grid; people = s.people; exitNames = { ...(s.exit_names || {}) };
  nextId = Math.max(0, ...people.map((p) => p.id)) + 1;
  routes = []; stats = null; focusId = null; exploredN = 0; revealed = Infinity;
  evacuated = 0; trapped = 0; tick = 0;
  $("inspector").textContent = "Press “Replay A* Search” to watch nodes being evaluated.";
  buildGrid(); render(); renderPanels(); refreshStatus();
}

async function loadDemo() {
  try {
    setState(await (await fetch("/api/sample")).json());
    msg("Demo building loaded. Press “Find Safe Routes” to run A*.");
  } catch (e) { msg("Could not load the demo building: " + e.message); }
}

function resetBuilding() {
  const n = grid.length || 10;
  setState({ grid: Array.from({ length: n }, () => Array(n).fill("safe")), people: [], exit_names: {} });
  $("log").innerHTML = "";
  msg("Building reset. Choose a tool and draw your own layout.");
}

/* ---------- start-up ---------- */
document.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => {
  tool = b.dataset.tool;
  document.querySelectorAll(".tool").forEach((x) => x.classList.toggle("active", x === b));
}));
$("btnRoute").addEventListener("click", findRoutes);
$("btnSim").addEventListener("click", toggleSim);
$("btnDemo").addEventListener("click", loadDemo);
$("btnReset").addEventListener("click", resetBuilding);
$("btnReplay").addEventListener("click", replaySearch);
$("routeList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-pid]");
  if (row) setFocus(+row.dataset.pid);
});
bindGrid();
loadDemo();
