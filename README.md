# MazeBingo

A team-based maze racing game for OSRS bingo events. Teams navigate a 9×9 grid from START (bottom-centre) to END (top-centre) by completing in-game tasks. Played via **Discord slash commands**, tracked automatically via a **RuneLite plugin**, and visualized in a **web UI**.

---

## How It Works

- The maze is a 9×9 grid of tiles. Tiles are hidden until adjacent to a completed tile with no wall blocking the path.
- Each tile has a task (e.g. kill Vorkath 50 times, gain 100k Slayer XP). The whole team contributes toward the tile's progress.
- Special mechanics: **booby traps** (completing one increases a nearby tile's requirement) and **chests** on dead-ends (completing one decreases a nearby tile's requirement).
- Game ends when the END tile is completed — the full maze is revealed.

---

## Components

| Component | Description |
|---|---|
| `maze-api.js` | Express API server — source of truth for maze state |
| `index.html` / `script.js` | Web UI for live maze visualization and maze design |
| `discord-bot/bot.js` | Discord slash commands bot |
| `runelite-plugin/` | RuneLite plugin for automatic in-game task tracking |

---

## Running Locally

### Prerequisites
- Node.js 18+
- A PostgreSQL database
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

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3000` | API server port |
| `FRONTEND_URL` | No | `https://mazeracebingo-1.onrender.com/` | Frontend URL used by Playwright for screenshots |
| `ALLOWED_ORIGINS` | No | _(none — CORS blocked)_ | Comma-separated allowed CORS origins |
| `DISCORD_TOKEN` | Yes (bot) | — | Discord bot token |
| `API_BASE_URL` | Yes (bot) | — | Base URL of the API server (used by bot) |

---

## Discord Commands

All commands detect the team from the **Discord channel name**.

| Command | Options | Description |
|---|---|---|
| `/completetile` | `id` (tile number, `start`, or `end`) | Complete a tile — returns a maze screenshot |
| `/submittask` | `tile` (int), `player` (RSN), `amount` (int, optional) | Submit incremental progress toward a tile task |
| `/progress` | `tile` (int) | Show per-player contribution breakdown for a tile |
| `/createmaze` | `savefile` (JSON attachment, optional) | Create a new maze, optionally from a JSON save file |
| `/fetchmaze` | — | Fetch the current maze state as JSON |

---

## RuneLite Plugin

The RuneLite plugin automatically tracks in-game events and submits progress to the API.

### Configuration

In the RuneLite settings panel (search "Maze"):

| Setting | Default | Description |
|---|---|---|
| API URL | `https://mazeracebingo.onrender.com` | Base URL of the API server |
| Team Name | _(empty)_ | Your team name — must match the team used in Discord |

### Tracked Event Types

| Task Type | What is tracked |
|---|---|
| `npc_kill` | Kills on a specific NPC the player attacked |
| `npc_damage` | Raw damage dealt to a specific NPC, summed from hitsplats |
| `xp_gain` | XP gained in a specific skill (delta since tracking started) |
| `item_drop` | Items received from NPC loot (`NpcLootReceived` / `LootReceived` events) |
| `agility_lap` | Agility laps detected by player position at course finish tiles |
| `minigame_completion` | Completions detected by a configurable chat message substring |
| `clue_completion` | Clue scroll tier completions, detected from the reward casket chat message |
| `gp_value` | Total GP value of all items received from NPC loot |

The plugin displays a maze map panel and a tile info panel in the RuneLite sidebar showing current task progress.

---

## Web UI

Open `index.html?team=yourteamname` in a browser.

- **Live maze**: 9×9 grid rendered from API, auto-refreshed every ~2 seconds.
- **Fog of war**: Tiles hidden until adjacent to a completed tile (can be toggled).
- **Tile details**: Click any visible tile to see per-player contribution breakdown.
- **Maze designer**: Draw walls, place booby traps and chests, add task definitions, save/load JSON.

### Toolbar Buttons

| Button | Description |
|---|---|
| Reset | Clear all tile progress for the current maze |
| Fog | Toggle fog of war on/off |
| Save | Download current maze state as JSON |
| Load | Upload a maze JSON file |
| Tasks | Edit task descriptions and types for each tile |
| Traps | Mark boobytrap/chest tile locations |
| Draw | Open the maze wall design tool |

---

## API Reference

All endpoints require a `?team=<teamname>` query parameter unless noted.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — tests DB connectivity |
| `GET` | `/api/maze` | Full maze state including walls, tiles, tasks, and progress |
| `GET` | `/api/tiles` | Tile list with completion status |
| `GET` | `/api/tiles/progress/:id` | Per-player progress breakdown for a tile |
| `POST` | `/api/tiles/complete/:id` | Complete a tile; returns PNG screenshot |
| `POST` | `/api/tiles/progress/:id` | Submit progress `{ playerName, amount, subCategory? }` |
| `POST` | `/api/tiles/uncomplete/:id` | Uncomplete a tile (must have exactly 1 adjacent completed tile) |
| `POST` | `/api/create` | Create a new maze from save file JSON `{ saveData }` |

### Maze Response Format

```json
{
  "size": 9,
  "walls": [
    { "row": 0, "col": 0, "walls": { "top": true, "right": false, "bottom": false, "left": true } }
  ],
  "tiles": [
    {
      "id": 1,
      "completed": false,
      "completionsRequired": 50,
      "completionsDone": 12,
      "currentProgress": 12,
      "taskType": "npc_kill",
      "taskConfig": { "npc": "Vorkath", "target": 50 }
    }
  ],
  "boobytraps": [{ "row": 3, "col": 4 }],
  "tileDescriptions": { "5": "Kill Vorkath" },
  "gameOver": false
}
```

