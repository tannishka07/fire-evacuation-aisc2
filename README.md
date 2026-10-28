# AI-Based Dynamic Fire Evacuation and Safe Route Optimization Using A* Heuristic Search

## live app: https://fire-evacuation-aisc2.onrender.com

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


## 8. Advantages
- Considers danger, not only distance.
- Optimal for the given costs (admissible heuristic) and fast.
- Re-plans every simulation tick.
- Pure Python, easy to read and explain.

## 9. Future Scope
Multi-floor buildings, live crowd-density costs, sensor input (IoT smoke/heat), D* Lite for incremental replanning, a fire-brigade access view, loading building floor plans from images.
