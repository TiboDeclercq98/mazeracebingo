// Express API for Maze Bingo
// npm install express canvas cors mysql2 playwright

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const cors = require('cors');
const mysql = require('mysql2');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());
app.use(cors());

const SIZE = 9; // 9x9 grid
// No global maze state — all state is per-request.

const mysqlConfig = require('./mysql-config');
const db = mysql.createPool(mysqlConfig);

function dbQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// --- TABLE CREATION (run once at startup) ---
async function initDb() {
  await dbQuery(`CREATE TABLE IF NOT EXISTS tiles (
    id INT,
    team VARCHAR(64),
    completed TINYINT,
    completionsRequired INT DEFAULT 1,
    completionsDone INT DEFAULT 0,
    PRIMARY KEY (id, team)
  )`);
  await dbQuery(`CREATE TABLE IF NOT EXISTS walls (
    row INT,
    col INT,
    team VARCHAR(64),
    walls TEXT
  )`);
  await dbQuery(`CREATE TABLE IF NOT EXISTS boobytraps (
    row INT,
    col INT,
    team VARCHAR(64)
  )`);
  await dbQuery(`CREATE TABLE IF NOT EXISTS tileDescriptions (
    tileId INT,
    team VARCHAR(64),
    description TEXT,
    PRIMARY KEY (tileId, team)
  )`);
  await dbQuery(`CREATE TABLE IF NOT EXISTS taskDefinitions (
    tileId INT NOT NULL,
    team VARCHAR(64) NOT NULL,
    taskType VARCHAR(32) NOT NULL,
    taskConfig JSON NOT NULL,
    PRIMARY KEY (tileId, team)
  )`);
  // Append-only log of individual player progress contributions.
  // completionsDone on the tiles table is kept in sync as a cached SUM.
  await dbQuery(`CREATE TABLE IF NOT EXISTS tile_progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tileId INT NOT NULL,
    team VARCHAR(64) NOT NULL,
    playerName VARCHAR(64) NOT NULL,
    amount INT NOT NULL DEFAULT 1,
    submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}
initDb();

// --- UTILITY FUNCTIONS ---

// Returns a Set of tile indices that are visible (adjacent to a completed tile with no wall blocking).
function computeRevealedSet(mazeState, mazeWalls) {
  const revealed = new Set();
  mazeState.forEach((t, i) => {
    if (!t.completed) return;
    revealed.add(i);
    const row = Math.floor(i / SIZE);
    const col = i % SIZE;
    const wallObj = mazeWalls.find(w => w.row === row && w.col === col);
    if (row > 0) {
      const nIdx = (row - 1) * SIZE + col;
      const nWall = mazeWalls.find(w => w.row === row - 1 && w.col === col);
      if ((!wallObj || !wallObj.walls.top) && (!nWall || !nWall.walls.bottom)) revealed.add(nIdx);
    }
    if (row < SIZE - 1) {
      const nIdx = (row + 1) * SIZE + col;
      const nWall = mazeWalls.find(w => w.row === row + 1 && w.col === col);
      if ((!wallObj || !wallObj.walls.bottom) && (!nWall || !nWall.walls.top)) revealed.add(nIdx);
    }
    if (col > 0) {
      const nIdx = row * SIZE + (col - 1);
      const nWall = mazeWalls.find(w => w.row === row && w.col === col - 1);
      if ((!wallObj || !wallObj.walls.left) && (!nWall || !nWall.walls.right)) revealed.add(nIdx);
    }
    if (col < SIZE - 1) {
      const nIdx = row * SIZE + (col + 1);
      const nWall = mazeWalls.find(w => w.row === row && w.col === col + 1);
      if ((!wallObj || !wallObj.walls.right) && (!nWall || !nWall.walls.left)) revealed.add(nIdx);
    }
  });
  return revealed;
}

// Returns true if tile `id` is reachable (adjacent to a completed tile, no wall blocking).
function isTileRevealed(id, mazeState, mazeWalls) {
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  if (id === startId) return true;
  const idx = id - 1;
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const directions = [
    { dr: -1, dc: 0, wall: 'top',    neighborWall: 'bottom' },
    { dr:  1, dc: 0, wall: 'bottom', neighborWall: 'top'    },
    { dr:  0, dc: -1, wall: 'left',  neighborWall: 'right'  },
    { dr:  0, dc:  1, wall: 'right', neighborWall: 'left'   }
  ];
  return directions.some(({ dr, dc, wall, neighborWall }) => {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return false;
    const neighbor = mazeState[nr * SIZE + nc];
    if (!neighbor.completed) return false;
    const wallObj  = mazeWalls.find(w => w.row === row && w.col === col);
    const nWallObj = mazeWalls.find(w => w.row === nr  && w.col === nc);
    if ((wallObj && wallObj.walls[wall]) || (nWallObj && nWallObj.walls[neighborWall])) return false;
    return true;
  });
}

// Launches a Playwright browser, renders the frontend maze for `team`, and returns a PNG buffer.
async function takeScreenshot(team) {
  const url = (process.env.FRONTEND_URL || 'https://mazeracebingo-1.onrender.com/') + `?team=${encodeURIComponent(team)}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const panel = document.querySelector('.button-panel');
      if (panel) panel.classList.add('hide-for-screenshot');
    });
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

