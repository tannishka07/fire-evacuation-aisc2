"""
app.py - Flask backend for the AI Fire Evacuation System.

Routes
  GET  /            -> the web page
  GET  /api/sample  -> default demo building (10 x 10)
  POST /api/status  -> counts + overall risk level for a grid
  POST /api/route   -> run A* for every person, return routes
  POST /api/step    -> one fire-simulation tick (spread fire, move people)

The backend is stateless: the browser sends the grid + people as JSON and
gets the new state back as JSON.
"""

import random
from flask import Flask, jsonify, render_template, request

from algorithm.astar import find_best_route, VALID_TYPES

app = Flask(__name__)
MAX_SIZE = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def sample_state():
    """Default demo building: 3 people, 2 exits, 1 fire, walls, smoke, risk."""
    n = 10
    grid = [["safe"] * n for _ in range(n)]

    def put(kind, cells):
        for r, c in cells:
            grid[r][c] = kind

    put("exit", [(0, 4), (9, 8)])
    put("fire", [(5, 4)])
    put("blocked", [(3, 2), (3, 3), (3, 4), (3, 6), (7, 5), (7, 6), (7, 7),
                    (6, 8), (8, 2)])
    put("smoke", [(4, 5), (4, 6), (5, 6), (2, 5), (6, 3), (6, 2), (1, 5), (1, 6),
                  (0, 5), (0, 6), (2, 6), (5, 2), (4, 1)])
    put("risk", [(4, 4), (5, 3), (6, 4), (5, 5)])
    put("crowd", [(1, 4), (1, 3), (8, 7)])
    people = [{"id": 1, "r": 6, "c": 1}, {"id": 2, "r": 5, "c": 8},
              {"id": 3, "r": 2, "c": 7}]
    return {"grid": grid, "people": people, "exit_names": {"0,4": "A", "9,8": "B"}}


def parse_state(data):
    """Validate the JSON sent by the browser. Raises ValueError if invalid."""
    try:
        grid = data["grid"]
        people = data.get("people", [])
        rows = len(grid)
        cols = len(grid[0])
        if not (0 < rows <= MAX_SIZE and 0 < cols <= MAX_SIZE):
            raise ValueError("bad grid size")
        for row in grid:
            if len(row) != cols or any(cell not in VALID_TYPES for cell in row):
                raise ValueError("bad grid cell")
        clean = []
        for p in people:
            r, c = int(p["r"]), int(p["c"])
            if not (0 <= r < rows and 0 <= c < cols):
                raise ValueError("person outside grid")
            clean.append({"id": int(p["id"]), "r": r, "c": c})
    except (KeyError, TypeError, IndexError):
        raise ValueError("invalid request data")
    return grid, clean


def exit_cells(grid):
    return [(r, c) for r, row in enumerate(grid) for c, k in enumerate(row) if k == "exit"]


def exit_name_map(grid, given):
    """Exit labels A, B, C... (the browser keeps them stable between ticks)."""
    names = dict(given or {})
    for r, c in exit_cells(grid):
        key = f"{r},{c}"
        if key not in names:
            unused = [ch for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if ch not in names.values()]
            names[key] = unused[0] if unused else "?"
    return names


def build_routes(grid, people, names):
    """Run A* for each person and attach exit labels."""
    exits = exit_cells(grid)
    routes = []
    for p in people:
        res = find_best_route(grid, (p["r"], p["c"]), exits)
        res["person_id"] = p["id"]
        res["start"] = [p["r"], p["c"]]
        for alt in res["alternatives"]:
            alt["label"] = names.get(f"{alt['exit'][0]},{alt['exit'][1]}", "?")
        if res["found"]:
            res["exit_label"] = names.get(f"{res['exit'][0]},{res['exit'][1]}", "?")
        routes.append(res)
    return routes


