document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('grid');
    const API_BASE = 'https://mazeracebingo.onrender.com';
    let tiles = [];

    // --- TEAM PARAMETER SUPPORT ---
    function getTeamFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('team') || 'default';
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
        // Reveal START always; END is revealed only when a completed neighbour uncovers it
        revealed.add(startIdx);
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