// --- TEAM-AWARE DB HELPERS ---

async function loadMazeFromDb(team) {
  let mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions;
  const tiles = await dbQuery('SELECT * FROM tiles WHERE team = ?', [team]);
  if (tiles.length > 0) {
    mazeState = tiles.map(t => ({
      id: t.id,
      completed: !!t.completed,
      completionsRequired: t.completionsRequired !== undefined ? t.completionsRequired : 1,
      completionsDone: t.completionsDone !== undefined ? t.completionsDone : 0
    }));
  } else {
    mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({ id: i + 1, completed: false, completionsRequired: 1, completionsDone: 0 }));
    mazeWalls = [];
    boobytrapPositions = [];
    tileDescriptions = {};
    taskDefinitions = {};
    await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
  }
  const wallsRows = await dbQuery('SELECT * FROM walls WHERE team = ?', [team]);
  mazeWalls = wallsRows.map(r => ({ row: r.row, col: r.col, walls: JSON.parse(r.walls) }));
  const traps = await dbQuery('SELECT * FROM boobytraps WHERE team = ?', [team]);
  boobytrapPositions = traps.map(t => ({ row: t.row, col: t.col }));
  const descs = await dbQuery('SELECT * FROM tileDescriptions WHERE team = ?', [team]);
  tileDescriptions = {};
  descs.forEach(d => { tileDescriptions[d.tileId] = d.description; });
  const taskDefs = await dbQuery('SELECT * FROM taskDefinitions WHERE team = ?', [team]);
  taskDefinitions = {};
  taskDefs.forEach(d => { taskDefinitions[d.tileId] = { taskType: d.taskType, taskConfig: JSON.parse(d.taskConfig) }; });
  return { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions };
}

async function saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions) {
  try {
    await dbQuery('DELETE FROM tiles WHERE team = ?', [team]);
    const tileInserts = mazeState.map(t => dbQuery(
      'INSERT INTO tiles (id, team, completed, completionsRequired, completionsDone) VALUES (?, ?, ?, ?, ?)',
      [t.id, team, t.completed ? 1 : 0, t.completionsRequired || 1, t.completionsDone || 0]
    ));
    await Promise.all(tileInserts);
    await dbQuery('DELETE FROM walls WHERE team = ?', [team]);
    const wallInserts = mazeWalls.map(w => dbQuery(
      'INSERT INTO walls (row, col, team, walls) VALUES (?, ?, ?, ?)',
      [w.row, w.col, team, JSON.stringify(w.walls)]
    ));
    await Promise.all(wallInserts);
    await dbQuery('DELETE FROM boobytraps WHERE team = ?', [team]);
    const trapInserts = boobytrapPositions.map(b => dbQuery(
      'INSERT INTO boobytraps (row, col, team) VALUES (?, ?, ?)',
      [b.row, b.col, team]
    ));
    await Promise.all(trapInserts);
    await dbQuery('DELETE FROM tileDescriptions WHERE team = ?', [team]);
    const descInserts = Object.entries(tileDescriptions).map(([tileId, description]) => dbQuery(
      'INSERT INTO tileDescriptions (tileId, team, description) VALUES (?, ?, ?)',
      [tileId, team, description]
    ));
    await Promise.all(descInserts);
  } catch (err) {
    console.error('Error saving maze to DB:', err);
  }
}

