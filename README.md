# MazeRace

A team-based maze racing game for OSRS bingo events. Teams navigate a 9×9 grid from START (bottom-centre) to END (top-centre) by completing tiles. Played via **Discord slash commands** with a **web UI** for live visualization.

---

## How It Works

- The maze is a 9×9 grid of tiles. Tiles are hidden until adjacent to a completed tile with no wall blocking the path.
- Each tile has a task (e.g. kill Vorkath 50 times, gain 100k Slayer XP). The whole team contributes toward the tile's progress.
- Special mechanics: **booby traps** (increase a nearby tile's completion requirement) and **chests** on dead-ends (decrease a nearby tile's requirement).
- Game ends when the END tile is completed — the full maze is revealed.

---

## Running Locally

### Prerequisites
- Node.js 18+
- A MySQL database
- Discord bot token

### Setup

1. Copy the example env file and fill in your values:
   ```
   cp .env.example .env
   ```

2. Install dependencies:
   ```
   npm install
   cd discord-bot && npm install
   ```

3. Start the API server:
   ```
   node maze-api.js
   ```

4. Start the Discord bot (in `discord-bot/`):
   ```
   node bot.js
   ```

5. Open `index.html` in a browser with `?team=yourteamname` to view the maze.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_USER` | MySQL user | — |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | MySQL database name | `MazeRaceBingoStates` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_POOL_SIZE` | Connection pool size | `1` |
| `PORT` | API server port | `3000` |
| `FRONTEND_URL` | Frontend URL used for Playwright screenshots | `https://mazeracebingo-1.onrender.com/` |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | _(none — CORS blocked)_ |
| `DISCORD_TOKEN` | Discord bot token | — |
| `API_BASE_URL` | Base URL of the API server (used by bot) | — |

---

## Discord Commands

| Command | Description |
|---|---|
| `/completetile id:<id>` | Complete a tile (number, `start`, or `end`) — returns a maze screenshot |
| `/submittask tile:<id> player:<rsn> amount:<n>` | Submit incremental progress toward a tile task |
| `/progress tile:<id>` | Show per-player contribution breakdown for a tile |
| `/createmaze [savefile]` | Create a new maze, optionally from a JSON save file |
| `/fetchmaze` | Fetch the current maze state as JSON |

---

## Save File Format

Save files are JSON uploaded via `/createmaze`. Required fields:

```json
{
  "mazeWalls": [
    { "row": 0, "col": 0, "walls": { "top": true, "right": false, "bottom": false, "left": true } }
  ],
  "boobytraps": [
    { "row": 3, "col": 4 }
  ],
  "tileDescriptions": {
    "5": "Kill Vorkath"
  },
  "taskDefinitions": [
    { "tileId": 5, "taskType": "npc_kill", "taskConfig": { "npc": "Vorkath", "target": 50 } },
    { "tileId": 12, "taskType": "xp_gain", "taskConfig": { "skill": "Slayer", "target": 100000 } },
    { "tileId": 20, "taskType": "item_drop", "taskConfig": { "npc": "Zulrah", "item": "Tanzanite fang", "target": 1 } }
  ]
}
```

Supported `taskType` values: `npc_kill`, `xp_gain`, `item_drop`.
Setting `taskConfig.target` automatically sets `completionsRequired` for the tile.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (tests DB connectivity) |
| `GET` | `/api/maze?team=` | Full maze state including task definitions and progress |
| `GET` | `/api/tiles?team=` | Tile list |
| `GET` | `/api/tiles/progress/:id?team=` | Per-player progress breakdown for a tile |
| `POST` | `/api/tiles/complete/:id?team=` | Complete a tile (amount=1); returns PNG screenshot |
| `POST` | `/api/tiles/progress/:id?team=` | Submit progress `{ playerName, amount }`; returns JSON |
| `POST` | `/api/tiles/uncomplete/:id?team=` | Uncomplete a tile (must have exactly 1 adjacent completed tile) |
| `POST` | `/api/create?team=` | Create a new maze from save file JSON `{ saveData }` |

---

## Docker

```
docker build -t mazerace .
docker run -p 3000:3000 --env-file .env mazerace
```
