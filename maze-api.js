// Express API for Maze Bingo
// npm install express canvas puppeteer cors sqlite3

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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

// Database setup
const DB_PATH = 'maze.db';
const db = new sqlite3.Database(DB_PATH);

// --- DB MIGRATION: Add completionsRequired, completionsDone, and team columns if not exist ---
db.serialize(() => {
  db.get("PRAGMA table_info(tiles)", (err, info) => {
    db.run(`ALTER TABLE tiles ADD COLUMN completionsRequired INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE tiles ADD COLUMN completionsDone INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE tiles ADD COLUMN team TEXT DEFAULT ''`, () => {});
  });
  db.get("PRAGMA table_info(walls)", (err, info) => {
    db.run(`ALTER TABLE walls ADD COLUMN team TEXT DEFAULT ''`, () => {});
  });
  db.get("PRAGMA table_info(boobytraps)", (err, info) => {
    db.run(`ALTER TABLE boobytraps ADD COLUMN team TEXT DEFAULT ''`, () => {});
  });
  db.get("PRAGMA table_info(tileDescriptions)", (err, info) => {
    db.run(`ALTER TABLE tileDescriptions ADD COLUMN team TEXT DEFAULT ''`, () => {});
  });
});

// Initialize DB tables if not exist
function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tiles (id INTEGER, team TEXT, completed INTEGER, completionsRequired INTEGER DEFAULT 1, completionsDone INTEGER DEFAULT 0, PRIMARY KEY (id, team))`);
    db.run(`CREATE TABLE IF NOT EXISTS walls (row INTEGER, col INTEGER, team TEXT, walls TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS boobytraps (row INTEGER, col INTEGER, team TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS tileDescriptions (tileId INTEGER, team TEXT, description TEXT, PRIMARY KEY (tileId, team))`);
  });
}
initDb();

// --- TEAM-AWARE DB HELPERS ---
function loadMazeFromDb(team, callback) {
  db.serialize(() => {
    db.all('SELECT * FROM tiles WHERE team = ?', [team], (err, tiles) => {
      if (!err && tiles.length > 0) {
        mazeState = tiles.map(t => ({
          id: t.id,
          completed: !!t.completed,
          completionsRequired: t.completionsRequired !== undefined ? t.completionsRequired : 1,
          completionsDone: t.completionsDone !== undefined ? t.completionsDone : 0
        }));
        db.all('SELECT * FROM walls WHERE team = ?', [team], (err, rows) => {
          mazeWalls = rows.map(r => ({ row: r.row, col: r.col, walls: JSON.parse(r.walls) }));
          db.all('SELECT * FROM boobytraps WHERE team = ?', [team], (err, traps) => {
            boobytrapPositions = traps.map(t => ({ row: t.row, col: t.col }));
            db.all('SELECT * FROM tileDescriptions WHERE team = ?', [team], (err, descs) => {
              tileDescriptions = {};
              descs.forEach(d => { tileDescriptions[d.tileId] = d.description; });
              if (callback) callback();
            });
          });
        });
      } else {
        // DB is empty for this team, initialize default maze and save
        mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({ id: i + 1, completed: false, completionsRequired: 1, completionsDone: 0 }));
        mazeWalls = [];
        boobytrapPositions = [];
        tileDescriptions = {};
        saveMazeToDb(team);
        if (callback) callback();
      }
    });
  });
}

function saveMazeToDb(team) {
  db.serialize(() => {
    db.run('DELETE FROM tiles WHERE team = ?', [team]);
    const tileStmt = db.prepare('INSERT INTO tiles (id, team, completed, completionsRequired, completionsDone) VALUES (?, ?, ?, ?, ?)');
    mazeState.forEach(t => tileStmt.run(t.id, team, t.completed ? 1 : 0, t.completionsRequired || 1, t.completionsDone || 0));
    tileStmt.finalize();
    db.run('DELETE FROM walls WHERE team = ?', [team]);
    const wallStmt = db.prepare('INSERT INTO walls (row, col, team, walls) VALUES (?, ?, ?, ?)');
    mazeWalls.forEach(w => wallStmt.run(w.row, w.col, team, JSON.stringify(w.walls)));
    wallStmt.finalize();
    db.run('DELETE FROM boobytraps WHERE team = ?', [team]);
    const trapStmt = db.prepare('INSERT INTO boobytraps (row, col, team) VALUES (?, ?, ?)');

    boobytrapPositions.forEach(b => trapStmt.run(b.row, b.col, team));
    trapStmt.finalize();
    db.run('DELETE FROM tileDescriptions WHERE team = ?', [team]);
    const descStmt = db.prepare('INSERT INTO tileDescriptions (tileId, team, description) VALUES (?, ?, ?)');

    Object.entries(tileDescriptions).forEach(([id, desc]) => descStmt.run(id, team, desc));
    descStmt.finalize();
  });
}

// Load maze from DB on server start
loadMazeFromDb('default', () => {
  console.log('Maze state loaded from database');
});

// Fetch all tiles
app.get('/api/tiles', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  loadMazeFromDb(team, () => {
    res.json(mazeState);
  });
});

// Only allow completing revealed tiles
app.post('/api/tiles/complete/:id', async (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  await new Promise(resolve => loadMazeFromDb(team, resolve));
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  // Declare these once at the top
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  const endId = Math.floor(SIZE / 2) + 1;
  const isStart = id === startId;
  const isEnd = id === endId;
  let specialEvent = null; // { type: 'boobytrap'|'chest', message: string }

  // If tile is already completed, just return a JSON response (do not send screenshot)
  if (tile.completed) {
    return res.json({ success: false, alreadyCompleted: true, tile });
  }
  // Only allow if tile is revealed (completed neighbor with no wall or is START/END)
  if (!tile.completed && !isStart) { // REMOVE !isEnd exception
    const idx = id - 1;
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    const directions = [
      { dr: -1, dc: 0, wall: 'top', neighborWall: 'bottom' }, // up
      { dr: 1, dc: 0, wall: 'bottom', neighborWall: 'top' },   // down
      { dr: 0, dc: -1, wall: 'left', neighborWall: 'right' },  // left
      { dr: 0, dc: 1, wall: 'right', neighborWall: 'left' }    // right
    ];
    // Helper to get wall object
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
        return false; // Wall blocks the path
      }
      return true;
    });
    if (!revealed) {
      return res.status(403).json({ error: 'Tile is not revealed (blocked by wall or no adjacent completed tile)' });
    }
  }
  // --- COMPLETION LOGIC ---
  if (!tile.completed) {
    tile.completionsDone = (tile.completionsDone || 0) + 1;
    if (tile.completionsDone >= (tile.completionsRequired || 1)) {
      tile.completed = true;
      // --- BOOBYTRAP LOGIC: If this tile is a boobytrap, add a required completion to a random revealed, uncompleted tile ---
      const idx = id - 1;
      const row = Math.floor(idx / SIZE);
      const col = idx % SIZE;
      const isBoobytrap = boobytrapPositions.some(b => b.row === row && b.col === col);
      if (isBoobytrap) {
        // Find all revealed, uncompleted, non-START/END tiles
        // Helper to get wall object
        function getWallObj(r, c) {
          return mazeWalls.find(w => w.row === r && w.col === c);
        }
        // Find revealed tiles
        const revealed = new Set();
        mazeState.forEach((t, i) => {
          if (t.completed) {
            revealed.add(i);
            const row = Math.floor(i / SIZE);
            const col = i % SIZE;
            const wallObj = getWallObj(row, col);
            // Up
            if (row > 0) {
              const nIdx = (row - 1) * SIZE + col;
              const nWallObj = getWallObj(row - 1, col);
              if ((!wallObj || !wallObj.walls.top) && (!nWallObj || !nWallObj.walls.bottom)) revealed.add(nIdx);
            }
            // Down
            if (row < SIZE - 1) {
              const nIdx = (row + 1) * SIZE + col;
              const nWallObj = getWallObj(row + 1, col);
              if ((!wallObj || !wallObj.walls.bottom) && (!nWallObj || !nWallObj.walls.top)) revealed.add(nIdx);
            }
            // Left
            if (col > 0) {
              const nIdx = row * SIZE + (col - 1);
              const nWallObj = getWallObj(row, col - 1);
              if ((!wallObj || !wallObj.walls.left) && (!nWallObj || !nWallObj.walls.right)) revealed.add(nIdx);
            }
            // Right
            if (col < SIZE - 1) {
              const nIdx = row * SIZE + (col + 1);
              const nWallObj = getWallObj(row, col + 1);
              if ((!wallObj || !wallObj.walls.right) && (!nWallObj || !nWallObj.walls.left)) revealed.add(nIdx);
            }
          }
        });
        // Filter to only uncompleted, non-START/END
        const candidates = Array.from(revealed).filter(i => {
          const t = mazeState[i];
          return !t.completed && t.id !== startId && t.id !== endId;
        });
        if (candidates.length > 0) {
          const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
          mazeState[pickIdx].completionsRequired = (mazeState[pickIdx].completionsRequired || 1) + 1;
          saveMazeToDb(team); // Save before screenshot
          specialEvent = { type: 'boobytrap', message: `Booby trap triggered: tile ${mazeState[pickIdx].id} requires extra completion` };
        }
      }
      // --- END BOOBYTRAP LOGIC ---
      // --- DEAD-END LOGIC: If this tile is a dead-end, lower a random revealed tile's completionsRequired by 1 ---
      // Dead-end: completed, not START/END, surrounded by 3 walls
      const deadendIdx = id - 1;
      const deadendRow = Math.floor(deadendIdx / SIZE);
      const deadendCol = deadendIdx % SIZE;
      const wallObj = mazeWalls.find(w => w.row === deadendRow && w.col === deadendCol);
      if (wallObj && id !== startId && id !== endId) {
        const wallCount = ['top', 'right', 'bottom', 'left'].reduce((count, dir) => count + (wallObj.walls[dir] ? 1 : 0), 0);
        if (wallCount === 3) {
          // Find all revealed, uncompleted, non-START/END tiles with completionsRequired > 0
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
              // Up
              if (row2 > 0) {
                const nIdx = (row2 - 1) * SIZE + col2;
                const nWallObj = getWallObj2(row2 - 1, col2);
                if ((!wallObj2 || !wallObj2.walls.top) && (!nWallObj || !nWallObj.walls.bottom)) revealed.add(nIdx);
              }
              // Down
              if (row2 < SIZE - 1) {
                const nIdx = (row2 + 1) * SIZE + col2;
                const nWallObj = getWallObj2(row2 + 1, col2);
                if ((!wallObj2 || !wallObj2.walls.bottom) && (!nWallObj || !nWallObj.walls.top)) revealed.add(nIdx);
              }
              // Left
              if (col2 > 0) {
                const nIdx = row2 * SIZE + (col2 - 1);
                const nWallObj = getWallObj2(row2, col2 - 1);
                if ((!wallObj2 || !wallObj2.walls.left) && (!nWallObj || !nWallObj.walls.right)) revealed.add(nIdx);
              }
              // Right
              if (col2 < SIZE - 1) {
                const nIdx = row2 * SIZE + (col2 + 1);
                const nWallObj = getWallObj2(row2, col2 + 1);
                if ((!wallObj2 || !wallObj2.walls.right) && (!nWallObj || !nWallObj.walls.left)) revealed.add(nIdx);
              }
            }
          });
          // Filter to only uncompleted, non-START/END, completionsRequired > 0
          const candidates = Array.from(revealed).filter(i => {
            const t = mazeState[i];
            return !t.completed && t.id !== startId && t.id !== endId && (t.completionsRequired || 1) > 0;
          });
          if (candidates.length > 0) {
            const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
            mazeState[pickIdx].completionsRequired = (mazeState[pickIdx].completionsRequired || 1) - 1;
            // If completionsRequired drops to 0, mark as completed
            if (mazeState[pickIdx].completionsRequired <= 0) {
              mazeState[pickIdx].completionsRequired = 0;
              mazeState[pickIdx].completed = true;
              mazeState[pickIdx].completionsDone = 0;
              saveMazeToDb(team);
              specialEvent = { type: 'chest', message: `You found a chest, tile ${mazeState[pickIdx].id} has been completed` };
            } else {
              // If not fully completed, still save state and continue
              saveMazeToDb(team);
              specialEvent = { type: 'chest', message: `You found a chest! Tile ${mazeState[pickIdx].id} needs one less completion` };
            }
          }
        }
      }
      // --- END DEAD-END LOGIC ---
    }
  }
  saveMazeToDb(team);
  // Reveal neighbors (set their completed=false if not already present)
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
  // --- SCREENSHOT LOGIC ---
  try {
    const url = (process.env.FRONTEND_URL || 'https://mazeracebingo-1.onrender.com/') + `?team=${encodeURIComponent(team)}`;
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    // Hide the button panel before screenshot
    await page.evaluate(() => {
      const panel = document.querySelector('.button-panel');
      if (panel) panel.classList.add('hide-for-screenshot');
    });
    const screenshot = await page.screenshot({ fullPage: true });
    // Restore the button panel
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
    // Log error for debugging
    console.error('Screenshot failed:', err);
    // Return a 200 with a 1x1 PNG and error header so Discord bot can show fallback
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
      'base64'
    );
    res.set('Content-Type', 'image/png');
    if (specialEvent) {
      if (specialEvent.type === 'boobytrap') {
        res.set('X-Boobytrap-Message', specialEvent.message + ' (screenshot failed)');
      } else if (specialEvent.type === 'chest') {
        res.set('X-Chest-Message', specialEvent.message + ' (screenshot failed)');
      }
    } else {
      res.set('X-Error-Message', 'Screenshot failed: ' + err.message);
    }
    res.send(png1x1);
  }
});

// Real browser screenshot endpoint
app.get('/api/current', (req, res) => {
  const team = req.query.team;
  if (!team) return res.status(400).json({ error: 'Missing team' });
  loadMazeFromDb(team, () => {
    res.json({
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
    res.json({
      size: SIZE,
      walls: mazeWalls,
      tiles: mazeState,
      boobytraps: boobytrapPositions,
      tileDescriptions // Include tileDescriptions in the response
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

// Sample task list (can be made dynamic later)
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
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  if (!tile.completed) return res.status(400).json({ error: 'Tile is not completed' });
  // Find neighbors
  const idx = id - 1;
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const neighbors = [
    { r: row - 1, c: col },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
    { r: row, c: col + 1 }
  ];
  // Count adjacent completed tiles
  let completedCount = 0;
  for (const { r, c } of neighbors) {
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      if (mazeState[r * SIZE + c].completed) completedCount++;
    }
  }
  if (completedCount !== 1) {
    return res.status(400).json({ error: 'Tile cannot be uncompleted (must have exactly 1 adjacent completed tile)' });
  }
  // --- UNCOMPLETE LOGIC ---
  if (tile.completionsDone > 0) tile.completionsDone--;
  if (tile.completionsDone < (tile.completionsRequired || 1)) {
    tile.completed = false;
  }
  saveMazeToDb(team);
  // Unreveal relevant tiles: unreveal any neighbor that is not adjacent to any other completed tile
  for (const { r, c } of neighbors) {
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const nIdx = r * SIZE + c;
      const neighbor = mazeState[nIdx];
      if (!neighbor.completed) {
        // Check if this neighbor is still adjacent to any completed tile
        const nRow = Math.floor(nIdx / SIZE);
        const nCol = nIdx % SIZE;
        const nNeighbors = [
          { r: nRow - 1, c: nCol },
          { r: nRow + 1, c: nCol },
          { r: nRow, c: nCol - 1 },
          { r: nRow, c: nCol + 1 }
        ];
        const stillRevealed = nNeighbors.some(({ r, c }) =>
          r >= 0 && r < SIZE && c >= 0 && c < SIZE && mazeState[r * SIZE + c].completed
        );
        if (!stillRevealed) {
          // This neighbor is no longer revealed (no-op, as revealed is frontend logic)
        }
      }
    }
  }
  res.json({ success: true, tile });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