// Replaces all taskDefinitions for a team. Called only from POST /api/create.
async function saveTaskDefinitions(team, taskDefinitions) {
  await dbQuery('DELETE FROM taskDefinitions WHERE team = ?', [team]);
  const inserts = Object.entries(taskDefinitions).map(([tileId, def]) => dbQuery(
    'INSERT INTO taskDefinitions (tileId, team, taskType, taskConfig) VALUES (?, ?, ?, ?)',
    [tileId, team, def.taskType, JSON.stringify(def.taskConfig)]
  ));
  await Promise.all(inserts);
}

// --- CORE GAME LOGIC ---

// Validates tile access, records a progress contribution, updates tile state, and fires special events.
// Returns { success, tile, specialEvent, progress, target, completed } on success,
// or { error, status } / { success: false, alreadyCompleted, tile, status } on failure.
async function submitTileProgress(team, id, playerName, amount) {
  let { mazeState, mazeWalls, boobytrapPositions, tileDescriptions } = await loadMazeFromDb(team);
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  const endId   = Math.floor(SIZE / 2) + 1;
  const isStart = id === startId;
  const isEnd   = id === endId;

  const tile = mazeState.find(t => t.id === id);
  if (!tile) return { error: 'Tile not found', status: 404 };

  const endTile = mazeState.find(t => t.id === endId);
  if (endTile && endTile.completed) {
    return { error: 'Game is finished. No more tiles can be completed.', status: 403 };
  }

  if (tile.completed) return { success: false, alreadyCompleted: true, tile, status: 400 };

  if (!isStart && !isTileRevealed(id, mazeState, mazeWalls)) {
    return { error: 'Tile is not revealed (blocked by wall or no adjacent completed tile)', status: 403 };
  }

  // Record the individual contribution before updating the tile.
  await dbQuery(
    'INSERT INTO tile_progress (tileId, team, playerName, amount) VALUES (?, ?, ?, ?)',
    [id, team, playerName, amount]
  );

  tile.completionsDone = (tile.completionsDone || 0) + amount;

  let specialEvent = null;

  if (tile.completionsDone >= (tile.completionsRequired || 1)) {
    tile.completed = true;

    if (isEnd) {
      mazeState.forEach(t => { t.revealed = true; });
      await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
      specialEvent = { type: 'gameover', message: 'The end tile was completed! The entire maze is now revealed. Game over.' };
    } else {
      const idx = id - 1;
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;

      // Boobytrap: increase completionsRequired on a random revealed incomplete tile.
      const isBoobytrap = boobytrapPositions.some(b => b.row === row && b.col === col);
      if (isBoobytrap) {
        const revealedSet = computeRevealedSet(mazeState, mazeWalls);
        const candidates = Array.from(revealedSet).filter(i => {
          const t = mazeState[i];
          return !t.completed && t.id !== startId && t.id !== endId;
        });
        if (candidates.length > 0) {
          const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
          mazeState[pickIdx].completionsRequired = (mazeState[pickIdx].completionsRequired || 1) + 1;
          specialEvent = { type: 'boobytrap', message: `Booby trap triggered: tile ${mazeState[pickIdx].id} requires extra completion` };
        }
      }

      // Dead-end (chest): decrease completionsRequired on a random revealed incomplete tile.
      const wallObj = mazeWalls.find(w => w.row === row && w.col === col);
      if (wallObj && id !== startId && id !== endId) {
        const wallCount = ['top', 'right', 'bottom', 'left'].reduce((n, dir) => n + (wallObj.walls[dir] ? 1 : 0), 0);
        if (wallCount === 3) {
          const revealedSet = computeRevealedSet(mazeState, mazeWalls);
          const candidates = Array.from(revealedSet).filter(i => {
            const t = mazeState[i];
            return !t.completed && t.id !== startId && t.id !== endId && (t.completionsRequired || 1) > 0;
          });
          if (candidates.length > 0) {
            const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
            mazeState[pickIdx].completionsRequired = (mazeState[pickIdx].completionsRequired || 1) - 1;
            if (mazeState[pickIdx].completionsRequired <= 0) {
              mazeState[pickIdx].completionsRequired = 0;
              mazeState[pickIdx].completed = true;
              mazeState[pickIdx].completionsDone = 0;
              specialEvent = { type: 'chest', message: `You found a chest, tile ${mazeState[pickIdx].id} has been completed` };
            } else {
              specialEvent = { type: 'chest', message: `You found a chest! Tile ${mazeState[pickIdx].id} needs one less completion` };
            }
          }
        }
      }

      await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
    }
  } else {
    await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
  }

  return {
    success: true,
    tile,
    specialEvent,
    progress: tile.completionsDone,
    target: tile.completionsRequired,
    completed: tile.completed
  };
}

