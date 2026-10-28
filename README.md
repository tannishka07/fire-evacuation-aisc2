# AI-Based Dynamic Fire Evacuation and Safe Route Optimization Using A* Heuristic Search

## 1. Problem Statement
During a building fire, the physically shortest way out may lead through smoke or next to flames. People need a route that balances **distance and danger**, and that route must be recalculated as the fire spreads.

## 2. Objectives
- Model a building as a grid with people, fire, smoke, high-risk zones, blocked corridors and exits.
- Implement **A\*** from scratch to find the lowest-cost (not just shortest) evacuation route.
- Support multiple people and multiple exits, choosing the best exit per person.
- Simulate fire spread and re-plan routes automatically.
- Present everything in an emergency-management style dashboard.

## 3. Technologies Used
Python 3, Flask, HTML, CSS, JavaScript (no external APIs, no pathfinding libraries, no internet needed).

## 4. AI Technique Used
**Informed (heuristic) search** with the **A\*** algorithm, applied to a weighted grid graph.

## 5. A* Algorithm Explanation
```
f(n) = g(n) + h(n)
```
- **g(n)**: actual cost from the person's cell to cell n (sum of the cost of every cell entered).
- **h(n)**: estimated cost from n to the exit (Manhattan distance).
- **f(n)**: estimated total cost of the best route through n.

Steps (see `algorithm/astar.py`):
1. Put the start cell in the open list (priority queue ordered by f).
2. Remove the cell with the lowest f(n) and mark it closed.
3. If it is the exit, rebuild the path through the `parent` links and stop.
4. For each of the 4 neighbours: skip fire/blocked cells, compute `new_g = g + step_cost`; if it is better than any earlier g for that cell, store it, set its parent, compute h and push `(g + h)`.
5. Repeat. An empty open list means no safe route exists.

For several exits, A* is run towards each exit and the exit with the lowest total cost is chosen.

## 6. Heuristic Function
```
h(n) = |x1 - x2| + |y1 - y2|
```
Moves are up/down/left/right and every cell costs at least 1, so Manhattan distance never over-estimates the real remaining cost. It is **admissible**, so A* returns the optimal (lowest-cost) route.

## 7. Risk-Cost Calculation
| Cell | Cost of entering |
|---|---|
| Safe | 1 |
| Crowded | 3 |
| Smoke | 5 |
| High risk (or any cell touching a fire, 8 directions) | 10 |
| Fire / Blocked | impassable |

- **Total cost** = g(goal) = sum of all cell costs along the route.
- **Distance** = number of cells moved.
- **Risk score** = sum of (cell cost − 1) along the route, i.e. the extra danger above a normal safe cell.

Example: a 6-cell route with 3 smoke cells costs 3×1 + 3×5 = 18. An 8-cell all-safe route costs 8. A* picks the longer, safer route.

## 8. System Architecture
```
Browser (HTML/CSS/JS)  --JSON-->  Flask (app.py)  -->  algorithm/astar.py
   grid editor, animation   <--JSON--   routes, stats,       A* search
   dashboard, simulation loop           fire spread
```
| File | Role |
|---|---|
| `app.py` | Flask routes: `/`, `/api/sample`, `/api/status`, `/api/route`, `/api/step` |
| `algorithm/astar.py` | A*, cost model, best-exit selection |
| `templates/index.html` | Page layout and About A* section |
| `static/css/style.css` | Dark dashboard theme |
| `static/js/script.js` | Grid editing, API calls, route animation, simulation, search replay |

The server is stateless: the browser sends the grid and people on every request.

## 9. Folder Structure
```
fire-evacuation-system/
├── app.py
├── requirements.txt
├── README.md
├── templates/index.html
├── static/css/style.css
├── static/js/script.js
└── algorithm/
    ├── __init__.py
    └── astar.py
```

## 10. How to Install
```bash
cd fire-evacuation-system
python -m venv venv                # optional
venv\Scripts\activate              # Windows   (Linux/macOS: source venv/bin/activate)
pip install -r requirements.txt
```

## 11. How to Run
```bash
python app.py
```
Open http://127.0.0.1:5000 and press **Find Safe Routes**.

## 12. Example Input / Output
Demo building: 10×10 grid, 3 people, 2 exits (A at row 0 col 4, B at row 9 col 8), 1 fire at (5,4), blocked cells, smoke and high-risk zones.

Request to `POST /api/route` (shortened):
```json
{"grid": [["safe", "..."], "..."], "people": [{"id": 1, "r": 6, "c": 1}]}
```
Response (shortened):
```json
{"routes": [{"person_id": 1, "found": true, "exit_label": "B",
             "cost": 10, "distance": 10, "risk": 0,
             "alternatives": [{"label": "A", "cost": 11}, {"label": "B", "cost": 10}]}],
 "stats": {"people": 3, "fires": 1, "exits": 2, "blocked": 9, "risk_level": "HIGH"}}
```
Person 1 is nearer to Exit A in plain distance (9 cells) but the route passes smoke, so A* costs it 11 and sends the person to Exit B (cost 10).

## 13. Advantages
- Considers danger, not only distance.
- Optimal for the given costs (admissible heuristic) and fast.
- Re-plans every simulation tick.
- Pure Python, easy to read and explain.

## 14. Limitations
- Grid model; real buildings have stairs, doors and several floors.
- People move one at a time with no crowd congestion model (the "crowded" cells are set by the user).
- Fire spread is a simple random model, not real fire physics.
- Each person is planned independently, so two people may share a cell.

## 15. Future Scope
Multi-floor buildings, live crowd-density costs, sensor input (IoT smoke/heat), D* Lite for incremental replanning, a fire-brigade access view, loading building floor plans from images.

## 16. Possible Viva Questions
1. **What is A*?** An informed search algorithm that expands the node with the lowest f(n) = g(n) + h(n).
2. **What do g, h and f mean here?** g is the cost already paid (distance plus danger), h is the Manhattan distance to the exit, f is their sum.
3. **Why Manhattan distance?** Movement is 4-directional on a grid, and it never over-estimates because each cell costs at least 1.
4. **What is an admissible heuristic?** One that never over-estimates the true remaining cost; it guarantees an optimal path.
5. **How is this different from a normal maze solver?** Cells have different costs (safe 1 to high risk 10) so A* minimises distance plus risk, not steps alone.
6. **How does fire change the route?** Fire cells are impassable and cells next to fire cost 10, so routes bend away from the fire.
7. **How are multiple exits handled?** A* runs to each exit and the lowest total cost wins.
8. **A* vs Dijkstra vs BFS?** BFS ignores costs; Dijkstra uses costs but has no direction guidance; A* uses costs plus h(n) to search fewer cells.
9. **What data structure is the open list?** A priority queue (binary heap, `heapq`) ordered by f(n).
10. **What if no safe route exists?** The open list empties, A* returns nothing, and the dashboard shows "no safe route" and a CRITICAL risk level.
