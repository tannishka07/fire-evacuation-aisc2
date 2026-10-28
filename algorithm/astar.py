"""
astar.py - A* heuristic search for fire evacuation (implemented from scratch).

    f(n) = g(n) + h(n)

    g(n) : actual cost paid to travel from the start cell to cell n
           (every cell entered adds its movement/danger cost)
    h(n) : estimated cost from n to the exit  ->  Manhattan distance
           h(n) = |x1 - x2| + |y1 - y2|
    f(n) : total estimated cost of the best route that passes through n

The grid is a list of rows. Every cell is one of these strings:
    "safe", "crowd", "smoke", "risk", "fire", "blocked", "exit"
"""

import heapq

# ---------------------------------------------------------------------------
# Movement costs (cost of ENTERING a cell)
# ---------------------------------------------------------------------------
MOVE_COST = {
    "safe": 1,    # normal corridor
    "crowd": 3,   # crowded area, slow movement
    "smoke": 5,   # smoke, poor visibility
    "risk": 10,   # high-risk zone near fire
    "exit": 1,    # an emergency exit
}
IMPASSABLE = {"fire", "blocked"}          # can never be entered
VALID_TYPES = set(MOVE_COST) | IMPASSABLE
NEAR_FIRE_COST = 10                       # any cell touching a fire is high risk


def manhattan(a, b):
    """Heuristic h(n): Manhattan distance between two (row, col) cells."""
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def neighbours(grid, r, c):
    """The 4 cells (up, down, left, right) that are inside the grid."""
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]):
            yield nr, nc


def is_near_fire(grid, r, c):
    """True if any of the 8 surrounding cells is on fire."""
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            nr, nc = r + dr, c + dc
            if (dr or dc) and 0 <= nr < len(grid) and 0 <= nc < len(grid[0]):
                if grid[nr][nc] == "fire":
                    return True
    return False


def step_cost(grid, r, c):
    """
    Cost of moving INTO cell (r, c).
    Returns None when the cell is impassable (fire or blocked).
    This is where fire RISK enters the algorithm.
    """
    kind = grid[r][c]
    if kind in IMPASSABLE:
        return None
    cost = MOVE_COST[kind]
    if is_near_fire(grid, r, c):
        cost = max(cost, NEAR_FIRE_COST)   # cells next to fire are high risk
    return cost


def astar(grid, start, goal):
    """
    A* search from `start` to `goal` (both (row, col) tuples).

    Returns a dict with path, cost, distance, risk and the list of expanded
    nodes (used by the 'Replay A* search' visualisation), or None if there
    is no safe route.
    """
    if step_cost(grid, *start) is None:          # standing inside fire/wall
        return None

    h_start = manhattan(start, goal)
    counter = 0                                  # tie-breaker for the heap
    # Open list = priority queue ordered by f(n); ties broken by smaller h(n)
    open_list = [(h_start, h_start, counter, start)]   # (f, h, counter, node)
    g_score = {start: 0}                         # best known g(n) per cell
    parent = {}                                  # to rebuild the path later
    closed = set()                               # already expanded cells
    explored = []                                # for visualisation

    while open_list:
        f, h, _, node = heapq.heappop(open_list)  # node with the LOWEST f(n)
        if node in closed:
            continue                              # stale queue entry
        closed.add(node)
        g = f - h
        explored.append({"r": node[0], "c": node[1], "g": g, "h": h, "f": f})

        if node == goal:                          # reached the exit
            path = [node]
            while node in parent:                 # walk back to the start
                node = parent[node]
                path.append(node)
            path.reverse()
            return _summarise(grid, path, g, explored)

        for nb in neighbours(grid, *node):
            cost = step_cost(grid, *nb)
            if cost is None or nb in closed:      # skip fire / blocked cells
                continue
            new_g = g + cost                      # g(n) = cost so far + step
            if new_g < g_score.get(nb, float("inf")):
                g_score[nb] = new_g
                parent[nb] = node
                new_h = manhattan(nb, goal)       # h(n) = Manhattan distance
                counter += 1
                heapq.heappush(open_list, (new_g + new_h, new_h, counter, nb))
    return None                                   # open list empty: no route


def _summarise(grid, path, total_cost, explored):
    """Distance = cells moved. Risk = extra cost above a normal safe cell."""
    risk = sum(step_cost(grid, r, c) - 1 for r, c in path[1:])
    return {
        "path": [list(p) for p in path],
        "cost": total_cost,
        "distance": len(path) - 1,
        "risk": risk,
        "explored": explored,
    }


def find_best_route(grid, start, exits):
    """
    Run A* from `start` to EVERY exit and pick the one with the lowest
    total cost (distance + risk). Returns the chosen route and a comparison
    of all exits.
    """
    best, best_exit, alternatives = None, None, []
    for ex in exits:
        res = astar(grid, tuple(start), tuple(ex))
        if res is None:
            alternatives.append({"exit": list(ex), "reachable": False})
            continue
        alternatives.append({"exit": list(ex), "reachable": True,
                             "cost": res["cost"], "distance": res["distance"],
                             "risk": res["risk"]})
        if best is None or (res["cost"], res["distance"]) < (best["cost"], best["distance"]):
            best, best_exit = res, ex

    if best is None:
        return {"found": False, "alternatives": alternatives}
    return {"found": True, "exit": list(best_exit), "alternatives": alternatives, **best}
