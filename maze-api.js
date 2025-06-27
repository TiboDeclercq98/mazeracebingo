// Express API for Maze Bingo
// npm install express canvas puppeteer cors mysql2

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const cors = require('cors');
const mysql = require('mysql2');
const { chromium } = require('playwright');
const app = express();
app.use(express.json());
app.use(cors());

const SIZE = 9; // 9x9 grid as in your app
let mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({
  id: i + 1,
  completed: false,
}));

// --- Unified Maze State ---
let mazeWalls = [];
let boobytrapPositions = [];
let tileDescriptions = {}; // New state for tile descriptions

// MySQL configuration
const mysqlConfig = {
  host: 'mysql.db.bot-hosting.net',
  user: 'u429845_rT36iNQGxe',
  password: 'Rkam^lnBr8YsDYr@B6SMC9.r',
  database: 's429845_MazeRaceBingoStates',
  port: 3306
};
const db = mysql.createPool(mysqlConfig);

// Helper for queries (returns Promise)
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
}
initDb();

// --- TEAM-AWARE DB HELPERS ---
function loadMazeFromDb(team, callback) {
  dbQuery('SELECT * FROM tiles WHERE team = ?', [team])
    .then(tiles => {
      if (tiles.length > 0) {
        mazeState = tiles.map(t => ({
          id: t.id,
          completed: !!t.completed,
          completionsRequired: t.completionsRequired !== undefined ? t.completionsRequired : 1,
          completionsDone: t.completionsDone !== undefined ? t.completionsDone : 0
        }));
        return dbQuery('SELECT * FROM walls WHERE team = ?', [team]);
      } else {
        // DB is empty for this team, initialize default maze and save
        mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({ id: i + 1, completed: false, completionsRequired: 1, completionsDone: 0 }));
        mazeWalls = [];
        boobytrapPositions = [];
        tileDescriptions = {};
        // Wait for saveMazeToDb to finish before callback
        return saveMazeToDb(team).then(() => null);
      }
    })
    .then(rows => {
      if (!rows) return dbQuery('SELECT * FROM walls WHERE team = ?', [team]);
      mazeWalls = rows.map(r => ({ row: r.row, col: r.col, walls: JSON.parse(r.walls) }));
      return dbQuery('SELECT * FROM boobytraps WHERE team = ?', [team]);
    })
    .then(traps => {
      boobytrapPositions = traps.map(t => ({ row: t.row, col: t.col }));
      return dbQuery('SELECT * FROM tileDescriptions WHERE team = ?', [team]);
    })
    .then(descs => {
      tileDescriptions = {};
      descs.forEach(d => { tileDescriptions[d.tileId] = d.description; });
      if (callback) callback();
    })
    .catch(err => {
      console.error('Error loading maze from DB:', err);
      if (callback) callback();
    });
}

function saveMazeToDb(team) {
  return dbQuery('DELETE FROM tiles WHERE team = ?', [team])
    .then(() => {
      const tileInserts = mazeState.map(t => dbQuery(
        'INSERT INTO tiles (id, team, completed, completionsRequired, completionsDone) VALUES (?, ?, ?, ?, ?)',
        [t.id, team, t.completed ? 1 : 0, t.completionsRequired || 1, t.completionsDone || 0]
      ));
      return Promise.all(tileInserts);
    })
    .then(() => dbQuery('DELETE FROM walls WHERE team = ?', [team]))
    .then(() => {
      const wallInserts = mazeWalls.map(w => dbQuery(
        'INSERT INTO walls (row, col, team, walls) VALUES (?, ?, ?, ?)',
        [w.row, w.col, team, JSON.stringify(w.walls)]
      ));
      return Promise.all(wallInserts);
    })
    .then(() => dbQuery('DELETE FROM boobytraps WHERE team = ?', [team]))
    .then(() => {
      const trapInserts = boobytrapPositions.map(b => dbQuery(
        'INSERT INTO boobytraps (row, col, team) VALUES (?, ?, ?)',
        [b.row, b.col, team]
      ));
      return Promise.all(trapInserts);
    })
    .then(() => dbQuery('DELETE FROM tileDescriptions WHERE team = ?', [team]))
    .then(() => {
      const descInserts = Object.entries(tileDescriptions).map(([tileId, description]) => dbQuery(
        'INSERT INTO tileDescriptions (tileId, team, description) VALUES (?, ?, ?)',
        [tileId, team, description]
      ));
      return Promise.all(descInserts);
    })
    .catch(err => {
      console.error('Error saving maze to DB:', err);
    });
}

// --- EXPRESS ROUTES ---

// Fetch all tiles
app.get('/api/tiles', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  loadMazeFromDb(team, () => {
    if (!res.headersSent) res.json(mazeState);
  });
});

