// Express API for Maze Bingo
// npm install express canvas puppeteer cors

const express = require('express');
const { createCanvas } = require('canvas');
const fs = require('fs');
const { chromium } = require('playwright');
const cors = require('cors');
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

// Fetch all tiles
app.get('/api/tiles', (req, res) => {
  res.json(mazeState);
});

// Only allow completing revealed tiles
app.post('/api/tiles/complete/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tile = mazeState.find(t => t.id === id);
  if (!tile) return res.status(404).json({ error: 'Tile not found' });
  // Only allow if tile is revealed (completed neighbor or is START/END)
  const startId = (SIZE - 1) * SIZE + Math.floor(SIZE / 2) + 1;
  const endId = Math.floor(SIZE / 2) + 1;
  const isStart = id === startId;
  const isEnd = id === endId;
  if (!tile.completed && !isStart && !isEnd) {
    // Check if any neighbor is completed
    const idx = id - 1;
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    const neighbors = [
      { r: row - 1, c: col },
      { r: row + 1, c: col },
      { r: row, c: col - 1 },
      { r: row, c: col + 1 }
    ];
    const revealed = neighbors.some(({ r, c }) =>
      r >= 0 && r < SIZE && c >= 0 && c < SIZE && mazeState[r * SIZE + c].completed
    );
    if (!revealed) {
      return res.status(403).json({ error: 'Tile is not revealed' });
    }
  }
  tile.completed = true;
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
  // Take screenshot and return as image/png (raw buffer)
  try {
    const url = 'https://mazeracebingo-1.onrender.com/'; // Updated to Render frontend URL
    const browser = await getBrowser();
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
    res.send(screenshot);
  } catch (err) {
    res.status(500).json({ error: 'Screenshot failed', details: err.message });
  }
});

// Real browser screenshot endpoint
app.get('/api/current', async (req, res) => {
  const url = 'https://mazeracebingo-1.onrender.com/'; // Change this to your app's local URL/port if different
  let browser;
  try {
    browser = await getBrowser();
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
    res.set('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (err) {
    res.status(500).json({ error: 'Failed to capture screenshot', details: err.message });
  } finally {
    if (browser) await browser.close();
  }
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
app.post('/api/create', async (req, res) => {
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
      // Take screenshot and return as image/png (raw buffer)
      try {
        const url = 'https://mazeracebingo-1.onrender.com/';
        const browser = await getBrowser();
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
        return res.send(screenshot);
      } catch (err) {
        return res.status(500).json({ error: 'Screenshot failed', details: err.message });
      }
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
app.post('/api/tiles/uncomplete/:id', async (req, res) => {
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
  // Take screenshot and return as image/png (raw buffer)
  try {
    const url = 'https://mazeracebingo-1.onrender.com/'; // Adjust as needed
    const browser = await getBrowser();
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
    res.send(screenshot);
  } catch (err) {
    res.status(500).json({ error: 'Screenshot failed', details: err.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

const getBrowser = async () => {
  return await chromium.launch({ args: ['--no-sandbox'] });
};