// --- EXPRESS ROUTES ---

app.get('/api/tiles', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const { mazeState } = await loadMazeFromDb(team);
  if (!res.headersSent) res.json(mazeState);
});

// Complete a tile — backward-compatible endpoint used by the Discord bot.
// Submits progress of 1 as "Discord" and returns a Playwright PNG screenshot.
app.post('/api/tiles/complete/:id', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const id = parseInt(req.params.id, 10);
  const result = await submitTileProgress(team, id, 'Discord', 1);
  if (result.error)          return res.status(result.status).json({ error: result.error });
  if (result.alreadyCompleted) return res.status(400).json({ success: false, alreadyCompleted: true, tile: result.tile });
  const { specialEvent } = result;
  try {
    const screenshot = await takeScreenshot(team);
    res.set('Content-Type', 'image/png');
    if (specialEvent) {
      if (specialEvent.type === 'boobytrap') res.set('X-Boobytrap-Message', specialEvent.message);
      else if (specialEvent.type === 'chest') res.set('X-Chest-Message', specialEvent.message);
      else if (specialEvent.type === 'gameover') res.set('X-Gameover-Message', specialEvent.message);
    }
    res.send(screenshot);
  } catch (err) {
    console.error('Screenshot failed:', err);
    if (!res.headersSent) {
      res.status(500).type('application/json').json({ error: 'Screenshot failed', details: err.message, specialEvent });
    }
  }
});

// Submit incremental progress — primary endpoint for the RuneLite plugin.
// Body: { playerName: string, amount?: number (default 1) }
// Returns JSON: { progress, target, completed, specialEvent, tile }
app.post('/api/tiles/progress/:id', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const id = parseInt(req.params.id, 10);
  const playerName = req.body.playerName || 'unknown';
  const amount = Math.max(1, parseInt(req.body.amount, 10) || 1);
  const result = await submitTileProgress(team, id, playerName, amount);
  if (result.error)            return res.status(result.status).json({ error: result.error });
  if (result.alreadyCompleted) return res.status(400).json({ success: false, alreadyCompleted: true, tile: result.tile });
  res.json({
    success: true,
    progress: result.progress,
    target: result.target,
    completed: result.completed,
    specialEvent: result.specialEvent || null,
    tile: result.tile
  });
});

// Get the per-player contribution breakdown for a tile.
app.get('/api/tiles/progress/:id', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const id = parseInt(req.params.id, 10);
  const { mazeState } = await loadMazeFromDb(team);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  const taskDefs = await dbQuery('SELECT * FROM taskDefinitions WHERE tileId = ? AND team = ?', [id, team]);
  const taskDef  = taskDefs[0] || null;
  const rows = await dbQuery(
    `SELECT playerName, SUM(amount) AS total, MAX(submittedAt) AS lastSubmitted
     FROM tile_progress WHERE tileId = ? AND team = ?
     GROUP BY playerName ORDER BY total DESC`,
    [id, team]
  );
  res.json({
    tileId: id,
    taskType: taskDef ? taskDef.taskType : null,
    taskConfig: taskDef ? JSON.parse(taskDef.taskConfig) : null,
    currentProgress: tile.completionsDone || 0,
    target: tile.completionsRequired || 1,
    contributions: rows.map(r => ({ playerName: r.playerName, amount: r.total, lastSubmitted: r.lastSubmitted }))
  });
});

