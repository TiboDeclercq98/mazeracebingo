document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('grid');
    let tiles = [];

    // --- API-DRIVEN MAZE RENDERING ---
    async function fetchMazeState() {
        const res = await fetch('https://mazeracebingo.onrender.com/api/maze');
        return await res.json();
    }

    // Helper to get adjacent tile indices
    function getAdjacentIndices(index, size) {
        const row = Math.floor(index / size);
        const col = index % size;
        const adj = [];
        if (row > 0) adj.push((row - 1) * size + col); // up
        if (row < size - 1) adj.push((row + 1) * size + col); // down
        if (col > 0) adj.push(row * size + (col - 1)); // left
        if (col < size - 1) adj.push(row * size + (col + 1)); // right
        return adj;
    }

    async function renderMazeFromAPI() {
        const state = await fetchMazeState();
        grid.innerHTML = '';
        tiles = [];
        const revealed = new Set();
        const completed = new Set();
        state.tiles.forEach((t, i) => { if (t.completed) completed.add(i); });
        const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
        const endIdx = Math.floor(state.size / 2);
        // Reveal START and END
        revealed.add(startIdx);
        revealed.add(endIdx);
        // Helper to get wall object
        function getWallObj(idx) {
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            return state.walls.find(w => w.row === row && w.col === col);
        }
        // Reveal adjacent to completed, only if no wall between
        completed.forEach(idx => {
            // Do not add completed tile itself to revealed set for overview
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            const wallObj = getWallObj(idx);
            // Up
            if (row > 0) {
                const nIdx = (row - 1) * state.size + col;
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.top) &&
                    (!nWallObj || !nWallObj.walls.bottom) &&
                    !state.tiles[nIdx].completed
                ) {
                    revealed.add(nIdx);
                }
            }
            // Down
            if (row < state.size - 1) {
                const nIdx = (row + 1) * state.size + col;
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.bottom) &&
                    (!nWallObj || !nWallObj.walls.top) &&
                    !state.tiles[nIdx].completed
                ) {
                    revealed.add(nIdx);
                }
            }
            // Left
            if (col > 0) {
                const nIdx = row * size + (col - 1);
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.left) &&
                    (!nWallObj || !nWallObj.walls.right) &&
                    !state.tiles[nIdx].completed
                ) {
                    revealed.add(nIdx);
                }
            }
            // Right
            if (col < state.size - 1) {
                const nIdx = row * size + (col + 1);
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.right) &&
                    (!nWallObj || !nWallObj.walls.left) &&
                    !state.tiles[nIdx].completed
                ) {
                    revealed.add(nIdx);
                }
            }
        });
        for (let i = 0; i < state.tiles.length; i++) {
            const tileData = state.tiles[i];
            const row = Math.floor(i / state.size);
            const col = i % state.size;
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.number = tileData.id;
            tile.dataset.index = i;
            // START/END
            if (i === startIdx) {
                tile.textContent = 'START';
                if (tileData.completed) {
                    tile.style.background = '#4caf50'; // green
                    tile.style.color = '#fff';
                } else {
                    tile.style.background = 'pink';
                    tile.style.color = '#000';
                }
                tile.dataset.visible = 'true';
                // Do not add 'revealed' or wall classes
            } else if (i === endIdx) {
                tile.textContent = 'END';
                tile.style.background = '#e53935';
                tile.style.color = '#fff';
                tile.dataset.visible = 'true';
                // Do not add 'revealed' or wall classes
            } else if (tileData.completed) {
                tile.textContent = tileData.id;
                tile.classList.add('clicked', 'revealed');
                tile.style.background = '';
                tile.style.color = '';
                tile.dataset.visible = 'true';
                // Always remove wall classes first
                tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
                tile.classList.remove('deadend'); // Remove before re-adding if needed
                // Add wall classes for completed tiles only
                const wallObj = state.walls.find(w => w.row === row && w.col === col);
                if (wallObj) {
                    if (wallObj.walls.top) tile.classList.add('wall-top');
                    if (wallObj.walls.right) tile.classList.add('wall-right');
                    if (wallObj.walls.bottom) tile.classList.add('wall-bottom');
                    if (wallObj.walls.left) tile.classList.add('wall-left');
                }
                // --- DEAD-END DETECTION ---
                // A dead-end is a completed tile (not START/END) surrounded by 3 walls
                if (i !== startIdx && i !== endIdx && wallObj) {
                    const wallCount = ['top', 'right', 'bottom', 'left'].reduce((count, dir) => count + (wallObj.walls[dir] ? 1 : 0), 0);
                    if (wallCount === 3) {
                        tile.classList.add('deadend');
                    }
                }
                // --- END DEAD-END DETECTION ---
            } else if (revealed.has(i)) {
                tile.textContent = tileData.id;
                tile.classList.add('revealed');
                tile.dataset.visible = 'true';
                // Remove wall classes for revealed but not completed
                tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
            } else {
                tile.textContent = '';
                tile.classList.remove('clicked', 'revealed');
                tile.dataset.visible = 'false';
                tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
            }
            // Boobytrap: only show if completed
            if (state.boobytraps && state.boobytraps.some(b => b.row === row && b.col === col) && tileData.completed) {
                tile.classList.add('boobytrap');
            } else {
                tile.classList.remove('boobytrap');
            }
            // Always remove wall classes first
            tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
            // Walls: only show if completed or START/END
            if (tileData.completed || i === startIdx || i === endIdx) {
                const wallObj = state.walls.find(w => w.row === row && w.col === col);
                if (wallObj) {
                    if (wallObj.walls.top) tile.classList.add('wall-top');
                    if (wallObj.walls.right) tile.classList.add('wall-right');
                    if (wallObj.walls.bottom) tile.classList.add('wall-bottom');
                    if (wallObj.walls.left) tile.classList.add('wall-left');
                }
            }
            tile.onclick = async () => {
                if (tile.dataset.visible === 'true' && !tile.classList.contains('clicked') && tile.textContent !== 'END') {
                    const tileId = parseInt(tile.dataset.number, 10);
                    await fetch(`https://mazeracebingo-1.onrender.com/api/tiles/complete/${tileId}`, { method: 'POST' });
                    await renderMazeFromAPI();
                }
            };
            tiles.push(tile);
            grid.appendChild(tile);
        }

        // --- REWORKED OVERVIEW PANEL LOGIC ---
        // Find all revealed but uncompleted tiles (excluding START/END)
        const revealedUncompleted = new Set();
        for (let idx = 0; idx < state.tiles.length; idx++) {
            if (idx === startIdx || idx === endIdx) continue;
            const tile = state.tiles[idx];
            if (tile.completed) continue;
            // A tile is revealed if it is adjacent to a completed tile and not blocked by a wall
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            const directions = [
                { dr: -1, dc: 0, wall: 'top', neighborWall: 'bottom' },
                { dr: 1, dc: 0, wall: 'bottom', neighborWall: 'top' },
                { dr: 0, dc: -1, wall: 'left', neighborWall: 'right' },
                { dr: 0, dc: 1, wall: 'right', neighborWall: 'left' }
            ];
            for (const { dr, dc, wall, neighborWall } of directions) {
                const nr = row + dr;
                const nc = col + dc;
                if (nr < 0 || nr >= state.size || nc < 0 || nc >= state.size) continue;
                const neighborIdx = nr * state.size + nc;
                if (neighborIdx === startIdx || neighborIdx === endIdx) continue;
                const neighbor = state.tiles[neighborIdx];
                if (!neighbor.completed) continue;
                // Check for walls
                const wallObj = state.walls.find(w => w.row === row && w.col === col);
                const neighborWallObj = state.walls.find(w => w.row === nr && w.col === nc);
                if ((wallObj && wallObj.walls[wall]) || (neighborWallObj && neighborWallObj.walls[neighborWall])) continue;
                revealedUncompleted.add(idx);
                break;
            }
        }
        // Render overview panel
        const overviewPanel = document.getElementById('overview-panel');
        if (overviewPanel) {
            const tileDescs = state.tileDescriptions || {};
            const revealedTiles = Array.from(revealedUncompleted).sort((a, b) => a - b);
            overviewPanel.innerHTML = '<b>Revealed Tiles:</b><ul style="padding-left:18px">' +
                revealedTiles.map(idx => {
                    const t = state.tiles[idx];
                    const desc = tileDescs[t.id] || `Tile ${t.id}`;
                    return `<li>Tile ${t.id}: ${desc}</li>`;
                }).join('') + '</ul>';
        }
    }

    // --- TASK LIST MODAL ---
    const tasksBtn = document.getElementById('tasks-btn');
    const tasksModal = document.getElementById('tasks-modal');
    const closeTasksModal = document.getElementById('close-tasks-modal');
    const tasksList = document.getElementById('tasks-list');

    tasksBtn.addEventListener('click', async () => {
        tasksModal.style.display = 'block';
        tasksList.innerHTML = '<em>Loading...</em>';
        try {
            // Fetch maze state to get all tile ids and descriptions
            const state = await fetchMazeState();
            const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
            const endIdx = Math.floor(state.size / 2);
            const tileDescs = state.tileDescriptions || {};
            let html = '<ul style="list-style:none;padding-left:0">';
            state.tiles.forEach((t, idx) => {
                if (idx === startIdx || idx === endIdx) return;
                const desc = tileDescs[t.id] || '';
                html += `<li style='margin-bottom:8px;'>Tile ${t.id}: <input type='text' data-tileid='${t.id}' value="${desc}" style='width:220px;'/></li>`;
            });
            html += '</ul>';
            tasksList.innerHTML = html;
            // Add input listeners to save changes (for now, still localStorage, but ready for API)
            tasksList.querySelectorAll('input[data-tileid]').forEach(input => {
                input.addEventListener('input', (e) => {
                    // For now, just update localStorage (API update can be added if backend supports it)
                    tileDescs[input.dataset.tileid] = input.value;
                    // Optionally, send to backend here
                    // localStorage.setItem('tileDescs', JSON.stringify(tileDescs));
                });
            });
        } catch (e) {
            tasksList.innerHTML = '<em>Failed to load tile descriptions.</em>';
        }
    });
    closeTasksModal.addEventListener('click', () => {
        tasksModal.style.display = 'none';
    });
    window.addEventListener('click', (event) => {
        if (event.target === tasksModal) {
            tasksModal.style.display = 'none';
        }
    });
    // --- END TASK LIST MODAL ---

    // On page load, render from API
    renderMazeFromAPI();
    // Optionally, poll for live sync
    setInterval(renderMazeFromAPI, 1000);
    // --- END API-DRIVEN MAZE RENDERING ---
});