// Complete a tile
app.post('/api/tiles/complete/:id', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  await new Promise(resolve => loadMazeFromDb(team, resolve));
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  const endId = Math.floor(SIZE / 2) + 1;
  const isStart = id === startId;
  const isEnd = id === endId;
  let specialEvent = null;
  if (tile.completed) {
    return res.status(400).json({ success: false, alreadyCompleted: true, tile });
  }
  if (!tile.completed && !isStart) {
    const idx = id - 1;
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    const directions = [
      { dr: -1, dc: 0, wall: 'top', neighborWall: 'bottom' },
      { dr: 1, dc: 0, wall: 'bottom', neighborWall: 'top' },
      { dr: 0, dc: -1, wall: 'left', neighborWall: 'right' },
      { dr: 0, dc: 1, wall: 'right', neighborWall: 'left' }
    ];
    function getWallObj(r, c) {
      return mazeWalls.find(w => w.row === r && w.col === c);
    }
    const revealed = directions.some(({ dr, dc, wall, neighborWall }) => {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return false;
      const neighborIdx = nr * SIZE + nc;
      const neighbor = mazeState[neighborIdx];
      if (!neighbor.completed) return false;
      const wallObj = getWallObj(row, col);
      const neighborWallObj = getWallObj(nr, nc);
      if ((wallObj && wallObj.walls[wall]) || (neighborWallObj && neighborWallObj.walls[neighborWall])) {
        return false;
      }
      return true;
    });
    if (!revealed) {
      return res.status(403).json({ error: 'Tile is not revealed (blocked by wall or no adjacent completed tile)' });
    }
  }
  if (!tile.completed) {
    tile.completionsDone = (tile.completionsDone || 0) + 1;
    if (tile.completionsDone >= (tile.completionsRequired || 1)) {
      tile.completed = true;
      const idx = id - 1;
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;
      const isBoobytrap = boobytrapPositions.some(b => b.row === row && b.col === col);
      if (isBoobytrap) {
        function getWallObj(r, c) {
          return mazeWalls.find(w => w.row === r && w.col === c);
        }
        const revealed = new Set();
        mazeState.forEach((t, i) => {
          if (t.completed) {
            revealed.add(i);
            const row = Math.floor(i / SIZE);
            const col = i % SIZE;
            const wallObj = getWallObj(row, col);
            if (row > 0) {
              const nIdx = (row - 1) * SIZE + col;
              const nWallObj = getWallObj(row - 1, col);
              if ((!wallObj || !wallObj.walls.top) && (!nWallObj || !nWallObj.walls.bottom)) revealed.add(nIdx);
            }
            if (row < SIZE - 1) {
              const nIdx = (row + 1) * SIZE + col;
              const nWallObj = getWallObj(row + 1, col);
              if ((!wallObj || !wallObj.walls.bottom) && (!nWallObj || !nWallObj.walls.top)) revealed.add(nIdx);
            }
            if (col > 0) {
              const nIdx = row * SIZE + (col - 1);
              const nWallObj = getWallObj(row, col - 1);
              if ((!wallObj || !wallObj.walls.left) && (!nWallObj || !nWallObj.walls.right)) revealed.add(nIdx);
            }
            if (col < SIZE - 1) {
              const nIdx = row * SIZE + (col + 1);
              const nWallObj = getWallObj(row, col + 1);
              if ((!wallObj || !wallObj.walls.right) && (!nWallObj || !nWallObj.walls.left)) revealed.add(nIdx);
            }
          }
        });
        const candidates = Array.from(revealed).filter(i => {
          const t = mazeState[i];
          return !t.completed && t.id !== startId && t.id !== endId;
        });
        if (candidates.length > 0) {
          const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
          mazeState[pickIdx].completionsRequired = (mazeState[pickIdx].completionsRequired || 1) + 1;
          saveMazeToDb(team);
          specialEvent = { type: 'boobytrap', message: `Booby trap triggered: tile ${mazeState[pickIdx].id} requires extra completion` };
        }
      }
      const deadendIdx = id - 1;
      const deadendRow = Math.floor(deadendIdx / SIZE);
      const deadendCol = deadendIdx % SIZE;
      const wallObj = mazeWalls.find(w => w.row === deadendRow && w.col === deadendCol);
      if (wallObj && id !== startId && id !== endId) {
        const wallCount = ['top', 'right', 'bottom', 'left'].reduce((count, dir) => count + (wallObj.walls[dir] ? 1 : 0), 0);
        if (wallCount === 3) {
          function getWallObj2(r, c) {
            return mazeWalls.find(w => w.row === r && w.col === c);
          }
          const revealed = new Set();
          mazeState.forEach((t, i) => {
            if (t.completed) {
              revealed.add(i);
              const row2 = Math.floor(i / SIZE);
              const col2 = i % SIZE;
              const wallObj2 = getWallObj2(row2, col2);
              if (row2 > 0) {
                const nIdx = (row2 - 1) * SIZE + col2;
                const nWallObj = getWallObj2(row2 - 1, col2);
                if ((!wallObj2 || !wallObj2.walls.top) && (!nWallObj || !nWallObj.walls.bottom)) revealed.add(nIdx);
              }
              if (row2 < SIZE - 1) {
                const nIdx = (row2 + 1) * SIZE + col2;
                const nWallObj = getWallObj2(row2 + 1, col2);
                if ((!wallObj2 || !wallObj2.walls.bottom) && (!nWallObj || !nWallObj.walls.top)) revealed.add(nIdx);
              }
              if (col2 > 0) {
                const nIdx = row2 * SIZE + (col2 - 1);
                const nWallObj = getWallObj2(row2, col2 - 1);
                if ((!wallObj2 || !wallObj2.walls.left) && (!nWallObj || !nWallObj.walls.right)) revealed.add(nIdx);
              }
              if (col2 < SIZE - 1) {
                const nIdx = row2 * SIZE + (col2 + 1);
                const nWallObj = getWallObj2(row2, col2 + 1);
                if ((!wallObj2 || !wallObj2.walls.right) && (!nWallObj || !nWallObj.walls.left)) revealed.add(nIdx);
              }
            }
          });
          const candidates = Array.from(revealed).filter(i => {
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
              saveMazeToDb(team);
              specialEvent = { type: 'chest', message: `You found a chest, tile ${mazeState[pickIdx].id} has been completed` };
            } else {
              saveMazeToDb(team);
              specialEvent = { type: 'chest', message: `You found a chest! Tile ${mazeState[pickIdx].id} needs one less completion` };
            }
          }
        }
      }
    }
  }
  saveMazeToDb(team);
  const idx = id - 1;
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const neighbors = [
    { r: row - 1, c: col },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
    { r: row, c: col + 1 }
  ];
  for (const { r, c } of neighbors) {
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const nIdx = r * SIZE + c;
      if (!mazeState[nIdx].completed) {
        // No-op: revealed = not completed but adjacent to a completed tile
      }
    }
  }
  try {
    const url = (process.env.FRONTEND_URL || 'https://mazeracebingo-1.onrender.com/') + `?team=${encodeURIComponent(team)}`;
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const panel = document.querySelector('.button-panel');
      if (panel) panel.classList.add('hide-for-screenshot');
    });
    const screenshot = await page.screenshot({ fullPage: true });
    await page.evaluate(() => {
      const panel = document.querySelector('.button-panel');
      if (panel) panel.classList.remove('hide-for-screenshot');
    });
    await browser.close();
    res.set('Content-Type', 'image/png');
    if (specialEvent) {
      if (specialEvent.type === 'boobytrap') {
        res.set('X-Boobytrap-Message', specialEvent.message);
      } else if (specialEvent.type === 'chest') {
        res.set('X-Chest-Message', specialEvent.message);
      }
    }
    res.send(screenshot);
  } catch (err) {
    console.error('Screenshot failed:', err);
    // On screenshot error, return JSON error instead of PNG
    if (!res.headersSent) {
      res.status(500).type('application/json').json({ error: 'Screenshot failed', details: err.message, specialEvent });
    }
  }
});