### Progress Response Format

```json
{
  "success": true,
  "progress": 12,
  "target": 50,
  "completed": false,
  "specialEvent": {
    "type": "boobytrap | chest | gameover",
    "message": "..."
  },
  "tile": { "id": 5, "completed": false }
}
```

---

## Save File Format

Save files are JSON uploaded via `/createmaze` or the web UI Load button.

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
    { "tileId": 5,  "taskType": "npc_kill",            "taskConfig": { "npc": "Vorkath",                             "target": 50     } },
    { "tileId": 6,  "taskType": "npc_kill",            "taskConfig": { "npcs": ["Zulrah", "Vorkath"],                "target": 100    } },
    { "tileId": 7,  "taskType": "npc_damage",          "taskConfig": { "npc": "Vorkath",                             "target": 50000  } },
    { "tileId": 8,  "taskType": "npc_damage",          "taskConfig": { "npcs": ["Zulrah", "Vorkath"],                "target": 100000 } },
    { "tileId": 12, "taskType": "xp_gain",             "taskConfig": { "skill": "Slayer",                            "target": 100000 } },
    { "tileId": 13, "taskType": "xp_gain",             "taskConfig": { "skills": ["Attack", "Strength", "Defence"],  "target": 50000  } },
    { "tileId": 20, "taskType": "item_drop",           "taskConfig": { "item": "Tanzanite fang",                     "target": 1      } },
    { "tileId": 21, "taskType": "item_drop",           "taskConfig": { "items": ["Tanzanite fang", "Uncut onyx"],    "target": 1      } },
    { "tileId": 30, "taskType": "agility_lap",         "taskConfig": { "course": "Ardougne",                         "target": 100    } },
    { "tileId": 31, "taskType": "agility_lap",         "taskConfig": { "courses": ["Gnome", "Draynor"],              "target": 200    } },
    { "tileId": 40, "taskType": "minigame_completion", "taskConfig": { "minigame": "Barrows", "message": "your completed barrows run", "target": 25 } },
    { "tileId": 45, "taskType": "clue_completion",     "taskConfig": { "tier": "hard",                               "target": 10     } },
    { "tileId": 46, "taskType": "clue_completion",     "taskConfig": { "tiers": ["hard", "elite"],                   "target": 20     } },
    { "tileId": 50, "taskType": "gp_value",            "taskConfig": { "target": 10000000 } }
  ]
}
```

`taskConfig.target` sets both the task goal and `completionsRequired` for the tile.

### Task Types

| Task Type | Config fields | Description |
|---|---|---|
| `npc_kill` | `npc` (string) OR `npcs` (array), `target` (int) | Kill a specific NPC N times |
| `npc_damage` | `npc` (string) OR `npcs` (array), `target` (int) | Deal N total damage to a specific NPC |
| `xp_gain` | `skill` (string) OR `skills` (array), `target` (int) | Gain N XP in a specific skill |
| `item_drop` | `item` (string) OR `items` (array), `target` (int) | Receive an item from NPC loot N times |
| `agility_lap` | `course` (string) OR `courses` (array), `target` (int) | Complete N laps of an agility course |
| `minigame_completion` | `minigame` (string), `message` (string), `target` (int) | Complete a minigame N times — detected when `message` appears in chat |
| `clue_completion` | `tier` (string) OR `tiers` (array), `target` (int) | Complete N clue scrolls of a specific tier (`beginner`/`easy`/`medium`/`hard`/`elite`/`master`) |
| `gp_value` | `target` (int) | Collect N GP worth of NPC loot |

---

## Special Game Mechanics

**Fog of War** — Tiles are hidden unless adjacent to a completed tile with no wall blocking the path. The START tile is always visible. The full maze is revealed when END is completed.

**Booby Traps** — When a boobytrap tile is completed, a random revealed incomplete tile's `completionsRequired` increases by that tile's `target` amount.

**Chests (Dead-ends)** — Dead-end tiles (3 walls on a tile) act as chests. When completed, a random revealed incomplete tile's `completionsRequired` decreases by 1. If it reaches 0 it auto-completes.

**Game Over** — When the END tile (top-centre) is completed, no further progress can be submitted.

---

## Database Schema

PostgreSQL, connected via `DATABASE_URL`.

```sql
CREATE TABLE tiles (
  id                  INT,
  team                VARCHAR(64),
  completed           SMALLINT,
  completionsRequired INT DEFAULT 1,
  completionsDone     INT DEFAULT 0,
  PRIMARY KEY (id, team)
);

CREATE TABLE walls (
  row   INT,
  col   INT,
  team  VARCHAR(64),
  walls JSONB   -- { "top": bool, "right": bool, "bottom": bool, "left": bool }
);

CREATE TABLE boobytraps (
  row  INT,
  col  INT,
  team VARCHAR(64)
);

CREATE TABLE tileDescriptions (
  tileId      INT,
  team        VARCHAR(64),
  description TEXT,
  PRIMARY KEY (tileId, team)
);

CREATE TABLE taskDefinitions (
  tileId     INT,
  team       VARCHAR(64),
  taskType   VARCHAR(32),
  taskConfig JSONB,
  PRIMARY KEY (tileId, team)
);

CREATE TABLE tile_progress (
  id          SERIAL PRIMARY KEY,
  tileId      INT,
  team        VARCHAR(64),
  playerName  VARCHAR(64),
  amount      INT DEFAULT 1,
  subCategory VARCHAR(64),
  submittedAt TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Docker

```
docker build -t mazerace .
docker run -p 3000:3000 --env-file .env mazerace
```
