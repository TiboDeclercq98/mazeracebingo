// Express API for Maze Race Bingo
// npm install express canvas cors pg playwright

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const cors = require('cors');
const { Pool } = require('pg');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());

// CORS: restrict to origins listed in ALLOWED_ORIGINS (comma-separated).
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || [];
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () =>
    console.log(`${req.method} ${req.path} team=${req.query.team || '-'} → ${res.statusCode} (${Date.now() - start}ms)`)
  );
  next();
});

const SIZE = 9; // 9x9 grid
// No global maze state — all state is per-request.

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function dbQuery(sql, params) {
  return db.query(sql, params).then(r => r.rows);
}

function batchInsertQuery(table, columns, rows) {
  const colCount = columns.length;
  const placeholders = rows.map((_, ri) =>
    `(${columns.map((_, ci) => `$${ri * colCount + ci + 1}`).join(', ')})`
  ).join(', ');
  return { sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, params: rows.flat() };
}

// --- TABLE CREATION (run once at startup) ---
async function initDb() {
  await dbQuery(`CREATE TABLE IF NOT EXISTS tiles (
    id INT,
    team VARCHAR(64),
    completed SMALLINT,
    completionsRequired INT DEFAULT 1,
    completionsDone INT DEFAULT 0,
    PRIMARY KEY (id, team)
  )`);
  await dbQuery(`CREATE TABLE IF NOT EXISTS walls (
    row INT,
    col INT,
    team VARCHAR(64),
    walls JSONB
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
    taskConfig JSONB NOT NULL,
    PRIMARY KEY (tileId, team)
  )`);
  // Append-only log of individual player progress contributions.
  // completionsDone on the tiles table is kept in sync as a cached SUM.
  await dbQuery(`CREATE TABLE IF NOT EXISTS tile_progress (
    id SERIAL PRIMARY KEY,
    tileId INT NOT NULL,
    team VARCHAR(64) NOT NULL,
    playerName VARCHAR(64) NOT NULL,
    amount INT NOT NULL DEFAULT 1,
    subCategory VARCHAR(64) DEFAULT NULL,
    submittedAt TIMESTAMPTZ DEFAULT NOW()
  )`);
  await dbQuery(`ALTER TABLE tile_progress ADD COLUMN IF NOT EXISTS subCategory VARCHAR(64) DEFAULT NULL`);
  // Team-visible event feed: tile completions and special events.
  await dbQuery(`CREATE TABLE IF NOT EXISTS team_events (
    id SERIAL PRIMARY KEY,
    team VARCHAR(64) NOT NULL,
    player_name VARCHAR(64),
    tile_id INT,
    type VARCHAR(32) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function insertTeamEvent(team, playerName, tileId, type, message) {
  await dbQuery(
    'INSERT INTO team_events (team, player_name, tile_id, type, message) VALUES ($1, $2, $3, $4, $5)',
    [team, playerName, tileId, type, message]
  );
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

// --- PLAYWRIGHT BROWSER POOLING ---
// One persistent browser is kept alive across requests; a new page is created per screenshot.
let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ args: ['--no-sandbox'] });
  }
  return _browser;
}

async function takeScreenshot(team) {
  const url     = (process.env.FRONTEND_URL || 'https://mazeracebingo-1.onrender.com/') + `?team=${encodeURIComponent(team)}`;
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => {
      const p = document.querySelector('.button-panel');
      if (p) p.classList.add('hide-for-screenshot');
    });
    return await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
}

// Close the browser cleanly on shutdown so container stops gracefully.
async function shutdown() {
  if (_browser) await _browser.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// --- TEAM-AWARE DB HELPERS ---

async function loadMazeFromDb(team) {
  let mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions;
  const tiles = await dbQuery('SELECT * FROM tiles WHERE team = $1 ORDER BY id', [team]);
  if (tiles.length > 0) {
    mazeState = tiles.map(t => ({
      id: t.id,
      completed: !!t.completed,
      completionsRequired: t.completionsrequired !== undefined ? t.completionsrequired : 1,
      completionsDone: t.completionsdone !== undefined ? t.completionsdone : 0
    }));
  } else {
    mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({ id: i + 1, completed: false, completionsRequired: 1, completionsDone: 0 }));
    mazeWalls = [];
    boobytrapPositions = [];
    tileDescriptions = {};
    taskDefinitions = {};
    await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
  }
  const wallsRows = await dbQuery('SELECT * FROM walls WHERE team = $1', [team]);
  mazeWalls = wallsRows.map(r => ({ row: r.row, col: r.col, walls: r.walls }));
  const traps = await dbQuery('SELECT * FROM boobytraps WHERE team = $1', [team]);
  boobytrapPositions = traps.map(t => ({ row: t.row, col: t.col }));
  const descs = await dbQuery('SELECT * FROM tileDescriptions WHERE team = $1', [team]);
  tileDescriptions = {};
  descs.forEach(d => { tileDescriptions[d.tileid] = d.description; });
  const taskDefs = await dbQuery('SELECT * FROM taskDefinitions WHERE team = $1', [team]);
  taskDefinitions = {};
  taskDefs.forEach(d => { taskDefinitions[d.tileid] = { taskType: d.tasktype, taskConfig: d.taskconfig }; });
  return { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions };
}

// All writes are wrapped in a single transaction; uses batch INSERTs to minimise round-trips.
async function saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions) {
  const client = await db.connect();
  const txQuery = (sql, params) => client.query(sql, params).then(r => r.rows);
  try {
    await txQuery('BEGIN');

    await txQuery('DELETE FROM tiles WHERE team = $1', [team]);
    if (mazeState.length > 0) {
      const q = batchInsertQuery('tiles',
        ['id', 'team', 'completed', 'completionsRequired', 'completionsDone'],
        mazeState.map(t => [t.id, team, t.completed ? 1 : 0, t.completionsRequired || 1, t.completionsDone || 0]));
      await txQuery(q.sql, q.params);
    }

    await txQuery('DELETE FROM walls WHERE team = $1', [team]);
    if (mazeWalls.length > 0) {
      const q = batchInsertQuery('walls',
        ['row', 'col', 'team', 'walls'],
        mazeWalls.map(w => [w.row, w.col, team, w.walls]));
      await txQuery(q.sql, q.params);
    }

    await txQuery('DELETE FROM boobytraps WHERE team = $1', [team]);
    if (boobytrapPositions.length > 0) {
      const q = batchInsertQuery('boobytraps',
        ['row', 'col', 'team'],
        boobytrapPositions.map(b => [b.row, b.col, team]));
      await txQuery(q.sql, q.params);
    }

    await txQuery('DELETE FROM tileDescriptions WHERE team = $1', [team]);
    const descEntries = Object.entries(tileDescriptions);
    if (descEntries.length > 0) {
      const q = batchInsertQuery('tileDescriptions',
        ['tileId', 'team', 'description'],
        descEntries.map(([tileId, description]) => [tileId, team, description]));
      await txQuery(q.sql, q.params);
    }

    await txQuery('COMMIT');
  } catch (err) {
    await txQuery('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Replaces all taskDefinitions for a team. Called only from POST /api/create.
async function saveTaskDefinitions(team, taskDefinitions) {
  await dbQuery('DELETE FROM taskDefinitions WHERE team = $1', [team]);
  const entries = Object.entries(taskDefinitions);
  if (entries.length > 0) {
    const q = batchInsertQuery('taskDefinitions',
      ['tileId', 'team', 'taskType', 'taskConfig'],
      entries.map(([tileId, def]) => [tileId, team, def.taskType, def.taskConfig]));
    await dbQuery(q.sql, q.params);
  }
}

// --- CORE GAME LOGIC ---

// Returns the ordered list of named entries for a task that uses "mode": "each".
function getEachModeItems(taskType, taskConfig) {
  if (taskType === 'npc_kill')    return taskConfig.npcs    || (taskConfig.npc    ? [taskConfig.npc]    : []);
  if (taskType === 'xp_gain')     return taskConfig.skills  || (taskConfig.skill  ? [taskConfig.skill]  : []);
  if (taskType === 'item_drop')   return taskConfig.items   || (taskConfig.item   ? [taskConfig.item]   : []);
  if (taskType === 'agility_lap') return taskConfig.courses || (taskConfig.course ? [taskConfig.course] : []);
  return [];
}

// Validates tile access, records a progress contribution, updates tile state, and fires special events.
// Returns { success, tile, specialEvent, progress, target, completed } on success,
// or { error, status } / { success: false, alreadyCompleted, tile, status } on failure.
async function submitTileProgress(team, id, playerName, amount, subCategory = null) {
  let { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions } = await loadMazeFromDb(team);
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

  if (isEnd && boobytrapPositions.length > 0) {
    const keysTotal = boobytrapPositions.length;
    const keysFound = boobytrapPositions.filter(b => mazeState[b.row * SIZE + b.col].completed).length;
    if (keysFound < keysTotal) {
      await insertTeamEvent(team, playerName, id, 'keys_missing', `${playerName} only has ${keysFound}/${keysTotal} keys`);
      return { error: `You have ${keysFound}/${keysTotal} keys`, status: 403 };
    }
  }

  // Record the individual contribution before updating the tile.
  await dbQuery(
    'INSERT INTO tile_progress (tileId, team, playerName, amount, subCategory) VALUES ($1, $2, $3, $4, $5)',
    [id, team, playerName, amount, subCategory || null]
  );

  let specialEvent = null;
  const taskDef = taskDefinitions[id];
  const taskCfg = taskDef ? taskDef.taskConfig : null;
  const taskTyp = taskDef ? taskDef.taskType : null;
  const isEachMode = !!(taskCfg && taskCfg.mode === 'each');

  // For "each" mode: every listed entry must independently reach the per-item target.
  // completionsDone = sum of min(actual, perItemTarget) across all entries (used for the progress display).
  // completionsRequired = entries.length * perItemTarget (the combined total shown in the Active Tasks panel).
  let tileComplete = false;
  if (isEachMode) {
    const items = getEachModeItems(taskTyp, taskCfg);
    const perItemTarget = taskCfg.target || 1;
    const perItemRows = await dbQuery(
      'SELECT subcategory, SUM(amount) AS total FROM tile_progress WHERE tileid = $1 AND team = $2 AND subcategory IS NOT NULL GROUP BY subcategory',
      [id, team]
    );
    const totals = {};
    perItemRows.forEach(r => { totals[r.subcategory.toLowerCase()] = parseInt(r.total); });
    let done = 0;
    let allMet = true;
    for (const name of items) {
      const actual = totals[name.toLowerCase()] || 0;
      done += Math.min(actual, perItemTarget);
      if (actual < perItemTarget) allMet = false;
    }
    tile.completionsDone = done;
    tile.completionsRequired = items.length * perItemTarget;
    tileComplete = allMet;
  } else {
    tile.completionsDone = (tile.completionsDone || 0) + amount;
    tileComplete = tile.completionsDone >= (tile.completionsRequired || 1);
  }

  if (tileComplete) {
    tile.completed = true;

    if (isEnd) {
      await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
      specialEvent = { type: 'gameover', message: 'The end tile was completed! The entire maze is now revealed. Game over.' };
      await insertTeamEvent(team, playerName, id, 'gameover', `${playerName} completed the end tile! Game over.`);
    } else {
      const idx = id - 1;
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;

      // Boobytrap: completing one grants a key required to unlock the end tile.
      const isBoobytrap = boobytrapPositions.some(b => b.row === row && b.col === col);
      if (isBoobytrap) {
        specialEvent = { type: 'boobytrap', message: 'You found a key!' };
      }

      await saveMazeToDb(team, mazeState, mazeWalls, boobytrapPositions, tileDescriptions);
      await insertTeamEvent(team, playerName, id, 'tile_complete', `${playerName} has completed tile ${id}!`);
      if (isBoobytrap) {
        await insertTeamEvent(team, playerName, id, 'boobytrap', `${playerName} has found a key!`);
      }
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

// Health check — verifies DB connectivity.
app.get('/health', async (req, res) => {
  try {
    await dbQuery('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'down', error: err.message });
  }
});

// Lightweight version stamp — returns the timestamp of the last progress submission for a team.
// Clients poll this cheaply to detect when a full refresh is needed.
app.get('/api/state-version', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const rows = await dbQuery(
      'SELECT MAX(submittedat) AS lastupdated FROM tile_progress WHERE team = $1',
      [team]
    );
    res.json({ lastUpdated: rows[0]?.lastupdated || null });
  } catch (err) { next(err); }
});

app.get('/api/tiles', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const { mazeState } = await loadMazeFromDb(team);
    res.json(mazeState);
  } catch (err) { next(err); }
});

// Complete a tile — backward-compatible endpoint used by the Discord bot.
// Submits progress of 1 as "Discord" and returns a Playwright PNG screenshot.
app.post('/api/tiles/complete/:id', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const id = parseInt(req.params.id, 10);
    const result = await submitTileProgress(team, id, 'Discord', 1);
    if (result.error)            return res.status(result.status).json({ error: result.error });
    if (result.alreadyCompleted) return res.status(400).json({ success: false, alreadyCompleted: true, tile: result.tile });
    const { specialEvent } = result;
    try {
      const screenshot = await takeScreenshot(team);
      res.set('Content-Type', 'image/png');
      if (specialEvent) {
        if (specialEvent.type === 'boobytrap') res.set('X-Boobytrap-Message', specialEvent.message);
        else if (specialEvent.type === 'gameover') res.set('X-Gameover-Message', specialEvent.message);
      }
      res.send(screenshot);
    } catch (screenshotErr) {
      console.error('Screenshot failed:', screenshotErr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Screenshot failed', details: screenshotErr.message, specialEvent });
      }
    }
  } catch (err) { next(err); }
});

// Submit incremental progress — primary endpoint for the RuneLite plugin.
// Body: { playerName: string, amount?: number (default 1) }
// Returns JSON: { progress, target, completed, specialEvent, tile }
app.post('/api/tiles/progress/:id', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const id          = parseInt(req.params.id, 10);
    const playerName  = req.body.playerName || 'unknown';
    const amount      = Math.max(1, parseInt(req.body.amount, 10) || 1);
    const subCategory = req.body.subCategory || null;
    const result = await submitTileProgress(team, id, playerName, amount, subCategory);
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
  } catch (err) { next(err); }
});

// Get the per-player contribution breakdown for a tile.
app.get('/api/tiles/progress/:id', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const id = parseInt(req.params.id, 10);
    const { mazeState } = await loadMazeFromDb(team);
    const tile = mazeState.find(t => t.id === id);
    if (!tile) return res.status(404).json({ error: 'Tile not found' });
    const taskDefs = await dbQuery('SELECT * FROM taskDefinitions WHERE tileid = $1 AND team = $2', [id, team]);
    const taskDef  = taskDefs[0] || null;
    const rows = await dbQuery(
      `SELECT playername, subcategory, SUM(amount) AS total, MAX(submittedat) AS lastsubmitted
       FROM tile_progress WHERE tileid = $1 AND team = $2
       GROUP BY playername, subcategory ORDER BY total DESC`,
      [id, team]
    );
    let itemProgress = null;
    if (taskDef && taskDef.taskconfig && taskDef.taskconfig.mode === 'each') {
      const taskCfg = taskDef.taskconfig;
      const items = getEachModeItems(taskDef.tasktype, taskCfg);
      const perItemTarget = taskCfg.target || 1;
      const perItemRows = await dbQuery(
        'SELECT subcategory, SUM(amount) AS total FROM tile_progress WHERE tileid = $1 AND team = $2 AND subcategory IS NOT NULL GROUP BY subcategory',
        [id, team]
      );
      const totals = {};
      perItemRows.forEach(r => { totals[r.subcategory.toLowerCase()] = parseInt(r.total); });
      itemProgress = items.map(name => ({
        name,
        progress: Math.min(totals[name.toLowerCase()] || 0, perItemTarget),
        target: perItemTarget
      }));
    }
    res.json({
      tileId: id,
      taskType:        taskDef ? taskDef.tasktype   : null,
      taskConfig:      taskDef ? taskDef.taskconfig : null,
      currentProgress: tile.completionsDone || 0,
      target:          tile.completionsRequired || 1,
      contributions:   rows.map(r => ({ playerName: r.playername, subCategory: r.subcategory || null, amount: r.total, lastSubmitted: r.lastsubmitted })),
      itemProgress
    });
  } catch (err) { next(err); }
});

app.get('/api/current', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions } = await loadMazeFromDb(team);
    const endId = Math.floor(SIZE / 2) + 1;
    const gameOver = mazeState.some(t => t.id === endId && t.completed);
    res.json({
      size: SIZE,
      walls: mazeWalls,
      tiles: mazeState.map(t => ({
        ...t,
        currentProgress: t.completionsDone || 0,
        taskType:   taskDefinitions[t.id]?.taskType   || null,
        taskConfig: taskDefinitions[t.id]?.taskConfig || null
      })),
      boobytraps: boobytrapPositions,
      tileDescriptions,
      gameOver
    });
  } catch (err) { next(err); }
});

app.get('/api/maze', async (req, res, next) => {
  try {
    const team = req.query.team;
    if (!team) return res.status(400).json({ error: 'Missing team' });
    const { mazeState, mazeWalls, boobytrapPositions, tileDescriptions, taskDefinitions } = await loadMazeFromDb(team);
    const endId = Math.floor(SIZE / 2) + 1;
    const gameOver = mazeState.some(t => t.id === endId && t.completed);
    const eventsRows = await dbQuery(
      'SELECT * FROM team_events WHERE team = $1 ORDER BY id DESC LIMIT 20',
      [team]
    );
    const recentEvents = eventsRows.reverse().map(r => ({
      id: r.id,
      type: r.type,
      playerName: r.player_name,
      tileId: r.tile_id,
      message: r.message
    }));
    res.json({
      size: SIZE,
      walls: mazeWalls,
      tiles: mazeState.map(t => ({
        ...t,
        currentProgress: t.completionsDone || 0,
        taskType:   taskDefinitions[t.id]?.taskType   || null,
        taskConfig: taskDefinitions[t.id]?.taskConfig || null
      })),
      boobytraps: boobytrapPositions,
      tileDescriptions,
      gameOver,
      recentEvents
    });
  } catch (err) { next(err); }
});

// Create a new maze from a save file.
// Accepts taskDefinitions as either an array [{ tileId, taskType, taskConfig }]
// or an object keyed by tileId. Setting taskConfig.target auto-sets completionsRequired.
app.post('/api/create', async (req, res, next) => {
  try {
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
    const mazeSize           = loaded.size || SIZE;
    const mazeWalls          = loaded.mazeWalls;
    const boobytrapPositions = loaded.boobytraps || [];
    const tileDescriptions   = loaded.tileDescriptions || {};

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
    await dbQuery('DELETE FROM tile_progress WHERE team = $1', [team]);
    res.json({ success: true });
  } catch (err) { next(err); }
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
app.post('/api/tiles/uncomplete/:id', async (req, res, next) => {
  try {
    const team = req.query.team;
    const id   = parseInt(req.params.id, 10);
    let { mazeState, mazeWalls, boobytrapPositions, tileDescriptions } = await loadMazeFromDb(team);
    const tile = mazeState.find(t => t.id === id);
    if (!tile)           return res.status(404).json({ error: 'Tile not found' });
    if (!tile.completed) return res.status(400).json({ error: 'Tile is not completed' });
    const idx  = id - 1;
    const row  = Math.floor(idx / SIZE);
    const col  = idx % SIZE;
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
  } catch (err) { next(err); }
});

// Global error handler — catches any unhandled errors from route handlers.
app.use((err, req, res, next) => {
  console.error(`[${req.method} ${req.path}]`, err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
