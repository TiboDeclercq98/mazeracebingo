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
            // Re-render immediately from the cached state instead of waiting on a fetch,
            // so the grid, Overview panel, and Tasks modal all reflect the toggle at once.
            if (lastState) renderFromState(lastState);
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

    // The set actually used for display: identical to the true reveal set, except when
    // Fog is off, in which case every tile is treated as revealed across the grid, the
    // Overview panel, and the Tasks modal. Fog still never touches the real game state.
    function computeDisplayRevealedSet(state) {
        if (fogOff) return new Set(state.tiles.map((_, i) => i));
        return computeRevealedSet(state);
    }

    async function renderMazeFromAPI() {
        const state = await fetchMazeState();
        if (!state) return; // API unavailable — skip this render cycle, next poll will retry
        renderFromState(state);
    }

    // Renders the grid/Overview panel/events feed from an already-fetched state, without
    // hitting the network. Used by the poll loop and by the Fog toggle (for instant feedback).
    function renderFromState(state) {
        grid.innerHTML = '';
        tiles = [];
        const startIdx = (state.size - 1) * state.size + Math.floor(state.size / 2);
        const endIdx = Math.floor(state.size / 2);

        const revealed = computeDisplayRevealedSet(state);
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
        if (data.taskType === 'npc_damage') {
            const npcLabel = buildListLabel(cfg, 'npcs', 'npc', eachMode);
            return eachMode
                ? `Deal damage to each: <b>${npcLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} damage`
                : `Deal damage to <b>${npcLabel}</b> — ${cur.toLocaleString()} / ${tgt.toLocaleString()} damage`;
        }
        if (data.taskType === 'clue_completion') {
            const tierLabel = buildListLabel(cfg, 'tiers', 'tier', eachMode);
            return eachMode
                ? `Complete each: <b>${tierLabel}</b> clue(s) — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`
                : `Complete <b>${tierLabel}</b> clue(s) — ${cur.toLocaleString()} / ${tgt.toLocaleString()}`;
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
        const revealed = (lastState === state && lastRevealed) ? lastRevealed : computeDisplayRevealedSet(state);
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
    // Output format matches "Save files/Maggot-King.json" exactly: saveData.{size,
    // mazeWalls, tileDescriptions, boobytraps, taskDefinitions (array)}.
    const DRAW_SIZE = 9; // matches the SIZE constant in maze-api.js
    const drawPopupBtn = document.getElementById('draw-popup-btn');
    const drawModal = document.getElementById('draw-modal');
    const closeDrawModal = document.getElementById('close-draw-modal');
    const drawGrid = document.getElementById('draw-grid');

    // Task types the plugin/server understand, and which of them support "mode: each"
    // (see getEachModeItems in maze-api.js and MazeBingoPlugin.java's matchingTiles calls).
    const TASK_TYPES = [
        { value: '', label: 'No task' },
        { value: 'npc_kill', label: 'Kill NPC(s)' },
        { value: 'npc_damage', label: 'Deal damage to NPC(s)' },
        { value: 'xp_gain', label: 'Gain XP' },
        { value: 'item_drop', label: 'Receive item(s)' },
        { value: 'agility_lap', label: 'Agility laps' },
        { value: 'minigame_completion', label: 'Minigame completion' },
        { value: 'clue_completion', label: 'Complete clue scroll(s)' },
        { value: 'gp_value', label: 'GP value' }
    ];
    const EACH_MODE_TYPES = ['npc_kill', 'npc_damage', 'xp_gain', 'item_drop', 'agility_lap', 'clue_completion'];
    // Matches CLUE_TIER_PATTERN in MazeBingoPlugin.java — the tiers the plugin can detect
    // from the "You have completed X <tier> Treasure Trails" chat message.
    const CLUE_TIERS = ['Beginner', 'Easy', 'Medium', 'Hard', 'Elite', 'Master'];
    const OSRS_SKILLS = [
        'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic',
        'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting',
        'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming',
        'Runecraft', 'Hunter', 'Construction', 'Sailing'
    ];
    // Known "message" substrings this project has already validated against real chat
    // output (see Save files/Test-plugin-2.json, -3.json) for minigame_completion tasks.
    const MINIGAME_COMPLETIONS = [
        { minigame: 'Wintertodt', message: 'subdued Wintertodt count is' },
        { minigame: 'Tempoross', message: 'Tempoross kill count is' },
        { minigame: 'Guardians of the Rift', message: 'Amount of rifts you have closed' },
        { minigame: 'Hallowed Sepulchre (Floor 1)', message: 'completed Floor 1 of the Hallowed Sepulchre' },
        { minigame: 'Hallowed Sepulchre (Floor 2)', message: 'completed Floor 2 of the Hallowed Sepulchre' },
        { minigame: 'Hallowed Sepulchre (Floor 3)', message: 'completed Floor 3 of the Hallowed Sepulchre' },
        { minigame: 'Hallowed Sepulchre (Floor 4)', message: 'completed Floor 4 of the Hallowed Sepulchre' },
        { minigame: 'Hallowed Sepulchre (Floor 5)', message: 'completed Floor 5 of the Hallowed Sepulchre' }
    ];
    // Matches COURSE_ENDPOINTS keys in MazeBingoPlugin.java — the courses the plugin can detect.
    const AGILITY_COURSES = [
        'Gnome', 'Draynor', 'Al Kharid', 'Varrock', 'Barbarian', 'Canifis', 'Falador',
        "Seers' Village", 'Pollnivneach', 'Rellekka', 'Ardougne', 'Pyramid', 'Wilderness',
        'Werewolf', 'Prifddinas', 'Shayzien Basic', 'Shayzien Advanced', 'Penguin', 'Ape Atoll'
    ];

    let drawTiles = [];
    let drawSelected = null;
    let drawInitialized = false;
    let drawTileDescriptions = {};
    // Keyed by tileId (number) -> { taskType, taskConfig }. Absent = no task assigned.
    let drawTaskDefinitions = {};

    function drawStartCoord() { return { row: DRAW_SIZE - 1, col: Math.floor(DRAW_SIZE / 2) }; }
    function drawEndCoord()   { return { row: 0, col: Math.floor(DRAW_SIZE / 2) }; }
    function drawStartId() { const c = drawStartCoord(); return c.row * DRAW_SIZE + c.col + 1; }
    function drawEndId()   { const c = drawEndCoord();   return c.row * DRAW_SIZE + c.col + 1; }

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

    // Right-click toggles a Key (boobytrap) on a tile.
    function handleDrawTileRightClick(e, tile) {
        e.preventDefault();
        tile.classList.toggle('boobytrap');
        const drawKeysModal = document.getElementById('draw-keys-modal');
        if (drawKeysModal && drawKeysModal.style.display === 'block') {
            renderDrawKeysList();
        }
    }

    function openDrawModal() {
        if (!drawInitialized) {
            buildBlankDrawGrid();
            drawTileDescriptions = {};
            drawTaskDefinitions = {};
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

    // Save: download a save file shaped exactly like "Save files/Maggot-King.json" and
    // POST /api/create's expected body, ready to be posted as-is to create a live maze.
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

        // Integer-like string keys are always enumerated in ascending numeric order by
        // JS, so this serializes as "1", "2", ... regardless of edit order.
        const tileDescriptionsOut = {};
        Object.keys(drawTileDescriptions).forEach(id => {
            const v = (drawTileDescriptions[id] || '').trim();
            if (v) tileDescriptionsOut[id] = v;
        });

        const taskDefinitionsOut = Object.keys(drawTaskDefinitions)
            .map(id => parseInt(id, 10))
            .sort((a, b) => a - b)
            .map(id => ({
                tileId: id,
                taskType: drawTaskDefinitions[id].taskType,
                taskConfig: drawTaskDefinitions[id].taskConfig
            }));

        downloadJson({
            saveData: {
                size: DRAW_SIZE,
                mazeWalls,
                tileDescriptions: tileDescriptionsOut,
                boobytraps,
                taskDefinitions: taskDefinitionsOut
            }
        }, 'maze-save.json');
    };

    // Rebuilds the draw grid from a previously saved (or hand-edited) save file.
    // Accepts both the wrapped `{ saveData: {...} }` shape used by /api/create
    // and a bare `{ mazeWalls, ... }` shape for backward compatibility. taskDefinitions
    // may be the array form (as saved) or an object keyed by tileId (also accepted by
    // /api/create), for compatibility with hand-edited files.
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

        drawTaskDefinitions = {};
        const rawTaskDefs = data.taskDefinitions;
        if (Array.isArray(rawTaskDefs)) {
            rawTaskDefs.forEach(d => {
                drawTaskDefinitions[d.tileId] = { taskType: d.taskType, taskConfig: d.taskConfig };
            });
        } else if (rawTaskDefs && typeof rawTaskDefs === 'object') {
            Object.entries(rawTaskDefs).forEach(([tileId, def]) => {
                drawTaskDefinitions[tileId] = { taskType: def.taskType, taskConfig: def.taskConfig };
            });
        }
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

    // --- DRAW TASKS MODAL: per-tile editor for tileDescriptions + taskDefinitions ---

    function makeLabeledRow(labelText, inputEl) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:6px;';
        const lbl = document.createElement('label');
        lbl.textContent = labelText;
        lbl.style.cssText = 'display:block;font-size:0.8em;color:#555;margin-bottom:2px;';
        row.appendChild(lbl);
        row.appendChild(inputEl);
        return row;
    }

    function makeTextField(value, placeholder, onChange) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value || '';
        input.placeholder = placeholder || '';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:3px 6px;';
        input.addEventListener('input', () => onChange(input.value));
        return input;
    }

    function makeNumberField(value, onChange) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.value = value || 1;
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:3px 6px;';
        input.addEventListener('input', () => onChange(Math.max(1, parseInt(input.value, 10) || 1)));
        return input;
    }

    function makeMultiSelect(options, selectedValues, onChange) {
        const select = document.createElement('select');
        select.multiple = true;
        select.size = Math.min(6, options.length);
        select.style.cssText = 'width:100%;';
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (selectedValues.includes(opt)) o.selected = true;
            select.appendChild(o);
        });
        select.addEventListener('change', () => {
            onChange(Array.from(select.selectedOptions).map(o => o.value));
        });
        return select;
    }

    function makeCheckboxRow(checked, labelText, onChange) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin:8px 0 2px;font-size:0.85em;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!checked;
        cb.addEventListener('change', () => onChange(cb.checked));
        wrap.appendChild(cb);
        wrap.appendChild(document.createTextNode(labelText));
        return wrap;
    }

    // Reads a name-list field that may be stored as a singular key ("npc": "X") or a
    // plural array key ("npcs": ["X","Y"]) — mirrors buildListLabel's input shape.
    function getListFieldValue(cfg, pluralKey, singularKey) {
        if (Array.isArray(cfg[pluralKey])) return cfg[pluralKey];
        if (cfg[singularKey]) return [cfg[singularKey]];
        return [];
    }

    // Writes a name list back using the same singular/plural convention as the save files:
    // a single name uses the singular key, multiple names use the plural array key.
    function setListField(cfg, pluralKey, singularKey, names) {
        delete cfg[pluralKey];
        delete cfg[singularKey];
        const clean = names.map(s => s.trim()).filter(Boolean);
        if (clean.length > 1) cfg[pluralKey] = clean;
        else if (clean.length === 1) cfg[singularKey] = clean[0];
    }

    // Builds the dynamic config fields for a tile's task editor row, based on the
    // currently selected task type. Mirrors the taskType/taskConfig shapes read by
    // TileInfoPanel.showTile and getEachModeItems in maze-api.js.
    function renderDrawTaskFields(container, tileId, type) {
        container.innerHTML = '';
        if (!type) {
            delete drawTaskDefinitions[tileId];
            return;
        }
        const prevDef = drawTaskDefinitions[tileId];
        const cfg = (prevDef && prevDef.taskType === type) ? prevDef.taskConfig : {};
        drawTaskDefinitions[tileId] = { taskType: type, taskConfig: cfg };

        if (type === 'npc_kill') {
            container.appendChild(makeLabeledRow('NPC name(s), comma-separated',
                makeTextField(getListFieldValue(cfg, 'npcs', 'npc').join(', '), 'e.g. Goblin, Cow',
                    v => setListField(cfg, 'npcs', 'npc', v.split(',')))));
            container.appendChild(makeLabeledRow('Target (kills)', makeNumberField(cfg.target || 1, v => cfg.target = v)));
        } else if (type === 'xp_gain') {
            container.appendChild(makeLabeledRow('Skill(s)',
                makeMultiSelect(OSRS_SKILLS, getListFieldValue(cfg, 'skills', 'skill'),
                    v => setListField(cfg, 'skills', 'skill', v))));
            container.appendChild(makeLabeledRow('Target (XP)', makeNumberField(cfg.target || 1000, v => cfg.target = v)));
        } else if (type === 'item_drop') {
            container.appendChild(makeLabeledRow('Item name(s), comma-separated',
                makeTextField(getListFieldValue(cfg, 'items', 'item').join(', '), 'e.g. Rune scimitar, Dragon bones',
                    v => setListField(cfg, 'items', 'item', v.split(',')))));
            container.appendChild(makeLabeledRow('Target (count)', makeNumberField(cfg.target || 1, v => cfg.target = v)));
        } else if (type === 'npc_damage') {
            container.appendChild(makeLabeledRow('NPC name(s), comma-separated',
                makeTextField(getListFieldValue(cfg, 'npcs', 'npc').join(', '), 'e.g. Vorkath, Zulrah',
                    v => setListField(cfg, 'npcs', 'npc', v.split(',')))));
            container.appendChild(makeLabeledRow('Target (damage)', makeNumberField(cfg.target || 10000, v => cfg.target = v)));
        } else if (type === 'agility_lap') {
            container.appendChild(makeLabeledRow('Course(s)',
                makeMultiSelect(AGILITY_COURSES, getListFieldValue(cfg, 'courses', 'course'),
                    v => setListField(cfg, 'courses', 'course', v))));
            container.appendChild(makeLabeledRow('Target (laps)', makeNumberField(cfg.target || 1, v => cfg.target = v)));
        } else if (type === 'clue_completion') {
            container.appendChild(makeLabeledRow('Tier(s)',
                makeMultiSelect(CLUE_TIERS, getListFieldValue(cfg, 'tiers', 'tier'),
                    v => setListField(cfg, 'tiers', 'tier', v))));
            container.appendChild(makeLabeledRow('Target (completions)', makeNumberField(cfg.target || 1, v => cfg.target = v)));
        } else if (type === 'minigame_completion') {
            // Matched by message alone — it's the field that actually drives chat matching;
            // "minigame" is just a display label, so a differing label shouldn't force Custom.
            const matchIdx = MINIGAME_COMPLETIONS.findIndex(m => m.message === cfg.message);
            const minigameSelect = document.createElement('select');
            minigameSelect.style.cssText = 'width:100%;';
            MINIGAME_COMPLETIONS.forEach((m, i) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = m.minigame;
                minigameSelect.appendChild(opt);
            });
            const customOpt = document.createElement('option');
            customOpt.value = 'custom';
            customOpt.textContent = 'Custom (enter manually)';
            minigameSelect.appendChild(customOpt);
            minigameSelect.value = matchIdx >= 0 ? String(matchIdx) : 'custom';
            container.appendChild(makeLabeledRow('Minigame', minigameSelect));

            const customFieldsContainer = document.createElement('div');
            container.appendChild(customFieldsContainer);

            function renderMinigameCustomFields() {
                customFieldsContainer.innerHTML = '';
                if (minigameSelect.value === 'custom') {
                    customFieldsContainer.appendChild(makeLabeledRow('Chat message match',
                        makeTextField(cfg.message || '', 'substring of the chat message', v => cfg.message = v)));
                    customFieldsContainer.appendChild(makeLabeledRow('Minigame label (optional)',
                        makeTextField(cfg.minigame || '', 'defaults to the message', v => cfg.minigame = v)));
                } else {
                    const chosen = MINIGAME_COMPLETIONS[parseInt(minigameSelect.value, 10)];
                    cfg.minigame = chosen.minigame;
                    cfg.message = chosen.message;
                }
            }
            minigameSelect.addEventListener('change', renderMinigameCustomFields);
            renderMinigameCustomFields();

            container.appendChild(makeLabeledRow('Target (completions)', makeNumberField(cfg.target || 1, v => cfg.target = v)));
        } else if (type === 'gp_value') {
            container.appendChild(makeLabeledRow('Target (gp)', makeNumberField(cfg.target || 100000, v => cfg.target = v)));
        }

        if (EACH_MODE_TYPES.includes(type)) {
            container.appendChild(makeCheckboxRow(cfg.mode === 'each', 'Each item independently (mode: each)', checked => {
                if (checked) cfg.mode = 'each'; else delete cfg.mode;
            }));
        }
    }

    function buildDrawTaskRow(tileId) {
        const li = document.createElement('li');
        li.style.cssText = 'margin-bottom:14px;padding:8px;border:1px solid #e0e0e0;border-radius:4px;list-style:none;';

        const label = document.createElement('div');
        label.style.cssText = 'font-weight:bold;margin-bottom:4px;';
        const tag = tileId === drawStartId() ? ' (START)' : tileId === drawEndId() ? ' (END)' : '';
        label.textContent = `Tile ${tileId}${tag}`;
        li.appendChild(label);

        li.appendChild(makeTextField(drawTileDescriptions[tileId] || '', 'Description...',
            v => { drawTileDescriptions[tileId] = v; }));

        const typeRow = document.createElement('div');
        typeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:6px 0;';
        const typeLabel = document.createElement('span');
        typeLabel.textContent = 'Task:';
        typeLabel.style.fontSize = '0.85em';
        const typeSelect = document.createElement('select');
        TASK_TYPES.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.value;
            opt.textContent = t.label;
            typeSelect.appendChild(opt);
        });
        const existing = drawTaskDefinitions[tileId];
        typeSelect.value = existing ? existing.taskType : '';
        typeRow.appendChild(typeLabel);
        typeRow.appendChild(typeSelect);
        li.appendChild(typeRow);

        const fieldsContainer = document.createElement('div');
        li.appendChild(fieldsContainer);

        typeSelect.addEventListener('change', () => renderDrawTaskFields(fieldsContainer, tileId, typeSelect.value));
        renderDrawTaskFields(fieldsContainer, tileId, typeSelect.value);

        return li;
    }

    // Draw Tasks modal: guides the user through building both tileDescriptions and
    // taskDefinitions for every tile, ready to be written out by the Save button.
    const drawTasksBtn = document.getElementById('draw-tasks-btn');
    const drawTasksModal = document.getElementById('draw-tasks-modal');
    const closeDrawTasksModal = document.getElementById('close-draw-tasks-modal');
    const drawTasksList = document.getElementById('draw-tasks-list');

    if (drawTasksBtn && drawTasksModal && closeDrawTasksModal) {
        drawTasksBtn.onclick = () => {
            drawTasksList.innerHTML = '';
            const ul = document.createElement('ul');
            ul.style.cssText = 'list-style:none;padding-left:0;margin:0;';
            for (let id = 1; id <= DRAW_SIZE * DRAW_SIZE; id++) {
                ul.appendChild(buildDrawTaskRow(id));
            }
            drawTasksList.appendChild(ul);
            drawTasksModal.style.display = 'block';
        };
        closeDrawTasksModal.onclick = () => { drawTasksModal.style.display = 'none'; };
        window.addEventListener('click', event => {
            if (event.target === drawTasksModal) drawTasksModal.style.display = 'none';
        });
    }

    // Draw Keys modal (formerly "Traps"): read-only — just the instructions and a
    // list of currently marked tiles. Keys have no description field in the save
    // format (the boobytraps table only stores row/col), so none is offered here.
    const drawKeysBtn = document.getElementById('draw-keys-btn');
    const drawKeysModal = document.getElementById('draw-keys-modal');
    const closeDrawKeysModal = document.getElementById('close-draw-keys-modal');
    const drawKeysList = document.getElementById('draw-keys-list');

    function renderDrawKeysList() {
        const keyTiles = drawTiles.filter(t => t.classList.contains('boobytrap'));
        const ids = keyTiles.map(tile => {
            const row = parseInt(tile.dataset.row, 10), col = parseInt(tile.dataset.col, 10);
            return row * DRAW_SIZE + col + 1;
        }).sort((a, b) => a - b);

        const instructions = '<p style="margin:0 0 10px;font-size:0.9em;color:#555;">' +
            'Right-click a tile in the Draw grid to mark or unmark it as a Key. ' +
            'Completing every Key tile is required to unlock the END tile.</p>';
        const list = ids.length
            ? '<ul style="padding-left:18px;margin:0;">' + ids.map(id => `<li>Tile ${id}</li>`).join('') + '</ul>'
            : '<em>No Keys marked yet.</em>';
        drawKeysList.innerHTML = instructions + list;
    }

    if (drawKeysBtn && drawKeysModal && closeDrawKeysModal) {
        drawKeysBtn.onclick = () => {
            renderDrawKeysList();
            drawKeysModal.style.display = 'block';
        };
        closeDrawKeysModal.onclick = () => { drawKeysModal.style.display = 'none'; };
        window.addEventListener('click', event => {
            if (event.target === drawKeysModal) drawKeysModal.style.display = 'none';
        });
    }
    // --- END DRAW MODE ---

    // On page load, render from API
    renderMazeFromAPI();
    // Optionally, poll for live sync
    setInterval(renderMazeFromAPI, 1000);
    // --- END API-DRIVEN MAZE RENDERING ---
});
