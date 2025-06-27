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
        saveMazeToDb(team);
        if (callback) callback();
        return Promise.reject('DB is empty for this team');
      }
    })
    .then(rows => {
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
  // Delete and insert all for this team
  dbQuery('DELETE FROM tiles WHERE team = ?', [team])
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

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maze Bingo API running on port ${PORT}`);
});
