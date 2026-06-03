# Maze Race Bingo — RuneLite Plugin

A RuneLite plugin that automatically tracks task progress for **Maze Race Bingo** and submits it to the game server in real time.

## Features

- **Automatic progress tracking** — listens to in-game events and submits progress without any manual input
- **Interactive maze map** — visual grid in the sidebar showing which tiles are hidden, revealed, or completed
- **Tile detail panel** — click any revealed tile to see the task, progress, and per-player contributions
- **Recent events feed** — shows the last 8 game events (tile completions, game-over, etc.)
- **Chat notifications** — in-game messages when you contribute progress or complete a tile
- **Live sync** — polls for state changes every 10 seconds so the map stays up to date when teammates complete tiles

## Supported task types

| Type | How it's detected |
|------|-------------------|
| `npc_kill` | Tracks hitsplats you apply; reports the kill when the NPC dies |
| `xp_gain` | Listens to skill XP changes and reports the delta |
| `item_drop` | Listens to NPC loot received and matches item names |

## Setup

1. Install the plugin via the RuneLite Plugin Hub or build it locally (see below).
2. Open **RuneLite Settings → Maze Race Bingo** and fill in:
   - **API URL** — base URL of the Maze Race Bingo server (e.g. `https://your-server.example.com`)
   - **Team Name** — your team identifier as configured on the server
3. Log in to Old School RuneScape. The plugin connects automatically and the maze map appears in the sidebar.

## Maze map legend

| Colour | Meaning |
|--------|---------|
| Dark gray | Revealed tile (not yet completed) |
| Green | Completed tile |
| Black | Hidden tile |
| Red | Goal / end tile |
| Gold border | Currently selected tile |
| Red tile ID | Booby-trap tile (completed but penalised) |

Tiles are revealed when they are the start tile, when they are completed, or when they are adjacent to a completed tile with no wall blocking the passage.

## Building locally

Requires Java 11+ and Gradle.

```bash
cd runelite-plugin
./gradlew build
```

The compiled JAR ends up in `build/libs/`. Load it as an external plugin in RuneLite's developer mode.

## Author

Clerqy