app.get('/api/current', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions } = await loadMazeFromDb(team);
  if (!res.headersSent) res.json({
    size: SIZE,
    walls: mazeWalls,
    tiles: mazeState.map(t => ({
      ...t,
      currentProgress: t.completionsDone || 0,
      taskType:   taskDefinitions[t.id]?.taskType   || null,
      taskConfig: taskDefinitions[t.id]?.taskConfig || null
    })),
    boobytraps: boobytrapPositions,
    tileDescriptions
  });
});

app.get('/api/maze', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions } = await loadMazeFromDb(team);
  if (!res.headersSent) res.json({
    size: SIZE,
    walls: mazeWalls,
    tiles: mazeState.map(t => ({
      ...t,
      currentProgress: t.completionsDone || 0,
      taskType:   taskDefinitions[t.id]?.taskType   || null,
      taskConfig: taskDefinitions[t.id]?.taskConfig || null
    })),
    boobytraps: boobytrapPositions,
    tileDescriptions
  });
});

// Create a new maze from a save file.
// Accepts taskDefinitions as either an array [{ tileId, taskType, taskConfig }]
// or an object keyed by tileId. Setting taskConfig.target auto-sets completionsRequired.
app.post('/api/create', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const { saveData } = req.body;
  if (!saveData) return res.status(400).json({ error: 'Missing saveData' });
  let loaded;
  try {
    loaded = typeof saveData === 'string' ? JSON.parse(saveData) : saveData;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in saveData' });
  }
  if (!loaded || !Array.isArray(loaded.mazeWalls)) {
    return res.status(400).json({ error: 'Invalid save file format' });
  }
  const mazeSize = loaded.size || SIZE;
  const mazeWalls = loaded.mazeWalls;
  const boobytrapPositions = loaded.boobytraps || [];
  const tileDescriptions = loaded.tileDescriptions || {};

  // Normalise taskDefinitions to { [tileId]: { taskType, taskConfig } }
  let taskDefObj = {};
  const raw = loaded.taskDefinitions;
  if (Array.isArray(raw)) {
    raw.forEach(d => { taskDefObj[d.tileId] = { taskType: d.taskType, taskConfig: d.taskConfig }; });
  } else if (raw && typeof raw === 'object') {
    taskDefObj = raw;
  }

  // Build initial tile state; use taskConfig.target as completionsRequired when present.
  const mazeState = Array(mazeSize * mazeSize).fill().map((_, i) => {
    const tileId = i + 1;
    const def = taskDefObj[tileId];
    return {
      id: tileId,
      completed: false,
      completionsRequired: def?.taskConfig?.target || 1,
      completionsDone: 0
    };
  });

  await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
  await saveTaskDefinitions(team, taskDefObj);
  // Clear previous progress log when a new maze is created.
  await dbQuery('DELETE FROM tile_progress WHERE team = ?', [team]);
  res.json({ success: true });
});

const tasks = [
  { id: 1, description: 'Find the shortest path to the end.' },
  { id: 2, description: 'Collect all boobytraps.' },
  { id: 3, description: 'Complete all corner tiles.' }
];

app.get('/api/tasks', (req, res) => {
  res.json(tasks);
});

// Uncomplete a tile if it has exactly 1 adjacent completed tile.
app.post('/api/tiles/uncomplete/:id', async (req, res) => {
  const team = req.query.team;
  const id = parseInt(req.params.id, 10);
  let { mazeState, mazeWalls, boobytrapPositions, tileDescriptions } = await loadMazeFromDb(team);
  const tile = mazeState.find(t => t.id === id);
  if (!tile)           return res.status(404).json({ error: 'Tile not found' });
  if (!tile.completed) return res.status(400).json({ error: 'Tile is not completed' });
  const idx = id - 1;
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const neighbors = [
    { r: row - 1, c: col }, { r: row + 1, c: col },
    { r: row, c: col - 1 }, { r: row, c: col + 1 }
  ];
  let completedCount = 0;
  for (const { r, c } of neighbors) {
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      if (mazeState[r * SIZE + c].completed) completedCount++;
    }
  }
  if (completedCount !== 1) {
    return res.status(400).json({ error: 'Tile cannot be uncompleted (must have exactly 1 adjacent completed tile)' });
  }
  if (tile.completionsDone > 0) tile.completionsDone--;
  if (tile.completionsDone < (tile.completionsRequired || 1)) tile.completed = false;
  await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
  res.json({ success: true, tile });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