// Real browser screenshot endpoint
app.get('/api/current', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  loadMazeFromDb(team, () => {
    if (!res.headersSent) res.json({
      size: SIZE,
      walls: mazeWalls,
      tiles: mazeState,
      boobytraps: boobytrapPositions,
      tileDescriptions
    });
  });
});

// New endpoint: fetch full maze state
app.get('/api/maze', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  loadMazeFromDb(team, () => {
    if (!res.headersSent) res.json({
      size: SIZE,
      walls: mazeWalls,
      tiles: mazeState,
      boobytraps: boobytrapPositions,
      tileDescriptions
    });
  });
});

// Create a new maze from save file content
app.post('/api/create', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  const { saveData } = req.body;
  if (!saveData) return res.status(400).json({ error: 'Missing saveData' });
  let loaded;
  try {
    loaded = typeof saveData === 'string' ? JSON.parse(saveData) : saveData;
    if (loaded && Array.isArray(loaded.mazeWalls)) {
      mazeWalls = loaded.mazeWalls;
      const mazeSize = loaded.size || SIZE;
      mazeState = Array(mazeSize * mazeSize).fill().map((_, i) => ({
        id: i + 1,
        completed: false,
        completionsRequired: 1,
        completionsDone: 0
      }));
      boobytrapPositions = loaded.boobytraps || [];
      tileDescriptions = loaded.tileDescriptions || {};
      saveMazeToDb(team);
      res.json({ success: true });
    } else {
      return res.status(400).json({ error: 'Invalid save file format' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in saveData' });
  }
});

// Sample task list
const tasks = [
  { id: 1, description: 'Find the shortest path to the end.' },
  { id: 2, description: 'Collect all boobytraps.' },
  { id: 3, description: 'Complete all corner tiles.' }
];

app.get('/api/tasks', (req, res) => {
  res.json(tasks);
});

// Uncomplete a tile if only one adjacent completed tile
app.post('/api/tiles/uncomplete/:id', (req, res) => {
  const team = req.query.team;
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  if (!tile.completed) return res.status(400).json({ error: 'Tile is not completed' });
  const idx = id - 1;
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const neighbors = [
    { r: row - 1, c: col },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
    { r: row, c: col + 1 }
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
  if (tile.completionsDone < (tile.completionsRequired || 1)) {
    tile.completed = false;
  }
  saveMazeToDb(team);
  res.json({ success: true, tile });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
