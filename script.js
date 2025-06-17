document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('grid');
    const size = 9;
    let tiles = [];
    let mazeWalls = [];
    let boobytrapPositions = [];

    // Generate a maze with a single path from start to end, then add dead-ends so all tiles are accessible
    function generateMazeWalls() {
        const walls = [];
        const visited = Array.from({ length: size }, () => Array(size).fill(false));
        const path = [];
        const start = { row: size - 1, col: Math.floor(size / 2) };
        const end = { row: 0, col: Math.floor(size / 2) };

        function shuffle(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
        }

        // DFS to create the main path
        function dfs(row, col) {
            if (row === end.row && col === end.col) {
                path.push({ row, col });
                return true;
            }
            visited[row][col] = true;
            path.push({ row, col });
            const dirs = [
                { dr: -1, dc: 0 },
                { dr: 0, dc: 1 },
                { dr: 1, dc: 0 },
                { dr: 0, dc: -1 }
            ];
            shuffle(dirs);
            for (const { dr, dc } of dirs) {
                const nr = row + dr, nc = col + dc;
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && !visited[nr][nc]) {
                    if (dfs(nr, nc)) return true;
                }
            }
            path.pop();
            return false;
        }
        dfs(start.row, start.col);

        // By default, all walls are present
        const maze = Array.from({ length: size }, (_, row) =>
            Array.from({ length: size }, (_, col) => ({
                top: true,
                right: true,
                bottom: true,
                left: true
            }))
        );

        // Remove walls along the main path
        for (let i = 1; i < path.length; i++) {
            const prev = path[i - 1];
            const curr = path[i];
            if (curr.row === prev.row - 1 && curr.col === prev.col) {
                maze[prev.row][prev.col].top = false;
                maze[curr.row][curr.col].bottom = false;
            } else if (curr.row === prev.row + 1 && curr.col === prev.col) {
                maze[prev.row][prev.col].bottom = false;
                maze[curr.row][curr.col].top = false;
            } else if (curr.col === prev.col - 1 && curr.row === prev.row) {
                maze[prev.row][prev.col].left = false;
                maze[curr.row][curr.col].right = false;
            } else if (curr.col === prev.col + 1 && curr.row === prev.row) {
                maze[prev.row][prev.col].right = false;
                maze[curr.row][curr.col].left = false;
            }
        }

        // Now, carve dead-ends so every tile is accessible
        // Use a randomized DFS from every unvisited cell to connect it to the maze
        const cellVisited = Array.from({ length: size }, () => Array(size).fill(false));
        // Mark main path as visited
        for (const { row, col } of path) cellVisited[row][col] = true;

        function connectToMaze(row, col) {
            // Connect this cell to a random neighbor that is already in the maze
            const neighbors = [];
            if (row > 0 && cellVisited[row - 1][col]) neighbors.push({ nr: row - 1, nc: col, wall: 'top', oppWall: 'bottom' });
            if (row < size - 1 && cellVisited[row + 1][col]) neighbors.push({ nr: row + 1, nc: col, wall: 'bottom', oppWall: 'top' });
            if (col > 0 && cellVisited[row][col - 1]) neighbors.push({ nr: row, nc: col - 1, wall: 'left', oppWall: 'right' });
            if (col < size - 1 && cellVisited[row][col + 1]) neighbors.push({ nr: row, nc: col + 1, wall: 'right', oppWall: 'left' });
            if (neighbors.length > 0) {
                const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
                maze[row][col][pick.wall] = false;
                maze[pick.nr][pick.nc][pick.oppWall] = false;
                cellVisited[row][col] = true;
                return true;
            }
            return false;
        }

        function carveDeadEnds(row, col) {
            cellVisited[row][col] = true;
            const dirs = [
                { dr: -1, dc: 0, wall: 'top', oppWall: 'bottom' },
                { dr: 0, dc: 1, wall: 'right', oppWall: 'left' },
                { dr: 1, dc: 0, wall: 'bottom', oppWall: 'top' },
                { dr: 0, dc: -1, wall: 'left', oppWall: 'right' }
            ];
            shuffle(dirs);
            for (const { dr, dc, wall, oppWall } of dirs) {
                const nr = row + dr, nc = col + dc;
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && !cellVisited[nr][nc]) {
                    // Remove wall between (row,col) and (nr,nc)
                    maze[row][col][wall] = false;
                    maze[nr][nc][oppWall] = false;
                    carveDeadEnds(nr, nc);
                }
            }
        }
        // Ensure every cell is connected to the maze
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (!cellVisited[row][col]) {
                    // Try to connect just once to avoid infinite loop
                    connectToMaze(row, col);
                    carveDeadEnds(row, col);
                }
            }
        }

        // Ensure first tile (start) has no walls
        maze[start.row][start.col].top = false;
        maze[start.row][start.col].right = false;
        maze[start.row][start.col].bottom = false;
        maze[start.row][start.col].left = false;

        // Ensure start tile's neighbors have no wall facing the start tile
        const startNeighbors = [
            { dr: -1, dc: 0, wall: 'bottom', oppWall: 'top' }, // above
            { dr: 1, dc: 0, wall: 'top', oppWall: 'bottom' },   // below
            { dr: 0, dc: -1, wall: 'right', oppWall: 'left' },  // left
            { dr: 0, dc: 1, wall: 'left', oppWall: 'right' }    // right
        ];
        for (const { dr, dc, wall, oppWall } of startNeighbors) {
            const nr = start.row + dr, nc = start.col + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                maze[nr][nc][wall] = false;
            }
        }

        // Ensure end tile has 3 walls (only one open direction)
        if (path.length > 1) {
            const beforeEnd = path[path.length - 2];
            // Set all walls to true (closed)
            maze[end.row][end.col].top = true;
            maze[end.row][end.col].right = true;
            maze[end.row][end.col].bottom = true;
            maze[end.row][end.col].left = true;
            // Open only the wall that connects to the previous tile in the path
            if (beforeEnd.row === end.row - 1 && beforeEnd.col === end.col) {
                maze[end.row][end.col].top = false;
                maze[end.row - 1][end.col].bottom = false;
            } else if (beforeEnd.row === end.row + 1 && beforeEnd.col === end.col) {
                maze[end.row][end.col].bottom = false;
                maze[end.row + 1][end.col].top = false;
            } else if (beforeEnd.col === end.col - 1 && beforeEnd.row === end.row) {
                maze[end.row][end.col].left = false;
                maze[end.row][end.col - 1].right = false;
            } else if (beforeEnd.col === end.col + 1 && beforeEnd.row === end.row) {
                maze[end.row][end.col].right = false;
                maze[end.row][end.col + 1].left = false;
            }
        }

        // Convert to wall objects for rendering (must be after end tile wall fix)
        walls.length = 0; // Clear walls array before filling
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const cell = maze[row][col];
                if (cell.top || cell.right || cell.bottom || cell.left) {
                    walls.push({ row, col, walls: { ...cell } });
                }
            }
        }
        // Always add the end tile to walls for logic, but hide its walls visually until revealed
        walls.push({ row: end.row, col: end.col, walls: { ...maze[end.row][end.col] }, isEnd: true });

        return walls;
    }

    // Reveal a tile and its walls
    function revealTile(index) {
        const tile = tiles[index];
        if (tile && tile.dataset.visible === 'false') {
            // Label start and end tiles
            const { row, col } = getRowCol(index);
            const startRow = size - 1, startCol = Math.floor(size / 2);
            const endRow = 0, endCol = Math.floor(size / 2);
            if (row === startRow && col === startCol) {
                tile.textContent = 'START';
                tile.style.background = 'pink'; // Make the start tile pink
                tile.style.color = '#000';
            } else if (row === endRow && col === endCol) {
                tile.textContent = 'END';
                tile.style.background = '#e53935'; // Red background for END
                tile.style.color = '#fff';
            } else {
                tile.textContent = Number(tile.dataset.number);
                tile.style.background = '';
                tile.style.color = '';
            }
            tile.dataset.visible = 'true';
            tile.classList.add('revealed');
            // Only show walls if tile is completed (clicked)
            updateTileWalls(tile, row, col);
        }
    }

    let fogRevealed = false;
    let revealedBeforeFog = [];

    function setFog(reveal) {
        if (reveal) {
            // Save which tiles were revealed before fog
            revealedBeforeFog = tiles.map(tile => tile.dataset.visible === 'true');
            // Reveal all tiles
            for (let i = 0; i < tiles.length; i++) {
                if (tiles[i].dataset.visible === 'false') {
                    revealTile(i);
                }
            }
            fogRevealed = true;
        } else {
            // Hide all tiles that were not revealed before fog
            for (let i = 0; i < tiles.length; i++) {
                if (!revealedBeforeFog[i]) {
                    hideTile(i);
                }
            }
            fogRevealed = false;
        }
        // Update wall visibility for all tiles after fog state changes
        for (let i = 0; i < tiles.length; i++) {
            const { row, col } = getRowCol(i);
            updateTileWalls(tiles[i], row, col);
        }
    }

    function createGrid() {
        grid.innerHTML = '';
        tiles = [];
        mazeWalls = generateMazeWalls();
        fogRevealed = false;
        revealedBeforeFog = [];
        for (let i = 0; i < size * size; i++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.textContent = '';
            tile.dataset.number = i + 1;
            tile.dataset.index = i;
            tile.dataset.visible = 'false';
            tiles.push(tile);
            grid.appendChild(tile);
        }
        // Start tile: last row, middle column
        const startRow = size - 1;
        const startCol = Math.floor(size / 2);
        const startIndex = getIndex(startRow, startCol);
        revealTile(startIndex);
        // End tile: first row, middle column
        const endRow = 0;
        const endCol = Math.floor(size / 2);
        const endIndex = getIndex(endRow, endCol);
        revealTile(endIndex);
        addTileListeners();
    }

    // Helper to get row/col from index
    function getRowCol(index) {
        return { row: Math.floor(index / size), col: index % size };
    }

    // Helper to get index from row/col
    function getIndex(row, col) {
        return row * size + col;
    }

    // Hide a tile
    function hideTile(index) {
        const tile = tiles[index];
        if (tile) {
            tile.textContent = '';
            tile.dataset.visible = 'false';
            tile.classList.remove('revealed', 'clicked');
        }
    }

    // Add overview panel (only once, and re-use on reset)
    function ensureOverviewPanel() {
        let overviewPanel = document.getElementById('overview-panel');
        if (!overviewPanel) {
            overviewPanel = document.createElement('div');
            overviewPanel.id = 'overview-panel';
            overviewPanel.style.marginRight = '20px';
            overviewPanel.style.marginBottom = '0';
            overviewPanel.style.background = '#f5f5f5';
            overviewPanel.style.padding = '10px';
            overviewPanel.style.borderRadius = '6px';
            overviewPanel.style.fontSize = '0.95em';
            overviewPanel.style.minHeight = '40px';
            overviewPanel.style.maxWidth = '350px';
            overviewPanel.style.wordBreak = 'break-word';
            // Move overview panel to the left of the maze
            const mainContainer = document.getElementById('main-container');
            if (mainContainer) {
                mainContainer.insertBefore(overviewPanel, mainContainer.firstChild);
            } else {
                // fallback: append to body if main-container not found
                document.body.insertBefore(overviewPanel, document.body.firstChild);
            }
        }
        return overviewPanel;
    }

    function updateOverviewPanel() {
        const overviewPanel = ensureOverviewPanel();
        // List all revealed but not completed tiles (not start/end)
        const revealedNotCompleted = tiles.filter(tile =>
            tile.dataset.visible === 'true' &&
            !tile.classList.contains('clicked') &&
            tile.textContent !== 'START' &&
            tile.textContent !== 'END'
        );
        if (revealedNotCompleted.length === 0) {
            overviewPanel.textContent = 'No revealed tiles';
        } else {
            overviewPanel.innerHTML = '<br />' +
                '<ul style="padding-left: 18px; margin: 8px 0 0 0;">' +
                revealedNotCompleted.map(tile => {
                    const desc = localStorage.getItem('tile_desc_' + tile.dataset.number) || '';
                    return `<li style="padding: 0; margin: 0; list-style: disc inside;">${tile.dataset.number}${desc ? ': <span style=\'color:#666;\'>"' + desc.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"</span>' : ''}</li>`;
                }).join('') +
                '</ul>';
        }
    }

    // Patch revealTile, hideTile, and addTileListeners only once
    let patchApplied = false;
    function patchOverviewFunctions() {
        if (patchApplied) return;
        patchApplied = true;
        const originalRevealTile = revealTile;
        revealTile = function(index) {
            originalRevealTile(index);
            updateOverviewPanel();
        };
        const originalHideTile = hideTile;
        hideTile = function(index) {
            originalHideTile(index);
            updateOverviewPanel();
        };
        const originalAddTileListeners = addTileListeners;
        addTileListeners = function() {
            originalAddTileListeners();
            tiles.forEach(tile => {
                tile.addEventListener('click', updateOverviewPanel);
            });
            updateOverviewPanel();
        };
    }
    patchOverviewFunctions();

    // Helper to update wall classes for a tile if completed
    function updateTileWalls(tile, row, col) {
        tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
        // Show walls if tile is completed (clicked) or fog is revealed
        if (tile.classList.contains('clicked') || fogRevealed) {
            const wall = mazeWalls.find(w => w.row === row && w.col === col);
            if (wall) {
                if (wall.walls.top) tile.classList.add('wall-top');
                if (wall.walls.right) tile.classList.add('wall-right');
                if (wall.walls.bottom) tile.classList.add('wall-bottom');
                if (wall.walls.left) tile.classList.add('wall-left');
            }
        }
    }

    // Add tile click listeners
    function addTileListeners() {
        tiles.forEach((tile, i) => {
            tile.onclick = () => {
                if (tile.dataset.visible === 'true' && !tile.classList.contains('clicked') && tile.textContent !== 'END') {
                    tile.classList.add('clicked');
                    // Show boobytrap only when completed
                    const pos = getRowCol(i);
                    if (boobytrapPositions && boobytrapPositions.some(b => b.row === pos.row && b.col === pos.col)) {
                        tile.classList.add('boobytrap');
                    }
                    // If surrounded by 3 walls (dead end), add deadend class
                    const { row, col } = pos;
                    const wallObj = mazeWalls.find(w => w.row === row && w.col === col);
                    updateTileWalls(tile, row, col);
                    tile.classList.remove('deadend');
                    if (wallObj) {
                        const wallCount = ['top','right','bottom','left'].reduce((acc, dir) => acc + (wallObj.walls[dir] ? 1 : 0), 0);
                        if (wallCount === 3) {
                            tile.classList.add('deadend');
                        }
                    }
                    // Reveal neighbors when any tile is completed, but only if no wall between (or always for START tile)
                    const neighbors = [
                        { dr: -1, dc: 0, wall: 'top' },    // up
                        { dr: 1, dc: 0, wall: 'bottom' },  // down
                        { dr: 0, dc: -1, wall: 'left' },   // left
                        { dr: 0, dc: 1, wall: 'right' }    // right
                    ];
                    neighbors.forEach(({ dr, dc, wall: wallDir }) => {
                        const nr = row + dr, nc = col + dc;
                        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                            if (tile.textContent === 'START' || (wallObj && wallObj.walls[wallDir] === false)) {
                                const neighborIndex = getIndex(nr, nc);
                                revealTile(neighborIndex);
                            }
                        }
                    });
                    updateOverviewPanel();
                } else if (
                    tile.dataset.visible === 'true' &&
                    tile.classList.contains('clicked') &&
                    tile.textContent !== 'START' &&
                    tile.textContent !== 'END'
                ) {
                    // Uncomplete the tile
                    tile.classList.remove('clicked');
                    // Hide any tiles that were revealed as a result of completing this tile,
                    // unless they are also revealed by another completed neighbor
                    const { row, col } = getRowCol(i);
                    const wallObj = mazeWalls.find(w => w.row === row && w.col === col);
                    const isStart = tile.textContent === 'START';
                    const neighbors = [
                        { dr: -1, dc: 0, wall: 'top' },    // up
                        { dr: 1, dc: 0, wall: 'bottom' },  // down
                        { dr: 0, dc: -1, wall: 'left' },   // left
                        { dr: 0, dc: 1, wall: 'right' }    // right
                    ];
                    neighbors.forEach(({ dr, dc, wall }) => {
                        const nr = row + dr, nc = col + dc;
                        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                            if (isStart || (wallObj && wallObj.walls[wall] === false)) {
                                const neighborIndex = getIndex(nr, nc);
                                // Only hide if not revealed by another completed neighbor
                                let revealedByOther = false;
                                const neighborRow = nr, neighborCol = nc;
                                const neighborNeighbors = [
                                    { dr: -1, dc: 0, wall: 'top', oppWall: 'bottom' },
                                    { dr: 1, dc: 0, wall: 'bottom', oppWall: 'top' },
                                    { dr: 0, dc: -1, wall: 'left', oppWall: 'right' },
                                    { dr: 0, dc: 1, wall: 'right', oppWall: 'left' }
                                ];
                                for (const { dr: ndr, dc: ndc, wall: nwall, oppWall } of neighborNeighbors) {
                                    const adjRow = neighborRow + ndr, adjCol = neighborCol + ndc;
                                    if (adjRow >= 0 && adjRow < size && adjCol >= 0 && adjCol < size) {
                                        const adjIndex = getIndex(adjRow, adjCol);
                                        const adjTile = tiles[adjIndex];
                                        const adjWallObj = mazeWalls.find(w => w.row === adjRow && w.col === adjCol);
                                        if (
                                            adjTile &&
                                            adjTile.classList.contains('clicked') &&
                                            (adjTile.textContent === 'START' || (adjWallObj && adjWallObj.walls[oppWall] === false))
                                        ) {
                                            revealedByOther = true;
                                            break;
                                        }
                                    }
                                }
                                if (!revealedByOther && tiles[neighborIndex].textContent !== 'START' && tiles[neighborIndex].textContent !== 'END') {
                                    hideTile(neighborIndex);
                                }
                            }
                        }
                    });
                    updateOverviewPanel();
                }
            };
        });
    }

    // Tasks modal logic
    const tasksBtn = document.getElementById('tasks-btn');
    const tasksModal = document.getElementById('tasks-modal');
    const closeTasksModal = document.getElementById('close-tasks-modal');

    if (tasksBtn && tasksModal && closeTasksModal) {
        tasksBtn.onclick = function() {
            // Populate the tasks list with all tile numbers except START and END, each with a textbox for description
            const tasksList = document.getElementById('tasks-list');
            if (tasksList) {
                let html = '<ul style="padding-left: 0; margin: 8px 0 0 0;">';
                for (let i = 0; i < size * size; i++) {
                    if (i !== 4 && i !== 76) {
                        // Use localStorage to persist descriptions by tile number
                        const desc = localStorage.getItem('tile_desc_' + (i + 1)) || '';
                        html += `<li style="padding: 0 0 6px 0; margin: 0; list-style: none; display: flex; align-items: center;">
                            <span style='min-width: 48px; display: inline-block;'>Tile ${i + 1}</span>
                            <input type="text" data-tile="${i + 1}" value="${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" placeholder="Description..." style="flex:1; margin-left: 8px; padding: 2px 6px; font-size: 0.95em; border-radius: 4px; border: 1px solid #ccc;" />
                        </li>`;
                    }
                }
                html += '</ul>';
                tasksList.innerHTML = html;
                // Add event listeners to all textboxes to save to localStorage
                tasksList.querySelectorAll('input[type="text"]').forEach(input => {
                    input.addEventListener('input', function() {
                        localStorage.setItem('tile_desc_' + this.dataset.tile, this.value);
                    });
                });
            }
            tasksModal.style.display = 'block';
        };
        closeTasksModal.onclick = function() {
            tasksModal.style.display = 'none';
        };
        window.addEventListener('click', function(event) {
            if (event.target === tasksModal) {
                tasksModal.style.display = 'none';
            }
        });
    }

    // Draw modal logic
    const drawPopupBtn = document.getElementById('draw-popup-btn');
    const drawModal = document.getElementById('draw-modal');
    const closeDrawModal = document.getElementById('close-draw-modal');
    const drawGrid = document.getElementById('draw-grid');
    let drawTiles = [];
    let drawSelected = null;

    function openDrawModal() {
        // Clear previous grid
        drawGrid.innerHTML = '';
        drawTiles = [];
        drawSelected = null;
        // Generate a new maze with all tiles revealed and all walls present
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const tile = document.createElement('div');
                tile.className = 'tile revealed wall-top wall-right wall-bottom wall-left';
                tile.dataset.row = row;
                tile.dataset.col = col;
                // Label start/end
                if (row === size - 1 && col === Math.floor(size / 2)) {
                    tile.textContent = 'START';
                    tile.style.background = 'pink';
                    tile.style.color = '#000';
                } else if (row === 0 && col === Math.floor(size / 2)) {
                    tile.textContent = 'END';
                    tile.style.background = '#e53935';
                    tile.style.color = '#fff';
                } else {
                    tile.textContent = row * size + col + 1;
                }
                tile.onclick = () => handleDrawTileClick(tile, row, col);
                tile.oncontextmenu = (e) => handleDrawTileRightClick(e, tile);
                drawTiles.push(tile);
                drawGrid.appendChild(tile);
            }
        }
        drawModal.style.display = 'block';
    }

    function handleDrawTileClick(tile, row, col) {
        if (drawSelected === null) {
            drawSelected = { tile, row, col };
            tile.style.outline = '2px solid orange';
        } else {
            drawSelected.tile.style.outline = '';
            // Check adjacency
            const dr = row - drawSelected.row;
            const dc = col - drawSelected.col;
            let wall1, wall2;
            if (dr === 1 && dc === 0) { wall1 = 'bottom'; wall2 = 'top'; }
            else if (dr === -1 && dc === 0) { wall1 = 'top'; wall2 = 'bottom'; }
            else if (dr === 0 && dc === 1) { wall1 = 'right'; wall2 = 'left'; }
            else if (dr === 0 && dc === -1) { wall1 = 'left'; wall2 = 'right'; }
            if (wall1 && wall2) {
                // Toggle wall: if present, remove; if absent, add
                const hasWall1 = drawSelected.tile.classList.contains('wall-' + wall1);
                const hasWall2 = tile.classList.contains('wall-' + wall2);
                if (hasWall1 && hasWall2) {
                    drawSelected.tile.classList.remove('wall-' + wall1);
                    tile.classList.remove('wall-' + wall2);
                } else {
                    drawSelected.tile.classList.add('wall-' + wall1);
                    tile.classList.add('wall-' + wall2);
                }
            }
            drawSelected = null;
        }
    }

    function handleDrawTileRightClick(e, tile) {
        e.preventDefault();
        tile.classList.toggle('boobytrap');
        // If traps modal is open, refresh its content
        const drawTrapsModal = document.getElementById('draw-traps-modal');
        if (drawTrapsModal && drawTrapsModal.style.display === 'block') {
            renderDrawTrapsList();
        }
    }

    if (drawPopupBtn) drawPopupBtn.onclick = openDrawModal;
    if (closeDrawModal) closeDrawModal.onclick = () => { drawModal.style.display = 'none'; };
    window.addEventListener('click', function(event) {
        if (event.target === drawModal) drawModal.style.display = 'none';
    });

    // Save draw-popup layout and tasklist
    document.getElementById('draw-save-btn').onclick = () => {
        // Gather wall layout and boobytraps from drawTiles
        const drawMazeWalls = [];
        const boobytraps = [];
        for (let i = 0; i < drawTiles.length; i++) {
            const tile = drawTiles[i];
            const row = parseInt(tile.dataset.row);
            const col = parseInt(tile.dataset.col);
            const walls = {
                top: tile.classList.contains('wall-top'),
                right: tile.classList.contains('wall-right'),
                bottom: tile.classList.contains('wall-bottom'),
                left: tile.classList.contains('wall-left')
            };
            drawMazeWalls.push({ row, col, walls });
            if (tile.classList.contains('boobytrap')) {
                boobytraps.push({ row, col });
            }
        }
        // Gather all tile descriptions (except START and END)
        const tileDescriptions = {};
        for (let i = 0; i < size * size; i++) {
            if (i !== 4 && i !== 76) {
                tileDescriptions[i + 1] = localStorage.getItem('tile_desc_' + (i + 1)) || '';
            }
        }
        // Gather all trap descriptions for boobytraps
        const trapDescriptions = {};
        for (let i = 0; i < drawTiles.length; i++) {
            const tile = drawTiles[i];
            if (tile.classList.contains('boobytrap')) {
                trapDescriptions[(i + 1)] = localStorage.getItem('draw_trap_desc_' + (i + 1)) || '';
            }
        }
        const data = JSON.stringify({ mazeWalls: drawMazeWalls, tileDescriptions, boobytraps, trapDescriptions }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'draw-maze.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    };

    // Draw Load button functionality
    document.getElementById('draw-load-btn').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.txt,application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => {
                try {
                    const loaded = JSON.parse(evt.target.result);
                    // Load mazeWalls
                    if (loaded && Array.isArray(loaded.mazeWalls)) {
                        // Clear previous draw grid
                        drawGrid.innerHTML = '';
                        drawTiles = [];
                        drawSelected = null;
                        // Rebuild draw grid from loaded mazeWalls
                        for (let row = 0; row < size; row++) {
                            for (let col = 0; col < size; col++) {
                                const tile = document.createElement('div');
                                tile.className = 'tile revealed';
                                tile.dataset.row = row;
                                tile.dataset.col = col;
                                // Label start/end
                                if (row === size - 1 && col === Math.floor(size / 2)) {
                                    tile.textContent = 'START';
                                    tile.style.background = 'pink';
                                    tile.style.color = '#000';
                                } else if (row === 0 && col === Math.floor(size / 2)) {
                                    tile.textContent = 'END';
                                    tile.style.background = '#e53935';
                                    tile.style.color = '#fff';
                                } else {
                                    tile.textContent = row * size + col + 1;
                                }
                                // Set walls
                                const wallObj = loaded.mazeWalls.find(w => w.row === row && w.col === col);
                                if (wallObj) {
                                    if (wallObj.walls.top) tile.classList.add('wall-top');
                                    if (wallObj.walls.right) tile.classList.add('wall-right');
                                    if (wallObj.walls.bottom) tile.classList.add('wall-bottom');
                                    if (wallObj.walls.left) tile.classList.add('wall-left');
                                }
                                tile.onclick = () => handleDrawTileClick(tile, row, col);
                                tile.oncontextmenu = (e) => handleDrawTileRightClick(e, tile);
                                drawTiles.push(tile);
                                drawGrid.appendChild(tile);
                            }
                        }
                        // Restore boobytraps
                        if (loaded.boobytraps && Array.isArray(loaded.boobytraps)) {
                            for (const b of loaded.boobytraps) {
                                const i = b.row * size + b.col;
                                if (drawTiles[i]) drawTiles[i].classList.add('boobytrap');
                            }
                        }
                        // Restore draw-mode task descriptions
                        if (loaded.tileDescriptions && typeof loaded.tileDescriptions === 'object') {
                            for (const [key, value] of Object.entries(loaded.tileDescriptions)) {
                                localStorage.setItem('draw_tile_desc_' + key, value);
                            }
                        }
                        // Restore trap descriptions
                        if (loaded.trapDescriptions && typeof loaded.trapDescriptions === 'object') {
                            for (const [key, value] of Object.entries(loaded.trapDescriptions)) {
                                localStorage.setItem('draw_trap_desc_' + key, value);
                            }
                        }
                    } else {
                        alert('Invalid draw-maze file.');
                        return;
                    }
                } catch (err) {
                    alert('Failed to load draw-maze: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // Initial grid
    createGrid();
    // Initial overview
    updateOverviewPanel();

    // Reset button
    document.getElementById('reset-btn').onclick = () => {
        createGrid();
    };

    // Fog button
    document.getElementById('fog-btn').onclick = () => {
        setFog(!fogRevealed);
    };

    // Save mazeWalls and tile descriptions to file
    document.getElementById('save-btn').onclick = () => {
        // Gather all tile descriptions (except START and END)
        const tileDescriptions = {};
        for (let i = 0; i < size * size; i++) {
            if (i !== 4 && i !== 76) {
                tileDescriptions[i + 1] = localStorage.getItem('tile_desc_' + (i + 1)) || '';
            }
        }
        const data = JSON.stringify({ mazeWalls, tileDescriptions }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'maze.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    };

    // Load mazeWalls and tile descriptions from file
    document.getElementById('load-btn').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.txt,application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => {
                try {
                    const loaded = JSON.parse(evt.target.result);
                    if (Array.isArray(loaded)) {
                        // Backward compatibility: just mazeWalls
                        mazeWalls = loaded;
                    } else if (loaded && Array.isArray(loaded.mazeWalls)) {
                        mazeWalls = loaded.mazeWalls;
                        // Restore tile descriptions
                        if (loaded.tileDescriptions && typeof loaded.tileDescriptions === 'object') {
                            for (const [key, value] of Object.entries(loaded.tileDescriptions)) {
                                localStorage.setItem('tile_desc_' + key, value);
                            }
                        }
                    } else {
                        alert('Invalid maze file.');
                        return;
                    }
                    // Re-render grid with loaded mazeWalls
                    grid.innerHTML = '';
                    tiles = [];
                    fogRevealed = false;
                    revealedBeforeFog = [];
                    // Prepare boobytrap lookup if present
                    boobytrapPositions = [];
                    let boobytrapSet = new Set();
                    if (loaded.boobytraps && Array.isArray(loaded.boobytraps)) {
                        for (const b of loaded.boobytraps) {
                            boobytrapSet.add(`${b.row},${b.col}`);
                            boobytrapPositions.push({row: b.row, col: b.col});
                        }
                    }
                    for (let i = 0; i < size * size; i++) {
                        const tile = document.createElement('div');
                        tile.className = 'tile';
                        tile.textContent = '';
                        tile.dataset.number = i + 1;
                        tile.dataset.index = i;
                        tile.dataset.visible = 'false';
                        // Do NOT add boobytrap class here
                        tiles.push(tile);
                        grid.appendChild(tile);
                    }
                    // Start tile: last row, middle column
                    const startRow = size - 1;
                    const startCol = Math.floor(size / 2);
                    const startIndex = getIndex(startRow, startCol);
                    revealTile(startIndex);
                    // End tile: first row, middle column
                    const endRow = 0;
                    const endCol = Math.floor(size / 2);
                    const endIndex = getIndex(endRow, endCol);
                    revealTile(endIndex);
                    addTileListeners();
                    // If Tasks modal is open, refresh its content to show loaded descriptions
                    const tasksList = document.getElementById('tasks-list');
                    if (tasksModal && tasksModal.style.display === 'block' && tasksList) {
                        tasksBtn.onclick();
                    }
                } catch (err) {
                    alert('Failed to load maze: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // Draw Tasks modal logic
    const drawTasksBtn = document.getElementById('draw-tasks-btn');
    const drawTasksModal = document.getElementById('draw-tasks-modal');
    const closeDrawTasksModal = document.getElementById('close-draw-tasks-modal');

    if (drawTasksBtn && drawTasksModal && closeDrawTasksModal) {
        drawTasksBtn.onclick = function() {
            // Populate the tasks list for draw mode (no START/END)
            const drawTasksList = document.getElementById('draw-tasks-list');
            if (drawTasksList) {
                let html = '<ul style="padding-left: 0; margin: 8px 0 0 0;">';
                for (let i = 0; i < size * size; i++) {
                    if (i !== 4 && i !== 76) {
                        // Default to real maze's task if none set for draw mode
                        let desc = localStorage.getItem('draw_tile_desc_' + (i + 1));
                        if (desc === null || desc === undefined) {
                            desc = localStorage.getItem('tile_desc_' + (i + 1)) || '';
                        }
                        html += `<li style="padding: 0 0 6px 0; margin: 0; list-style: none; display: flex; align-items: center;">
                            <span style='min-width: 48px; display: inline-block;'>Tile ${i + 1}</span>
                            <input type="text" data-tile="${i + 1}" value="${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" placeholder="Description..." style="flex:1; margin-left: 8px; padding: 2px 6px; font-size: 0.95em; border-radius: 4px; border: 1px solid #ccc;" />
                        </li>`;
                    }
                }
                html += '</ul>';
                drawTasksList.innerHTML = html;
                // Add event listeners to all textboxes to save to localStorage
                drawTasksList.querySelectorAll('input[type="text"]').forEach(input => {
                    input.addEventListener('input', function() {
                        localStorage.setItem('draw_tile_desc_' + this.dataset.tile, this.value);
                    });
                });
            }
            drawTasksModal.style.display = 'block';
        };
        closeDrawTasksModal.onclick = function() {
            drawTasksModal.style.display = 'none';
        };
        window.addEventListener('click', function(event) {
            if (event.target === drawTasksModal) {
                drawTasksModal.style.display = 'none';
            }
        });
    }

    // Draw Traps modal logic
    const drawTrapsBtn = document.getElementById('draw-traps-btn');
    const drawTrapsModal = document.getElementById('draw-traps-modal');
    const closeDrawTrapsModal = document.getElementById('close-draw-traps-modal');

    function renderDrawTrapsList() {
        const drawTrapsList = document.getElementById('draw-traps-list');
        if (drawTrapsList) {
            // Find all boobytrap tiles in draw mode
            let boobytraps = [];
            for (let i = 0; i < drawTiles.length; i++) {
                const tile = drawTiles[i];
                if (tile.classList.contains('boobytrap')) {
                    boobytraps.push(i);
                }
            }
            let html = '<ul style="padding-left: 0; margin: 8px 0 0 0;">';
            for (const i of boobytraps) {
                const desc = localStorage.getItem('draw_trap_desc_' + (i + 1)) || '';
                html += `<li style="padding: 0 0 6px 0; margin: 0; list-style: none; display: flex; align-items: center;">
                    <span style='min-width: 48px; display: inline-block;'>Tile ${i + 1}</span>
                    <input type="text" data-tile="${i + 1}" value="${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" placeholder="Trap description..." style="flex:1; margin-left: 8px; padding: 2px 6px; font-size: 0.95em; border-radius: 4px; border: 1px solid #ccc;" />
                </li>`;
            }
            html += '</ul>';
            drawTrapsList.innerHTML = html;
            // Add event listeners to all textboxes to save to localStorage
            drawTrapsList.querySelectorAll('input[type="text"]').forEach(input => {
                input.addEventListener('input', function() {
                    localStorage.setItem('draw_trap_desc_' + this.dataset.tile, this.value);
                });
            });
        }
    }

    if (drawTrapsBtn && drawTrapsModal && closeDrawTrapsModal) {
        drawTrapsBtn.onclick = function() {
            renderDrawTrapsList();
            drawTrapsModal.style.display = 'block';
        };
        closeDrawTrapsModal.onclick = function() {
            drawTrapsModal.style.display = 'none';
        };
        window.addEventListener('click', function(event) {
            if (event.target === drawTrapsModal) {
                drawTrapsModal.style.display = 'none';
            }
        });
    }

    // Real Maze Traps modal logic
    const trapsBtn = document.getElementById('traps-btn');
    const trapsModal = document.getElementById('traps-modal');
    const closeTrapsModal = document.getElementById('close-traps-modal');

    if (trapsBtn && trapsModal && closeTrapsModal) {
        trapsBtn.onclick = function() {
            // Show all tiles with a boobytrap in the real maze
            const trapsList = document.getElementById('traps-list');
            if (trapsList) {
                let boobytraps = [];
                for (let i = 0; i < tiles.length; i++) {
                    const row = Math.floor(i / size);
                    const col = i % size;
                    if (boobytrapPositions && boobytrapPositions.some(b => b.row === row && b.col === col)) {
                        boobytraps.push(i);
                    }
                }
                let html = '<ul style="padding-left: 0; margin: 8px 0 0 0;">';
                for (const i of boobytraps) {
                    const desc = localStorage.getItem('trap_desc_' + (i + 1)) || '';
                    html += `<li style="padding: 0 0 6px 0; margin: 0; list-style: none; display: flex; align-items: center;">
                        <span style='min-width: 48px; display: inline-block;'>Tile ${i + 1}</span>
                        <input type="text" data-tile="${i + 1}" value="${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" placeholder="Trap description..." style="flex:1; margin-left: 8px; padding: 2px 6px; font-size: 0.95em; border-radius: 4px; border: 1px solid #ccc;" />
                    </li>`;
                }
                html += '</ul>';
                trapsList.innerHTML = html;
                // Add event listeners to all textboxes to save to localStorage
                trapsList.querySelectorAll('input[type="text"]').forEach(input => {
                    input.addEventListener('input', function() {
                        localStorage.setItem('trap_desc_' + this.dataset.tile, this.value);
                    });
                });
            }
            trapsModal.style.display = 'block';
        };
        closeTrapsModal.onclick = function() {
            trapsModal.style.display = 'none';
        };
        window.addEventListener('click', function(event) {
            if (event.target === trapsModal) {
                trapsModal.style.display = 'none';
            }
        });
    }
});
