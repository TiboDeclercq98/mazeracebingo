// Express API for Maze Bingo
// npm install express canvas puppeteer cors sqlite3

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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

// Initialize DB tables if not exist
function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tiles (id INTEGER PRIMARY KEY, completed INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS walls (row INTEGER, col INTEGER, walls TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS boobytraps (row INTEGER, col INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS tileDescriptions (tileId INTEGER PRIMARY KEY, description TEXT)`);
  });
}
initDb();

// Load maze state from DB
function loadMazeFromDb(callback) {
  db.serialize(() => {
    db.all('SELECT * FROM tiles', (err, tiles) => {
      if (!err && tiles.length === SIZE * SIZE) {
        mazeState = tiles.map(t => ({ id: t.id, completed: !!t.completed }));
      }
      db.all('SELECT * FROM walls', (err, rows) => {
        mazeWalls = rows.map(r => ({ row: r.row, col: r.col, walls: JSON.parse(r.walls) }));
        db.all('SELECT * FROM boobytraps', (err, traps) => {
          boobytrapPositions = traps.map(t => ({ row: t.row, col: t.col }));
          db.all('SELECT * FROM tileDescriptions', (err, descs) => {
            tileDescriptions = {};
            descs.forEach(d => { tileDescriptions[d.tileId] = d.description; });
            if (callback) callback();
          });
        });
      });
    });
  });
}

// Save maze state to DB
function saveMazeToDb() {
  db.serialize(() => {
    db.run('DELETE FROM tiles');
    const tileStmt = db.prepare('INSERT INTO tiles (id, completed) VALUES (?, ?)');
    mazeState.forEach(t => tileStmt.run(t.id, t.completed ? 1 : 0));
    tileStmt.finalize();
    db.run('DELETE FROM walls');
    const wallStmt = db.prepare('INSERT INTO walls (row, col, walls) VALUES (?, ?, ?)');
    mazeWalls.forEach(w => wallStmt.run(w.row, w.col, JSON.stringify(w.walls)));
    wallStmt.finalize();
    db.run('DELETE FROM boobytraps');
    const trapStmt = db.prepare('INSERT INTO boobytraps (row, col) VALUES (?, ?)');
    boobytrapPositions.forEach(b => trapStmt.run(b.row, b.col));
    trapStmt.finalize();
    db.run('DELETE FROM tileDescriptions');
    const descStmt = db.prepare('INSERT INTO tileDescriptions (tileId, description) VALUES (?, ?)');
    Object.entries(tileDescriptions).forEach(([id, desc]) => descStmt.run(id, desc));
    descStmt.finalize();
  });
}

// Load maze from DB on server start
loadMazeFromDb(() => {
  console.log('Maze state loaded from database');
});

// Fetch all tiles
app.get('/api/tiles', (req, res) => {
  res.json(mazeState);
});

// Only allow completing revealed tiles
app.post('/api/tiles/complete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  // Only allow if tile is revealed (completed neighbor with no wall or is START/END)
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  const endId = Math.floor(SIZE / 2) + 1;
  const isStart = id === startId;
  const isEnd = id === endId;
  if (!tile.completed && !isStart && !isEnd) {
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
  tile.completed = true;
  saveMazeToDb();
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
        // Mark as revealed (but not completed)
        // No-op: in this model, revealed = not completed but adjacent to a completed tile
        // The frontend should show these as revealed based on neighbor logic
      }
    }
  }
  res.json({ success: true, tile });
});

// Real browser screenshot endpoint
app.get('/api/current', (req, res) => {
  res.json({
    size: SIZE,
    walls: mazeWalls,
    tiles: mazeState,
    boobytraps: boobytrapPositions,
    tileDescriptions
  });
});

// New endpoint: fetch full maze state
app.get('/api/maze', (req, res) => {
  res.json({
    size: SIZE,
    walls: mazeWalls,
    tiles: mazeState,
    boobytraps: boobytrapPositions,
    tileDescriptions // Include tileDescriptions in the response
  });
});

// Create a new maze from save file content
app.post('/api/create', (req, res) => {
  const { saveData } = req.body;
  if (!saveData) return res.status(400).json({ error: 'Missing saveData' });
  let loaded;
  try {
    loaded = typeof saveData === 'string' ? JSON.parse(saveData) : saveData;
    if (loaded && Array.isArray(loaded.mazeWalls)) {
      mazeWalls = loaded.mazeWalls;
      mazeState = Array(SIZE * SIZE).fill().map((_, i) => ({
        id: i + 1,
        completed: false,
      }));
      boobytrapPositions = loaded.boobytraps || [];
      tileDescriptions = loaded.tileDescriptions || {};
      saveMazeToDb();
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
  // Uncomplete the tile
  tile.completed = false;
  saveMazeToDb();
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
