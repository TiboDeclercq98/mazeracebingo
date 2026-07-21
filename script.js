document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('grid');
    const API_BASE = 'https://mazeracebingo.onrender.com';
    let tiles = [];

    // Cache of the most recent server state/reveal-set, shared by the Tasks modal so it
    // doesn't need its own network round trip when the poll loop already has fresh data.
    let lastState = null;
    let lastRevealed = null;

    // --- TEAM PARAMETER SUPPORT ---
    function getTeamFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('team') || 'default';
    }

    // --- FOG OF WAR TOGGLE (view-only — never touches the real game state) ---
    let fogOff = false;
    const fogBtn = document.getElementById('fog-btn');
    if (fogBtn) {
        fogBtn.addEventListener('click', () => {
            fogOff = !fogOff;
            fogBtn.textContent = fogOff ? 'Fog: Off' : 'Fog';
            fogBtn.classList.toggle('active', fogOff);
            if (lastState) renderMazeFromAPI();
        });
    }

    // --- CONNECTION STATUS (mirrors the RuneLite plugin's status label) ---
    const statusIndicator = document.getElementById('status-indicator');
    function setStatus(connected) {
        if (!statusIndicator) return;
        statusIndicator.textContent = connected ? '● Connected' : '● Disconnected';
        statusIndicator.classList.toggle('connected', connected);
    }

    // --- API-DRIVEN MAZE RENDERING ---
    async function fetchMazeState() {
        const team       = getTeamFromUrl();
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(`${API_BASE}/api/maze?team=${encodeURIComponent(team)}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setStatus(true);
            return data;
        } catch (err) {
            console.error('Failed to fetch maze state:', err);
            setStatus(false);
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
        // if (type === 'npc_kill')  return `${progress} / ${target} kills`;
        if (type === 'xp_gain')   return `${progress.toLocaleString()} / ${target.toLocaleString()} xp`;
        // if (type === 'item_drop') return progress >= target ? 'obtained' : 'not yet';
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

    // Computes the set of tile indices actually revealed by real game progress
    // (START tile, completed tiles, and their unwalled neighbours). This is the
    // "true" reveal set — independent of the client-only Fog toggle.
    function computeRevealedSet(state) {
        const revealed = new Set();
        const completed = new Set();
        state.tiles.forEach((t, i) => { if (t.completed) completed.add(i); });
        const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
        revealed.add(startIdx);
        if (state.gameOver) {
            state.tiles.forEach((_, i) => revealed.add(i));
            return revealed;
        }
        function getWallObj(idx) {
            const row = Math.floor(idx / state.size);
            const col = idx % state.size;
            return state.walls.find(w => w.row === row && w.col === col);
        }
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
        return revealed;
    }

    async function renderMazeFromAPI() {
        const state = await fetchMazeState();
        if (!state) return; // API unavailable — skip this render cycle, next poll will retry
        grid.innerHTML = '';
        tiles = [];
        const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
        const endIdx = Math.floor(state.size / 2);

        const revealed = computeRevealedSet(state);
        // Fog toggle only affects what's drawn — it never changes what's actually
        // "revealed" for the Overview/Tasks panels or for the real game logic.
        const displayRevealed = fogOff ? new Set(state.tiles.map((_, i) => i)) : revealed;
        lastState = state;
        lastRevealed = revealed;

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
            } else if (displayRevealed.has(i)) {
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
            // Boobytrap: shown once completed, or always when Fog is off (view-only preview)
            if (state.boobytraps && state.boobytraps.some(b => b.row === row && b.col === col) && (tileData.completed || fogOff)) {
                tile.classList.add('boobytrap');
            } else {
                tile.classList.remove('boobytrap');
            }
            // Always remove wall classes first
            tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
            // Walls: shown once completed, for START/END, or always when Fog is off
            if (tileData.completed || i === startIdx || i === endIdx || fogOff) {
                const wallObj = state.walls.find(w => w.row === row && w.col === col);
                if (wallObj) {
                    if (wallObj.walls.top) tile.classList.add('wall-top');
                    if (wallObj.walls.right) tile.classList.add('wall-right');
                    if (wallObj.walls.bottom) tile.classList.add('wall-bottom');
                    if (wallObj.walls.left) tile.classList.add('wall-left');
                }
            }
            tile.onclick = async () => {
                if (tile.dataset.visible === 'true' && tile.textContent !== 'END') {
                    await openProgressModal(tileData, state);
                }
            };
            tiles.push(tile);
            grid.appendChild(tile);
        }

        // --- REWORKED OVERVIEW PANEL LOGIC ---
        // Find all revealed but uncompleted tiles
        const revealedUncompleted = new Set();
        for (let idx = 0; idx < state.tiles.length; idx++) {
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

        renderEventsFeed(state);
    }

    // --- RECENT EVENTS FEED (mirrors the RuneLite plugin's "Recent Events" panel) ---
    const MAX_EVENTS = 8;
    function eventColor(type) {
        if (type === 'tile_complete') return '#000';
        if (type === 'keys_missing')  return '#e53935';
        if (type === 'gameover')      return '#4caf50';
        return '#c9960c'; // boobytrap / other special events
    }

    function renderEventsFeed(state) {
        const eventsPanel = document.getElementById('events-panel');
        if (!eventsPanel) return;
        const events = (state.recentEvents || []).slice(-MAX_EVENTS);
        if (!events.length) {
            eventsPanel.innerHTML = '<b>Recent Events:</b><div style="color:#888;margin-top:6px;">No events yet</div>';
            return;
        }
        eventsPanel.innerHTML = '<b>Recent Events:</b><ul>' +
            events.map(e => `<li style="color:${eventColor(e.type)};">${escapeHtml(e.message)}</li>`).join('') +
            '</ul>';
    }

    // --- PROGRESS MODAL ---
    const progressModal      = document.getElementById('progress-modal');
    const progressModalTitle = document.getElementById('progress-modal-title');
    const progressModalBody  = document.getElementById('progress-modal-body');
    const closeProgressModal = document.getElementById('close-progress-modal');

    closeProgressModal.addEventListener('click', () => { progressModal.style.display = 'none'; });
    window.addEventListener('click', e => { if (e.target === progressModal) progressModal.style.display = 'none'; });

    // Joins a list field from taskConfig. In each mode, all names are comma-separated.
    // In shared mode, the last item is joined with "or". Mirrors TileInfoPanel.buildListLabel.
    function buildListLabel(cfg, pluralKey, singularKey, eachMode) {
        const names = Array.isArray(cfg[pluralKey]) ? cfg[pluralKey] : (cfg[singularKey] ? [cfg[singularKey]] : null);
        if (!names) return '?';
        if (!eachMode && names.length > 1) {
            return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
        }
        return names.join(', ');
    }

    // Builds the task description line for a tile. Mirrors TileInfoPanel.showTile's taskLine logic.
    function buildTaskLine(data) {
        const cfg = data.taskConfig;
        if (!cfg) return `Progress: ${data.currentProgress.toLocaleString()} / ${data.target.toLocaleString()}`;
        const eachMode = cfg.mode === 'each';
        const cur = data.currentProgress, tgt = data.target;

        if (data.taskType === 'npc_kill') {
            const npcLabel = buildListLabel(cfg, 'npcs', 'npc', eachMode);
            return eachMode
                ? `Kill each: <b>${npcLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} kills`
                : `Kill <b>${npcLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} kills`;
        }
        if (data.taskType === 'xp_gain') {
            const skillLabel = buildListLabel(cfg, 'skills', 'skill', eachMode);
            if (eachMode) {
                const perItemTarget = cfg.target ?? tgt;
                return `Gain ${perItemTarget.toLocaleString()} XP each: <b>${skillLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
            }
            return `Gain <b>${tgt.toLocaleString()} ${skillLabel} XP</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
        }
        if (data.taskType === 'item_drop' || data.taskType === 'loot_item') {
            const itemLabel = buildListLabel(cfg, 'items', 'item', eachMode);
            return eachMode
                ? `Receive each: <b>${itemLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`
                : `Receive <b>${itemLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
        }
        if (data.taskType === 'agility_lap') {
            const courseLabel = buildListLabel(cfg, 'courses', 'course', eachMode);
            return eachMode
                ? `Complete laps of each: <b>${courseLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} laps`
                : `Complete laps of <b>${courseLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} laps`;
        }
        if (data.taskType === 'minigame_completion') {
            const minigameLabel = cfg.minigame || cfg.message || 'minigame';
            return `Complete <b>${escapeHtml(minigameLabel)}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
        }
        if (data.taskType === 'gp_value') {
            return `Collect <b>${tgt.toLocaleString()} gp</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} gp`;
        }
        return `Progress: ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
    }

    async function openProgressModal(tileData, state) {
        const team   = getTeamFromUrl();
        const tileId = tileData.id;
        const desc   = (state.tileDescriptions || {})[tileId] || '';
        const row    = Math.floor((tileId - 1) / state.size);
        const col    = (tileId - 1) % state.size;
        const isBoobytrap = tileData.completed && (state.boobytraps || []).some(b => b.row === row && b.col === col);
        progressModalTitle.textContent = `Tile ${tileId}${desc ? ': ' + desc : ''}`;
        progressModalTitle.style.color = isBoobytrap ? '#e53935' : '';
        progressModalBody.innerHTML = '<em>Loading...</em>';
        progressModal.style.display = 'block';
        try {
            const res  = await fetch(`${API_BASE}/api/tiles/progress/${tileId}?team=${encodeURIComponent(team)}`);
            const data = await res.json();
            const eachMode = data.taskConfig && data.taskConfig.mode === 'each';
            const taskLine = buildTaskLine(data);
            const pct  = data.target > 0 ? Math.min(100, Math.round((data.currentProgress / data.target) * 100)) : 0;

            const itemProgressRows = (eachMode && data.itemProgress && data.itemProgress.length)
                ? data.itemProgress.map(ip => {
                    const ipPct = ip.target > 0 ? Math.min(100, Math.round((ip.progress / ip.target) * 100)) : 0;
                    return `<div style="margin-bottom:6px;">
                        <div style="font-size:0.85em;margin-bottom:2px;">${escapeHtml(ip.name)}</div>
                        <div style="background:#ddd;border-radius:4px;height:12px;">
                            <div style="background:${ip.progress >= ip.target ? '#4caf50' : '#6495ed'};width:${ipPct}%;height:100%;border-radius:4px;"></div>
                        </div>
                    </div>`;
                }).join('')
                : '';

            const contribRows = data.contributions.length
                ? data.contributions.map(c => `<tr><td>${escapeHtml(c.playerName)}</td><td>${c.amount.toLocaleString()}${c.subCategory ? ' ' + escapeHtml(c.subCategory) : ''}</td></tr>`).join('')
                : '<tr><td colspan="2"><em>No progress yet</em></td></tr>';

            progressModalBody.innerHTML = `
                <p>${taskLine}</p>
                <div style="background:#ddd;border-radius:4px;height:14px;margin-bottom:12px;">
                    <div style="background:#4caf50;width:${pct}%;height:100%;border-radius:4px;"></div>
                </div>
                ${itemProgressRows}
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

    // Shows a detailed, read-only breakdown of every currently visible (revealed,
    // uncompleted) task — mirrors the RuneLite plugin's "Active Tasks" panel, but
    // with the full task-line detail from the progress modal. Clicking a row opens
    // that tile's full progress modal (contributions, each-mode breakdown, etc.).
    tasksBtn.addEventListener('click', async () => {
        tasksModal.style.display = 'block';
        tasksList.innerHTML = '<em>Loading...</em>';
        const state = lastState || await fetchMazeState();
        if (!state) {
            tasksList.innerHTML = '<em>Failed to load tasks.</em>';
            return;
        }
        const revealed = (lastState === state && lastRevealed) ? lastRevealed : computeRevealedSet(state);
        const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
        const endIdx = Math.floor(state.size / 2);
        const tileDescs = state.tileDescriptions || {};

        const visibleTasks = [];
        state.tiles.forEach((t, idx) => {
            if (idx === startIdx || idx === endIdx) return;
            if (t.completed || !revealed.has(idx)) return;
            visibleTasks.push(t);
        });

        if (!visibleTasks.length) {
            tasksList.innerHTML = '<em>No visible tasks right now.</em>';
            return;
        }

        tasksList.innerHTML = '<ul style="list-style:none;padding-left:0;margin-top:12px;">' +
            visibleTasks.map(t => {
                const desc = tileDescs[t.id] || '';
                const target = t.completionsRequired || 1;
                const current = t.currentProgress ?? t.completionsDone ?? 0;
                const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
                const taskLine = buildTaskLine({ taskType: t.taskType, taskConfig: t.taskConfig, currentProgress: current, target });
                return `
                    <li data-tileid="${t.id}" style="margin-bottom:12px;cursor:pointer;padding:6px;border-radius:4px;border:1px solid #e0e0e0;">
                        <div style="font-weight:bold;margin-bottom:2px;">Tile ${t.id}${desc ? ': ' + escapeHtml(desc) : ''}</div>
                        <div style="font-size:0.9em;margin-bottom:4px;">${taskLine}</div>
                        <div style="background:#ddd;border-radius:4px;height:10px;">
                            <div style="background:#4caf50;width:${pct}%;height:100%;border-radius:4px;"></div>
                        </div>
                    </li>`;
            }).join('') + '</ul>';

        tasksList.querySelectorAll('li[data-tileid]').forEach(li => {
            li.addEventListener('click', () => {
                const t = state.tiles.find(x => x.id === parseInt(li.dataset.tileid, 10));
                if (t) openProgressModal(t, state);
            });
        });
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

    // --- DRAW MODE (maze layout editor — builds save files consumed by POST /api/create) ---
    // Restored from the pre-API version of this app (commit 7a50d1f); adapted to write
    // save-file JSON instead of localStorage, since the live app is now server-backed.
    const DRAW_SIZE = 9; // matches the SIZE constant in maze-api.js
    const drawPopupBtn = document.getElementById('draw-popup-btn');
    const drawModal = document.getElementById('draw-modal');
    const closeDrawModal = document.getElementById('close-draw-modal');
    const drawGrid = document.getElementById('draw-grid');

    let drawTiles = [];
    let drawSelected = null;
    let drawInitialized = false;
    let drawTileDescriptions = {};
    let drawTrapDescriptions = {};

    function drawStartCoord() { return { row: DRAW_SIZE - 1, col: Math.floor(DRAW_SIZE / 2) }; }
    function drawEndCoord()   { return { row: 0, col: Math.floor(DRAW_SIZE / 2) }; }

    // Builds a fresh grid where every tile is walled off on all 4 sides — the blank
    // canvas the designer carves paths into by clicking pairs of adjacent tiles.
    function buildBlankDrawGrid() {
        drawGrid.innerHTML = '';
        drawTiles = [];
        drawSelected = null;
        const start = drawStartCoord(), end = drawEndCoord();
        for (let row = 0; row < DRAW_SIZE; row++) {
            for (let col = 0; col < DRAW_SIZE; col++) {
                const tile = document.createElement('div');
                tile.className = 'tile revealed wall-top wall-right wall-bottom wall-left';
                tile.dataset.row = row;
                tile.dataset.col = col;
                if (row === start.row && col === start.col) {
                    tile.textContent = 'START';
                    tile.style.background = 'pink';
                    tile.style.color = '#000';
                } else if (row === end.row && col === end.col) {
                    tile.textContent = 'END';
                    tile.style.background = '#e53935';
                    tile.style.color = '#fff';
                } else {
                    tile.textContent = row * DRAW_SIZE + col + 1;
                }
                tile.onclick = () => handleDrawTileClick(tile, row, col);
                tile.oncontextmenu = e => handleDrawTileRightClick(e, tile);
                drawTiles.push(tile);
                drawGrid.appendChild(tile);
            }
        }
    }

    // Click two adjacent tiles in sequence to toggle the shared wall between them.
    function handleDrawTileClick(tile, row, col) {
        if (drawSelected === null) {
            drawSelected = { tile, row, col };
            tile.style.outline = '2px solid orange';
            return;
        }
        drawSelected.tile.style.outline = '';
        const dr = row - drawSelected.row;
        const dc = col - drawSelected.col;
        let wall1, wall2;
        if (dr === 1 && dc === 0)       { wall1 = 'bottom'; wall2 = 'top'; }
        else if (dr === -1 && dc === 0) { wall1 = 'top';    wall2 = 'bottom'; }
        else if (dr === 0 && dc === 1)  { wall1 = 'right';  wall2 = 'left'; }
        else if (dr === 0 && dc === -1) { wall1 = 'left';   wall2 = 'right'; }
        if (wall1 && wall2) {
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

    // Right-click toggles a boobytrap (key) on a tile.
    function handleDrawTileRightClick(e, tile) {
        e.preventDefault();
        tile.classList.toggle('boobytrap');
        const drawTrapsModal = document.getElementById('draw-traps-modal');
        if (drawTrapsModal && drawTrapsModal.style.display === 'block') {
            renderDrawTrapsList();
        }
    }

    function openDrawModal() {
        if (!drawInitialized) {
            buildBlankDrawGrid();
            drawTileDescriptions = {};
            drawTrapDescriptions = {};
            drawInitialized = true;
        }
        drawModal.style.display = 'block';
    }

    if (drawPopupBtn) drawPopupBtn.onclick = openDrawModal;
    if (closeDrawModal) closeDrawModal.onclick = () => { drawModal.style.display = 'none'; };
    window.addEventListener('click', event => {
        if (event.target === drawModal) drawModal.style.display = 'none';
    });

    function downloadJson(obj, filename) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }

    // Save: download a save file shaped exactly like POST /api/create's expected body
    // (see files in "Save files/"), ready to be posted as-is to create a live maze.
    const drawSaveBtn = document.getElementById('draw-save-btn');
    if (drawSaveBtn) drawSaveBtn.onclick = () => {
        const mazeWalls = [];
        const boobytraps = [];
        for (const tile of drawTiles) {
            const row = parseInt(tile.dataset.row, 10);
            const col = parseInt(tile.dataset.col, 10);
            mazeWalls.push({
                row, col,
                walls: {
                    top: tile.classList.contains('wall-top'),
                    right: tile.classList.contains('wall-right'),
                    bottom: tile.classList.contains('wall-bottom'),
                    left: tile.classList.contains('wall-left')
                }
            });
            if (tile.classList.contains('boobytrap')) boobytraps.push({ row, col });
        }
        downloadJson({
            saveData: {
                size: DRAW_SIZE,
                mazeWalls,
                boobytraps,
                tileDescriptions: { ...drawTileDescriptions },
                trapDescriptions: { ...drawTrapDescriptions },
                taskDefinitions: {}
            }
        }, 'maze-save.json');
    };

    // Rebuilds the draw grid from a previously saved (or hand-edited) save file.
    // Accepts both the wrapped `{ saveData: {...} }` shape used by /api/create
    // and a bare `{ mazeWalls, ... }` shape for backward compatibility.
    function loadDrawState(data) {
        buildBlankDrawGrid();
        for (const tile of drawTiles) {
            const row = parseInt(tile.dataset.row, 10);
            const col = parseInt(tile.dataset.col, 10);
            tile.classList.remove('wall-top', 'wall-right', 'wall-bottom', 'wall-left');
            const wallObj = data.mazeWalls.find(w => w.row === row && w.col === col);
            if (wallObj) {
                if (wallObj.walls.top) tile.classList.add('wall-top');
                if (wallObj.walls.right) tile.classList.add('wall-right');
                if (wallObj.walls.bottom) tile.classList.add('wall-bottom');
                if (wallObj.walls.left) tile.classList.add('wall-left');
            }
        }
        (data.boobytraps || []).forEach(b => {
            const tile = drawTiles.find(t => parseInt(t.dataset.row, 10) === b.row && parseInt(t.dataset.col, 10) === b.col);
            if (tile) tile.classList.add('boobytrap');
        });
        drawTileDescriptions = { ...(data.tileDescriptions || {}) };
        drawTrapDescriptions = { ...(data.trapDescriptions || {}) };
        drawInitialized = true;
    }

    const drawLoadBtn = document.getElementById('draw-load-btn');
    if (drawLoadBtn) drawLoadBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => {
                try {
                    const parsed = JSON.parse(evt.target.result);
                    const data = (parsed && parsed.saveData) ? parsed.saveData : parsed;
                    if (!data || !Array.isArray(data.mazeWalls)) {
                        alert('Invalid maze save file.');
                        return;
                    }
                    loadDrawState(data);
                } catch (err) {
                    alert('Failed to load maze save: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    // Draw Tasks modal: edit each tile's description before saving.
    const drawTasksBtn = document.getElementById('draw-tasks-btn');
    const drawTasksModal = document.getElementById('draw-tasks-modal');
    const closeDrawTasksModal = document.getElementById('close-draw-tasks-modal');
    const drawTasksList = document.getElementById('draw-tasks-list');

    if (drawTasksBtn && drawTasksModal && closeDrawTasksModal) {
        drawTasksBtn.onclick = () => {
            const start = drawStartCoord(), end = drawEndCoord();
            const startId = start.row * DRAW_SIZE + start.col + 1;
            const endId = end.row * DRAW_SIZE + end.col + 1;
            let html = '<ul style="list-style:none;padding-left:0">';
            for (let id = 1; id <= DRAW_SIZE * DRAW_SIZE; id++) {
                if (id === startId || id === endId) continue;
                const desc = drawTileDescriptions[id] || '';
                html += `<li style='margin-bottom:8px;'>Tile ${id}: <input type='text' data-tileid='${id}' value="${escapeHtml(desc)}" style='width:220px;'/></li>`;
            }
            html += '</ul>';
            drawTasksList.innerHTML = html;
            drawTasksList.querySelectorAll('input[data-tileid]').forEach(input => {
                input.addEventListener('input', () => {
                    drawTileDescriptions[input.dataset.tileid] = input.value;
                });
            });
            drawTasksModal.style.display = 'block';
        };
        closeDrawTasksModal.onclick = () => { drawTasksModal.style.display = 'none'; };
        window.addEventListener('click', event => {
            if (event.target === drawTasksModal) drawTasksModal.style.display = 'none';
        });
    }

    // Draw Traps modal: edit descriptions for tiles currently marked as boobytraps.
    const drawTrapsBtn = document.getElementById('draw-traps-btn');
    const drawTrapsModal = document.getElementById('draw-traps-modal');
    const closeDrawTrapsModal = document.getElementById('close-draw-traps-modal');
    const drawTrapsList = document.getElementById('draw-traps-list');

    function renderDrawTrapsList() {
        const trapTiles = drawTiles.filter(t => t.classList.contains('boobytrap'));
        if (!trapTiles.length) {
            drawTrapsList.innerHTML = '<em>No traps placed. Right-click a tile in the Draw grid to add one.</em>';
            return;
        }
        let html = '<ul style="list-style:none;padding-left:0">';
        trapTiles.forEach(tile => {
            const row = parseInt(tile.dataset.row, 10), col = parseInt(tile.dataset.col, 10);
            const id = row * DRAW_SIZE + col + 1;
            const desc = drawTrapDescriptions[id] || '';
            html += `<li style='margin-bottom:8px;'>Tile ${id}: <input type='text' data-tileid='${id}' value="${escapeHtml(desc)}" style='width:220px;'/></li>`;
        });
        html += '</ul>';
        drawTrapsList.innerHTML = html;
        drawTrapsList.querySelectorAll('input[data-tileid]').forEach(input => {
            input.addEventListener('input', () => {
                drawTrapDescriptions[input.dataset.tileid] = input.value;
            });
        });
    }

    if (drawTrapsBtn && drawTrapsModal && closeDrawTrapsModal) {
        drawTrapsBtn.onclick = () => {
            renderDrawTrapsList();
            drawTrapsModal.style.display = 'block';
        };
        closeDrawTrapsModal.onclick = () => { drawTrapsModal.style.display = 'none'; };
        window.addEventListener('click', event => {
            if (event.target === drawTrapsModal) drawTrapsModal.style.display = 'none';
        });
    }
    // --- END DRAW MODE ---

    // On page load, render from API
    renderMazeFromAPI();
    // Optionally, poll for live sync
    setInterval(renderMazeFromAPI, 1000);
    // --- END API-DRIVEN MAZE RENDERING ---
});
