document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('grid');
    const API_BASE = 'https://mazeracebingo.onrender.com';
    let tiles = [];

    // --- TEAM PARAMETER SUPPORT ---
    function getTeamFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('team') || 'default';
    }

    // --- API-DRIVEN MAZE RENDERING ---
    async function fetchMazeState() {
        const team       = getTeamFromUrl();
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(`${API_BASE}/api/maze?team=${encodeURIComponent(team)}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error('Failed to fetch maze state:', err);
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // Returns a human-readable progress label for a tile based on its task type.
    function progressLabel(tileData) {
        const progress = tileData.currentProgress ?? tileData.completionsDone ?? 0;
        const target   = tileData.completionsRequired ?? 1;
        if (target <= 1) return null;
        const cfg  = tileData.taskConfig;
        const type = tileData.taskType;
        if (type === 'npc_kill')  return `${progress} / ${target} kills`;
        if (type === 'xp_gain')   return `${progress.toLocaleString()} / ${target.toLocaleString()} xp`;
        if (type === 'item_drop') return progress >= target ? 'obtained' : 'not yet';
        return `${progress} / ${target}`;
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
        if (!state) return; // API unavailable — skip this render cycle, next poll will retry
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
        // Game over: reveal the entire maze
        if (state.gameOver) {
            state.tiles.forEach((_, i) => revealed.add(i));
        }
        // Helper to get wall object
        function getWallObj(idx) {
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            return state.walls.find(w => w.row === row && w.col === col);
        }
        // Reveal adjacent to completed, only if no wall between
        completed.forEach(idx => {
            revealed.add(idx);
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            const wallObj = getWallObj(idx);
            // Up
            if (row > 0) {
                const nIdx = (row - 1) * state.size + col;
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.top) &&
                    (!nWallObj || !nWallObj.walls.bottom)
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
                    (!nWallObj || !nWallObj.walls.top)
                ) {
                    revealed.add(nIdx);
                }
            }
            // Left
            if (col > 0) {
                const nIdx = row * state.size + (col - 1);
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.left) &&
                    (!nWallObj || !nWallObj.walls.right)
                ) {
                    revealed.add(nIdx);
                }
            }
            // Right
            if (col < state.size - 1) {
                const nIdx = row * state.size + (col + 1);
                const nWallObj = getWallObj(nIdx);
                if (
                    (!wallObj || !wallObj.walls.right) &&
                    (!nWallObj || !nWallObj.walls.left)
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
            // --- COMPLETIONS REQUIRED ---
            // Default to 1 if not present
            const completionsRequired = tileData.completionsRequired !== undefined ? tileData.completionsRequired : 1;
            const completionsLeft = completionsRequired - (tileData.completionsDone || 0);
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
                tile.classList.add('revealed');
                tile.dataset.visible = 'true';
                tile.style.background = '';
                tile.style.color = '';
                // Show progress label beneath tile ID when a task has a target > 1
                const label = progressLabel(tileData);
                if (label) {
                    tile.innerHTML = `<span class="tile-id">${tileData.id}</span><span class="tile-progress">${label}</span>`;
                } else {
                    tile.textContent = tileData.id;
                }
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
                    await openProgressModal(tileData, state);
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
            if (revealed.has(idx)) revealedUncompleted.add(idx);
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

    // --- PROGRESS MODAL ---
    const progressModal      = document.getElementById('progress-modal');
    const progressModalTitle = document.getElementById('progress-modal-title');
    const progressModalBody  = document.getElementById('progress-modal-body');
    const closeProgressModal = document.getElementById('close-progress-modal');

    closeProgressModal.addEventListener('click', () => { progressModal.style.display = 'none'; });
    window.addEventListener('click', e => { if (e.target === progressModal) progressModal.style.display = 'none'; });

    async function openProgressModal(tileData, state) {
        const team   = getTeamFromUrl();
        const tileId = tileData.id;
        const desc   = (state.tileDescriptions || {})[tileId] || '';
        progressModalTitle.textContent = `Tile ${tileId}${desc ? ': ' + desc : ''}`;
        progressModalBody.innerHTML = '<em>Loading...</em>';
        progressModal.style.display = 'block';
        try {
            const res  = await fetch(`${API_BASE}/api/tiles/progress/${tileId}?team=${encodeURIComponent(team)}`);
            const data = await res.json();
            const cfg  = data.taskConfig;
            let taskLine = '';
            if (data.taskType === 'npc_kill')  taskLine = `Kill <b>${cfg.npc}</b> — ${data.currentProgress} / ${data.target} kills`;
            else if (data.taskType === 'xp_gain')   taskLine = `Gain <b>${data.target.toLocaleString()} ${cfg.skill} XP</b> — ${data.currentProgress.toLocaleString()} / ${data.target.toLocaleString()}`;
            else if (data.taskType === 'item_drop')  taskLine = `Receive <b>${cfg.item}</b> from ${cfg.npc}`;
            else taskLine = `Progress: ${data.currentProgress} / ${data.target}`;
            const pct  = Math.min(100, Math.round((data.currentProgress / data.target) * 100));
            const contribRows = data.contributions.length
                ? data.contributions.map(c => `<tr><td>${escapeHtml(c.playerName)}</td><td>${c.amount}</td></tr>`).join('')
                : '<tr><td colspan="2"><em>No progress yet</em></td></tr>';
            progressModalBody.innerHTML = `
                <p>${taskLine}</p>
                <div style="background:#ddd;border-radius:4px;height:14px;margin-bottom:12px;">
                    <div style="background:#4caf50;width:${pct}%;height:100%;border-radius:4px;"></div>
                </div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="text-align:left;border-bottom:1px solid #ccc;">
                        <th style="padding:4px 8px;">Player</th>
                        <th style="padding:4px 8px;">Contributed</th>
                    </tr></thead>
                    <tbody>${contribRows}</tbody>
                </table>`;
        } catch (e) {
            progressModalBody.innerHTML = '<em>Failed to load progress.</em>';
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
