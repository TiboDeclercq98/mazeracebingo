# Maze Race Bingo — RuneLite Plugin

A RuneLite plugin that automatically tracks task progress for **Maze Race Bingo** and submits it to the game server in real time.

## Features

- **Automatic progress tracking** — listens to in-game events and submits progress without any manual input
- **Interactive maze map** — visual 9×9 grid in the sidebar showing tile status and wall layout
- **Tile detail panel** — click any revealed tile to see the task, progress bar, and per-player contributions
- **Active tasks panel** — lists all unrevealed / incomplete tiles with progress bars at a glance
- **Recent events feed** — shows the last 8 game events (tile completions, game-over, etc.) with colour-coded messages
- **Chat notifications** — in-game messages when you contribute progress or complete a tile
- **Sound alerts** — audio cues on tile completions and special events
- **Live sync** — polls for state changes every 10 seconds so the map stays up to date when teammates complete tiles

## Supported task types

| Type | How it's detected |
|------|-------------------|
| `npc_kill` | Tracks hitsplats you apply; reports the kill when the NPC dies |
| `xp_gain` | Listens to skill XP changes and reports the delta |
| `item_drop` | Listens to NPC loot and chest loot; matches item names |
| `gp_value` | Accumulates the GP value of all received loot using live item prices |
| `agility_lap` | Detects lap completions at 19 courses by chat message and player location |
| `minigame` | Matches a configured chat message pattern to detect minigame completions |

### Agility courses supported

Gnome, Draynor, Al Kharid, Varrock, Barbarian, Canifis, Falador, Seers' Village, Pollnivneach, Rellekka, Ardougne, Pyramid, Wilderness, Werewolf, Prifddinas, Shayzien Basic, Shayzien Advanced, Penguin, Ape Atoll.

### Completion modes

Tiles that require multiple variants (NPCs, items, skills, courses) can operate in two modes:

| Mode | Behaviour |
|------|-----------|
| **Shared** (default) | Progress from any variant counts toward a single total |
| **Each** | Each variant must be completed individually; separate progress bars are shown |

## Maze map legend

| Colour | Meaning |
|--------|---------|
| Dark gray | Hidden tile (not yet revealed) |
| Medium gray | Revealed tile (not yet completed) |
| Green | Completed tile |
| Yellow | Start tile |
| Red (background) | End / goal tile |
| Red (tile ID text) | Booby-trap tile (completed but penalised) |
| Gold border | Currently selected tile |
| White lines | Walls (rendered on completed tiles) |

Tiles are revealed when they are the start tile, when they are completed, or when they are adjacent to a completed tile with no wall blocking the passage. When the game ends all tiles are revealed.

## UI panels

### Maze map
A grid of clickable tiles. Click a tile to load its details in the tile info panel. Walls are drawn between completed tiles to indicate which passages are open.

### Tile info panel
Appears when you click a tile. Shows:
- Task type and description
- Animated progress bar with percentage
- Per-player contribution list (with sub-category breakdown for multi-variant tiles)
- Individual progress bars per variant in **each** mode
- Booby-trap warning (title turns red)

### Active tasks panel
Scrollable list of every revealed-but-incomplete tile. Each row shows the tile ID, description, and a progress bar. Progress values are formatted as `X,XXX / Y,YYY xp` for XP tasks and `X / Y` for all others.

### Recent events feed
Up to 8 recent events rendered below the map, colour-coded by type:
- White — tile completed
- Red — keys missing
- Green — game over
- Gold — other events

## Chat & sound notifications

After each submission you receive a chat message: *"You contributed X [item/xp] to tile Z."* and, if the tile was completed, a green *"You've completed tile Z!"*

Sound cues play when events arrive:
| Trigger | Sound |
|---------|-------|
| End tile completed | Success |
| Key found | Special |
| Keys missing | Fail |
| Other events | Completion |

Sounds can be muted or have their volume adjusted in the plugin config panel. To replace a sound with your own, drop a `.wav` file named `success.wav`, `special.wav`, `fail.wav`, or `completion.wav` into `.runelite/mazebingo/sounds/` (created automatically on first plugin startup) — it overrides the bundled sound for that event.

## Setup

1. Install the plugin via the RuneLite Plugin Hub or build it locally (see below).
2. Open **RuneLite Settings → Maze Race Bingo** and fill in:
   - **API URL** — base URL of the Maze Race Bingo server (e.g. `https://your-server.example.com`)
   - **Team Name** — your team identifier as configured on the server
3. Log in to Old School RuneScape. The plugin connects automatically and the maze map appears in the sidebar.

The status indicator at the top of the panel turns green when the plugin is connected and a team name is configured.

## Building locally

Requires Java 11+ and Gradle.

```bash
cd runelite-plugin
./gradlew build
```

The compiled JAR ends up in `build/libs/`. Load it as an external plugin in RuneLite's developer mode.

## Author

Clerqy