def compute_stats(grid, people, routes=None):
    """Counts for the dashboard and an overall risk level."""
    flat = [cell for row in grid for cell in row]
    fires, smoke, risk = flat.count("fire"), flat.count("smoke"), flat.count("risk")
    # Danger score: fire counts most, then high-risk, then smoke
    score = (3 * fires + 2 * risk + smoke) / len(flat)
    if score >= 0.20:
        level = "HIGH"
    elif score >= 0.08:
        level = "MEDIUM"
    else:
        level = "LOW"
    exits = flat.count("exit")
    trapped_someone = routes is not None and any(not r["found"] for r in routes)
    if fires and people and (exits == 0 or trapped_someone):
        level = "CRITICAL"
    return {"people": len(people), "fires": fires, "exits": exits,
            "blocked": flat.count("blocked"), "smoke": smoke, "risk_cells": risk,
            "risk_level": level}


def spread_fire(grid):
    """
    One fire-spread tick (edits grid in place, returns changed cells).
      1. Fire spreads to each neighbouring cell with some probability.
         Walls (blocked) stop it; exits burn less easily.
      2. Cells touching a fire become high risk.
      3. Cells within 2 steps of a fire may fill with smoke.
    """
    rows, cols = len(grid), len(grid[0])
    changed = {}
    fires = [(r, c) for r in range(rows) for c in range(cols) if grid[r][c] == "fire"]

    for r, c in fires:
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                kind = grid[nr][nc]
                if kind in ("fire", "blocked"):
                    continue
                if random.random() < (0.15 if kind == "exit" else 0.40):
                    changed[(nr, nc)] = "fire"
    for (r, c), kind in changed.items():
        grid[r][c] = kind

    fires = [(r, c) for r in range(rows) for c in range(cols) if grid[r][c] == "fire"]
    for r, c in fires:
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                dist = abs(dr) + abs(dc)
                nr, nc = r + dr, c + dc
                if dist == 0 or dist > 2 or not (0 <= nr < rows and 0 <= nc < cols):
                    continue
                kind = grid[nr][nc]
                if dist == 1 and kind in ("safe", "crowd", "smoke"):
                    grid[nr][nc] = "risk"
                    changed[(nr, nc)] = "risk"
                elif kind in ("safe", "crowd") and random.random() < 0.5:
                    grid[nr][nc] = "smoke"
                    changed[(nr, nc)] = "smoke"
    return [[r, c, k] for (r, c), k in changed.items()]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/sample")
def api_sample():
    return jsonify(sample_state())


def read_request():
    data = request.get_json(silent=True) or {}
    grid, people = parse_state(data)
    return grid, people, exit_name_map(grid, data.get("exit_names"))


@app.post("/api/status")
def api_status():
    try:
        grid, people, _ = read_request()
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return jsonify({"stats": compute_stats(grid, people)})


@app.post("/api/route")
def api_route():
    try:
        grid, people, names = read_request()
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    routes = build_routes(grid, people, names)
    return jsonify({"routes": routes, "stats": compute_stats(grid, people, routes)})


@app.post("/api/step")
def api_step():
    """One simulation tick: fire spreads, routes are recomputed, people move 1 cell."""
    try:
        grid, people, names = read_request()
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    changed = spread_fire(grid)
    exits = exit_cells(grid)
    events, evacuated, trapped, active = [], [], [], []

    for p in people:
        kind = grid[p["r"]][p["c"]]
        if kind == "fire":
            trapped.append(p["id"])
            events.append(f"Person {p['id']} was caught by the fire.")
            continue
        if kind == "exit":
            evacuated.append(p["id"])
            events.append(f"Person {p['id']} evacuated.")
            continue
        res = find_best_route(grid, (p["r"], p["c"]), exits)
        if not res["found"]:
            events.append(f"Person {p['id']} has no safe route and is waiting.")
        elif len(res["path"]) > 1:
            p["r"], p["c"] = res["path"][1]          # move one cell along the route
            if grid[p["r"]][p["c"]] == "exit":
                label = names.get(f"{p['r']},{p['c']}", "?")
                evacuated.append(p["id"])
                events.append(f"Person {p['id']} evacuated through Exit {label}.")
                continue
        active.append(p)

    routes = build_routes(grid, active, names)
    return jsonify({"grid": grid, "people": active, "changed": changed,
                    "events": events, "evacuated": evacuated, "trapped": trapped,
                    "routes": routes, "stats": compute_stats(grid, active, routes),
                    "done": len(active) == 0})


if __name__ == "__main__":
    app.run(debug=True)
