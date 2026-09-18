# Maze Race Bingo — RuneLite Plugin

A RuneLite plugin that automatically tracks task progress for **Maze Race Bingo** and submits it to the game server in real time.

## Features

- **Automatic progress tracking** — listens to in-game events and submits progress without any manual input
- **Interactive maze map** — visual 9×9 grid in the sidebar showing tile status and wall layout
- **Tile detail panel** — click any revealed tile to see the task, progress bar, and per-player contributions
- **Active tasks panel** — lists all unrevealed / incomplete tiles with progress bars at a glance
- **Recent events feed** — shows the last 8 game events (tile completions, game-over, etc.) with colour-coded messages
- **Chat notifications** — in-game messages when you contribute progress or complete a tile
- **Sound alerts** — audio cues on tile completions and special events. The sound files are not bundled in the plugin; they download once on first startup into `.runelite/plugin-data/mazeracebingo/sounds`, so notifications are silent until that finishes. Drop your own `completion.wav` / `special.wav` / `success.wav` / `fail.wav` in that folder and pick the **Custom** pack to override them.
- **In-game pop-up** — a modal notification box in the game window carrying the event message, queued so that several events arriving at once are shown one at a time. Tile-completion pop-ups can be switched off with the **Tile completion pop-up** setting; game-over and keys-missing pop-ups always show.
- **Live sync** — checks a lightweight state version every 10 seconds and refreshes the map immediately when a teammate changes anything, with a full refresh every 60 seconds as a fallback

## Supported task types

| Type | How it's detected |
|------|-------------------|
| `npc_kill` | Tracks hitsplats you apply; reports the kill when the NPC dies |
| `npc_damage` | Tracks hitsplats you apply; reports the raw damage dealt to matching NPCs |
| `xp_gain` | Listens to skill XP changes and reports the delta |
| `item_drop` | Listens to NPC loot and chest loot; matches item names |
| `gp_value` | Accumulates the GP value of all received loot using live item prices |
| `agility_lap` | Detects lap completions at 19 courses from Agility XP drops at course endpoints |
| `minigame_completion` | Matches a configured chat message pattern to detect minigame completions |
| `clue_completion` | Detects the reward casket chat message ("You have completed X `<tier>` Treasure Trails") and matches the tier |

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

### Panel header
Sits above the map. Holds a **Refresh** button that re-fetches the maze state on demand, and a status indicator:

| Status | Meaning |
|--------|---------|
| ● Connected (green) | The server answered and a team name is configured |
| ● Disconnected (red) | The server could not be reached |
| ● No team configured (red) | **Team Name** is still empty in the config panel |
| ● Not connected (red) | Starting state, before the first fetch |

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

### Pop-up notifications

Events also open a modal notification box in the game window showing the event message. Several events arriving together are queued and shown one after another. Only you see it.

Turn off **Pop-up → Tile completion pop-up** in the config panel to suppress the pop-up for tile completions; game-over and keys-missing pop-ups are not affected.

## Chat & sound notifications

After each submission you receive a chat message: *"You contributed X [item/xp] to tile Z."* and, if the tile was completed, a green *"You've completed tile Z!"*

Sound cues play when events arrive:
| Trigger | Sound |
|---------|-------|
| End tile completed | Success |
| Key found | Special |
| Keys missing | Fail |
| Other events | Completion |

Sounds can be muted or have their volume adjusted in the plugin config panel. The **Sound files** dropdown chooses which set of sounds to play:

| Option | Behaviour |
|--------|-----------|
| Meme | The four category sounds shown in the table above. |
| Lore | A per-tile set: each maze tile plays its own numbered sound, with dedicated end-tile sounds. |
| Custom | Your own files from the plugin's sounds folder, falling back to the Meme sound for any file you have not supplied. |

**Lore** gives every tile its own sound instead of one shared "completion" cue:

- Completing the tile numbered *N* on the map plays `lore/N.wav` (e.g. tile 3 → `3.wav`).
- Completing the end tile plays `lore/success.wav`; trying to finish it without all the keys plays `lore/fail.wav`.
- Booby-trap key-found events are silent in this pack.
- Any tile without a matching `N.wav` falls back to the Meme *completion* sound, so only the tiles you care about need their own recording.

To use **custom** sounds, select **Custom** and drop a `.wav` file named `success.wav`, `special.wav`, `fail.wav`, or `completion.wav` into the plugin's sounds folder (the exact path is logged on startup; sounds you previously kept in `.runelite/mazebingo/sounds/` are migrated there automatically). Any file you omit falls back to the matching Meme sound.

## Setup

1. Install the plugin via the RuneLite Plugin Hub or build it locally (see below).
2. Open **RuneLite Settings → Maze Race Bingo** and fill in:
   - **API URL** — base URL of the Maze Race Bingo server (e.g. `https://your-server.example.com`)
   - **Team Name** — your team identifier as configured on the server
3. Log in to Old School RuneScape. The plugin connects automatically and the maze map appears in the sidebar.

The status indicator at the top of the panel turns green when the plugin is connected and a team name is configured.

### Chat message settings

Each task type has its own checkbox (under **Chat Messages** in the config panel) controlling whether "You contributed..." messages for that type are sent to your chatbox. All default to on and only affect your own chat.

| Setting | Description |
|---|---|
| XP gain contributions | Show contribution messages for `xp_gain` tiles |
| NPC kill contributions | Show contribution messages for `npc_kill` tiles |
| NPC damage contributions | Show contribution messages for `npc_damage` tiles |
| Agility lap contributions | Show contribution messages for `agility_lap` tiles |
| Minigame completion contributions | Show contribution messages for `minigame_completion` tiles |
| Clue completion contributions | Show contribution messages for `clue_completion` tiles |
| Item drop contributions | Show contribution messages for `item_drop` tiles |
| GP value contributions | Show contribution messages for `gp_value` tiles |
| Error messages | Show an error message when a progress submission fails |
| Tile completion messages | Show a message when you complete a tile |
| Special event messages | Show special event messages (e.g. game over, bonus events) |

## Building locally

Requires Java 11+ and Gradle.

```bash
cd runelite-plugin
./gradlew build
```

The compiled JAR ends up in `build/libs/`. Load it as an external plugin in RuneLite's developer mode.

To try a change without installing anything, launch a RuneLite dev client with the plugin already loaded:

```bash
./gradlew run
```

That runs `MazeBingoPluginTest`, which registers the plugin as a built-in and starts RuneLite with `--developer-mode --debug`.

## Author

Clerqy
