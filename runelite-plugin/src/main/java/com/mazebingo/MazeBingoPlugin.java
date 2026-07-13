package com.mazebingo;

import com.google.gson.JsonObject;
import com.mazebingo.model.MazeState;
import com.mazebingo.model.TileProgressResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.mazebingo.model.ProgressResponse;
import com.mazebingo.model.TileData;
import net.runelite.api.ChatMessageType;
import net.runelite.api.Client;
import net.runelite.api.coords.WorldPoint;
import net.runelite.api.events.ChatMessage;
import java.awt.Color;
import net.runelite.api.GameState;
import net.runelite.api.NPC;
import net.runelite.api.Skill;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.HitsplatApplied;
import net.runelite.api.events.NpcDespawned;
import net.runelite.api.events.StatChanged;
import net.runelite.client.chat.ChatMessageManager;
import net.runelite.client.chat.QueuedMessage;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.NpcLootReceived;
import net.runelite.client.plugins.loottracker.LootReceived;
import net.runelite.client.game.ItemManager;
import net.runelite.client.game.ItemStack;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.ui.ClientToolbar;
import net.runelite.client.ui.NavigationButton;

import javax.inject.Inject;
import net.runelite.client.config.ConfigManager;
import com.google.inject.Provides;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import java.util.stream.Collectors;

@PluginDescriptor(
    name = "Maze Race Bingo",
    description = "Automatically tracks task progress for Maze Race Bingo",
    tags = {"maze", "race", "bingo", "tracker", "task"}
)
public class MazeBingoPlugin extends Plugin {

    private static final Logger log = LoggerFactory.getLogger(MazeBingoPlugin.class);

    private static final Map<String, int[][]> COURSE_ENDPOINTS;
    static {
        Map<String, int[][]> m = new java.util.LinkedHashMap<>();
        m.put("Gnome", new int[][]{{2484, 3437, 0}, {2487, 3437, 0}});
        m.put("Draynor", new int[][]{{3103, 3261, 0}});
        m.put("Al Kharid", new int[][]{{3299, 3194, 0}});
        m.put("Varrock", new int[][]{{3236, 3417, 0}});
        m.put("Barbarian", new int[][]{{2543, 3553, 0}});
        m.put("Canifis", new int[][]{{3510, 3485, 0}});
        m.put("Falador", new int[][]{{3029, 3332, 0}, {3029, 3333, 0}, {3029, 3334, 0}, {3029, 3335, 0}});
        m.put("Seers' Village", new int[][]{{2704, 3464, 0}});
        m.put("Pollnivneach", new int[][]{{3363, 2998, 0}});
        m.put("Rellekka", new int[][]{{2653, 3676, 0}});
        m.put("Ardougne", new int[][]{{2668, 3297, 0}});
        m.put("Pyramid", new int[][]{{3364, 2830, 0}});
        m.put("Wilderness", new int[][]{{2993, 3933, 0}, {2994, 3933, 0}, {2995, 3933, 0}});
        m.put("Werewolf", new int[][]{{3528, 9873, 0}});
        m.put("Prifddinas", new int[][]{{3240, 6109, 0}});
        m.put("Shayzien Basic", new int[][]{{1554, 3640, 0}});
        m.put("Shayzien Advanced", new int[][]{{1522, 3625, 0}});
        m.put("Penguin", new int[][]{{2652, 4039, 1}, {2651, 4039, 1}});
        m.put("Ape Atoll", new int[][]{{2770, 2747, 0}});
        COURSE_ENDPOINTS = java.util.Collections.unmodifiableMap(m);
    }

    @Inject private Client client;
    @Inject private MazeBingoConfig config;
    @Inject private MazeApiClient apiClient;
    @Inject private MazeBingoPanel panel;
    @Inject private ClientToolbar clientToolbar;
    @Inject private ItemManager itemManager;
    @Inject private ChatMessageManager chatMessageManager;
    @Inject private MazeEventNotificationOverlay notifOverlay;

    private final List<ActiveTile> activeTiles = new CopyOnWriteArrayList<>();
    private volatile Map<String, String> tileDescriptions = new HashMap<>();
    private volatile Set<Integer> boobyTrapTileIds = new java.util.HashSet<>();
    private volatile int selectedTileId = -1;

    public List<ActiveTile> getActiveTiles() { return activeTiles; }

    // Keyed by Skill.ordinal() — ConcurrentHashMap since event handlers run on client thread
    // but snapshotXp() can be called from executor thread
    private final Map<Integer, Integer> xpSnapshot = new ConcurrentHashMap<>();

    // NPC kill tracking: npcIndex → NPC reference for every NPC the player has hit
    private final Map<Integer, NPC> attackedNpcs = new HashMap<>();

    // Dedup: "tileId:itemName" → game tick of last submit; prevents double-counting when
    // both onNpcLootReceived and onLootReceived fire for the same NPC kill
    private final Map<String, Integer> recentSubmits = new HashMap<>();

    private ScheduledExecutorService executor;
    private ScheduledFuture<?> pollTask;
    private ScheduledFuture<?> versionPollTask;
    private volatile String lastKnownVersion = null;
    private NavigationButton navButton;

    private volatile int lastSeenEventId = 0;
    private volatile boolean eventsInitialized = false;

    @Override
    protected void startUp() {
        SoundGenerator.ensureSoundsDirExists();
        executor = Executors.newSingleThreadScheduledExecutor();
        panel.setOnRefresh(() -> executor.execute(this::refreshMazeState));
        panel.setOnTileClick(tile -> {
            if (selectedTileId == tile.id) {
                selectedTileId = -1;
                panel.hideTileInfo();
                return;
            }
            selectedTileId = tile.id;
            panel.setSelectedTileOnMap(tile.id);
            String desc = tileDescriptions.getOrDefault(String.valueOf(tile.id), "");
            panel.showTileInfoLoading(tile.id, desc);
            String apiUrl = config.apiUrl();
            String team = config.teamName();
            executor.execute(() -> {
                TileProgressResponse resp = apiClient.fetchTileProgress(apiUrl, tile.id, team);
                if (resp != null) {
                    boolean isBoobytrap = tile.completed && boobyTrapTileIds.contains(tile.id);
                    panel.showTileInfo(resp, desc, isBoobytrap);
                }
            });
        });
        panel.setOnTileInfoClose(() -> {
            selectedTileId = -1;
            panel.hideTileInfo();
        });

        navButton = NavigationButton.builder()
            .tooltip("Maze Race Bingo")
            .icon(buildIcon())
            .priority(5)
            .panel(panel)
            .build();
        clientToolbar.addNavigation(navButton);

        if (client.getGameState() == GameState.LOGGED_IN) {
            executor.execute(this::refreshMazeState);
            snapshotXp();
        }

        pollTask = executor.scheduleAtFixedRate(this::refreshMazeState, 60, 60, TimeUnit.SECONDS);
        versionPollTask = executor.scheduleAtFixedRate(this::checkStateVersion, 10, 10, TimeUnit.SECONDS);
    }

    @Override
    protected void shutDown() {
        if (pollTask != null) {
            pollTask.cancel(false);
        }
        if (versionPollTask != null) {
            versionPollTask.cancel(false);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        clientToolbar.removeNavigation(navButton);
        panel.setOnRefresh(null);
        activeTiles.clear();
        xpSnapshot.clear();
        attackedNpcs.clear();
        recentSubmits.clear();
        lastKnownVersion = null;
        lastSeenEventId = 0;
        eventsInitialized = false;
        panel.clear();
    }

    @Subscribe
    public void onGameStateChanged(GameStateChanged event) {
        if (event.getGameState() == GameState.LOGGED_IN) {
            lastKnownVersion = null;
            executor.execute(this::refreshMazeState);
            // Don't call snapshotXp() here — stats aren't fully loaded yet when
            // LOGGED_IN fires, so the client returns 0 for unloaded skills. The
            // onStatChanged -1 guard handles initialization safely instead.
        } else if (event.getGameState() == GameState.LOGIN_SCREEN
            || event.getGameState() == GameState.HOPPING) {
            activeTiles.clear();
            xpSnapshot.clear();
            attackedNpcs.clear();
            recentSubmits.clear();
            selectedTileId = -1;
            lastKnownVersion = null;
            lastSeenEventId = 0;
            eventsInitialized = false;
            panel.clear();
        }
    }

    // --- XP gain ---

    @Subscribe
    public void onStatChanged(StatChanged event) {
        int key = event.getSkill().ordinal();
        int previous = xpSnapshot.getOrDefault(key, -1);
        if (previous < 0) {
            xpSnapshot.put(key, event.getXp());
            return;
        }

        int gained = event.getXp() - previous;
        xpSnapshot.put(key, event.getXp());
        if (gained <= 0) return;

        String skillName = event.getSkill().getName();
        List<ActiveTile> matches = matchingTiles("xp_gain", cfg -> {
            if (cfg.has("skills") && cfg.get("skills").isJsonArray()) {
                for (com.google.gson.JsonElement el : cfg.getAsJsonArray("skills")) {
                    if (skillName.equalsIgnoreCase(el.getAsString())) return true;
                }
                return false;
            }
            return cfg.has("skill") && skillName.equalsIgnoreCase(cfg.get("skill").getAsString());
        });

        for (ActiveTile tile : matches) {
            submitProgress(tile, gained, skillName);
        }

        if (event.getSkill() == Skill.AGILITY) {
            checkAgilityLap();
        }
    }

    private void checkAgilityLap() {
        if (client.getLocalPlayer() == null) return;
        WorldPoint loc = client.getLocalPlayer().getWorldLocation();
        for (Map.Entry<String, int[][]> entry : COURSE_ENDPOINTS.entrySet()) {
            for (int[] ep : entry.getValue()) {
                if (loc.getX() == ep[0] && loc.getY() == ep[1] && loc.getPlane() == ep[2]) {
                    String courseName = entry.getKey();
                    log.info("Agility lap detected: course='{}'", courseName);
                    List<ActiveTile> matches = matchingTiles("agility_lap",
                        cfg -> courseMatchesTile(cfg, courseName));
                    for (ActiveTile tile : matches) {
                        submitProgress(tile, 1, courseName);
                    }
                    return;
                }
            }
        }
    }

    private static boolean courseMatchesTile(JsonObject cfg, String courseName) {
        if (cfg.has("courses") && cfg.get("courses").isJsonArray()) {
            for (com.google.gson.JsonElement el : cfg.getAsJsonArray("courses")) {
                if (courseName.toLowerCase().contains(el.getAsString().toLowerCase())) return true;
            }
            return false;
        }
        if (!cfg.has("course")) return true;
        return courseName.toLowerCase().contains(cfg.get("course").getAsString().toLowerCase());
    }

    // --- NPC kills ---

    @Subscribe
    public void onHitsplatApplied(HitsplatApplied event) {
        if (!(event.getActor() instanceof NPC)) return;
        if (!event.getHitsplat().isMine()) return;
        NPC npc = (NPC) event.getActor();
        attackedNpcs.put(npc.getIndex(), npc);
    }

    @Subscribe
    public void onGameTick(GameTick event) {
        checkDeadNpcs();
    }

    private void checkDeadNpcs() {
        recentSubmits.entrySet().removeIf(e -> client.getTickCount() - e.getValue() > 1);
        Iterator<Map.Entry<Integer, NPC>> it = attackedNpcs.entrySet().iterator();
        while (it.hasNext()) {
            NPC npc = it.next().getValue();
            if (!npc.isDead()) continue;
            it.remove();
            String npcName = npc.getName();
            if (npcName == null) continue;
            log.info("Kill detected: npcName='{}'", npcName);
            List<ActiveTile> matches = matchingTiles("npc_kill", cfg -> {
                if (cfg.has("npcs") && cfg.get("npcs").isJsonArray()) {
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("npcs")) {
                        if (npcName.equalsIgnoreCase(el.getAsString())) return true;
                    }
                    return false;
                }
                return cfg.has("npc") && npcName.equalsIgnoreCase(cfg.get("npc").getAsString());
            });
            log.info("Matched {} tile(s) for npc_kill '{}'", matches.size(), npcName);
            if (matches.isEmpty()) {
                // Tile may have just been revealed but not yet loaded — refresh and retry once
                executor.execute(() -> {
                    refreshMazeState();
                    List<ActiveTile> retry = matchingTiles("npc_kill", cfg -> {
                        if (cfg.has("npcs") && cfg.get("npcs").isJsonArray()) {
                            for (com.google.gson.JsonElement el : cfg.getAsJsonArray("npcs")) {
                                if (npcName.equalsIgnoreCase(el.getAsString())) return true;
                            }
                            return false;
                        }
                        return cfg.has("npc") && npcName.equalsIgnoreCase(cfg.get("npc").getAsString());
                    });
                    log.info("Retry matched {} tile(s) for npc_kill '{}'", retry.size(), npcName);
                    for (ActiveTile tile : retry) {
                        submitProgress(tile, 1, npcName);
                    }
                });
            } else {
                for (ActiveTile tile : matches) {
                    submitProgress(tile, 1, npcName);
                }
            }
        }
    }

    @Subscribe
    public void onNpcDespawned(NpcDespawned event) {
        attackedNpcs.remove(event.getNpc().getIndex());
    }

    // --- Agility laps & minigame completions ---

    @Subscribe
    public void onChatMessage(ChatMessage event) {
        ChatMessageType type = event.getType();
        if (type != ChatMessageType.SPAM && type != ChatMessageType.GAMEMESSAGE) return;

        String msg = event.getMessage().replaceAll("<[^>]*>", "");

        List<ActiveTile> minigameMatches = matchingTiles("minigame_completion", cfg -> {
            if (!cfg.has("message")) return false;
            return msg.toLowerCase().contains(cfg.get("message").getAsString().toLowerCase());
        });
        for (ActiveTile tile : minigameMatches) {
            String minigameName = tile.taskConfig.has("minigame")
                ? tile.taskConfig.get("minigame").getAsString() : null;
            submitProgress(tile, 1, minigameName);
        }
    }

    // --- Item drops / chest loot ---

    @Subscribe
    public void onNpcLootReceived(NpcLootReceived event) {
        for (ItemStack stack : event.getItems()) {
            String itemName = itemManager.getItemComposition(stack.getId()).getName();
            List<ActiveTile> matches = matchingTiles("item_drop", cfg -> {
                if (cfg.has("items") && cfg.get("items").isJsonArray()) {
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("items")) {
                        if (itemName.equalsIgnoreCase(el.getAsString())) return true;
                    }
                    return false;
                }
                return cfg.has("item") && itemName.equalsIgnoreCase(cfg.get("item").getAsString());
            });
            for (ActiveTile tile : matches) {
                submitProgress(tile, stack.getQuantity(), itemName);
            }
        }
        submitGpValue(event.getItems());
    }

    @Subscribe
    public void onLootReceived(LootReceived event) {
        for (ItemStack stack : event.getItems()) {
            String itemName = itemManager.getItemComposition(stack.getId()).getName();
            List<ActiveTile> matches = matchingTiles("item_drop", cfg -> {
                if (cfg.has("items") && cfg.get("items").isJsonArray()) {
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("items")) {
                        if (itemName.equalsIgnoreCase(el.getAsString())) return true;
                    }
                    return false;
                }
                return cfg.has("item") && itemName.equalsIgnoreCase(cfg.get("item").getAsString());
            });
            for (ActiveTile tile : matches) {
                submitProgress(tile, stack.getQuantity(), itemName);
            }
        }
        submitGpValue(event.getItems());
    }

    private void submitGpValue(Collection<ItemStack> items) {
        List<ActiveTile> gpTiles = matchingTiles("gp_value", cfg -> true);
        if (gpTiles.isEmpty()) return;
        int totalGp = 0;
        for (ItemStack stack : items) {
            totalGp += itemManager.getItemPrice(stack.getId()) * stack.getQuantity();
        }
        if (totalGp <= 0) return;
        for (ActiveTile tile : gpTiles) {
            submitProgress(tile, totalGp, "gp");
        }
    }

    // --- Internal helpers ---

    private void submitProgress(ActiveTile tile, int amount, String subCategory) {
        if (client.getLocalPlayer() == null) return;
        String playerName = client.getLocalPlayer().getName();
        if (playerName == null) return;

        String apiUrl = config.apiUrl();
        String team = config.teamName();
        if (team.isEmpty()) return;

        String dedupKey = tile.id + ":" + subCategory;
        int currentTick = client.getTickCount();
        Integer lastTick = recentSubmits.get(dedupKey);
        if (lastTick != null && currentTick - lastTick <= 1) return;
        recentSubmits.put(dedupKey, currentTick);

        executor.execute(() -> {
            ProgressResponse response = apiClient.postProgress(apiUrl, tile.id, playerName, amount, team, subCategory);
            if (response == null) {
                log.warn("Progress submit for tile {} returned null (API error)", tile.id);
                return;
            }

            if (response.error != null) {
                log.warn("Progress submit for tile {} returned error: {}", tile.id, response.error);
                sendChatMessage("<col=ff0000>" + response.error + "</col>");
                refreshMazeState();
                return;
            }

            log.info("Progress tile {}: progress={}/{} completed={}", tile.id, response.progress, response.target, response.completed);

            String suffix = "xp_gain".equals(tile.taskType) ? " xp"
                : "npc_kill".equals(tile.taskType) ? (amount == 1 ? " kill" : " kills")
                : "agility_lap".equals(tile.taskType) ? " lap"
                : "minigame_completion".equals(tile.taskType) ? " completion"
                : "";
            String contrib = amount + (subCategory != null ? " " + subCategory : "") + suffix;
            sendChatMessage("You contributed " + contrib + " to tile " + tile.id + ".");

            if (response.completed) {
                sendChatMessage("<col=00ff00>You've completed tile " + tile.id + "!</col>");
            }

            if (response.specialEvent != null && response.specialEvent.isJsonObject()) {
                JsonObject se = response.specialEvent.getAsJsonObject();
                if (se.has("message")) {
                    String seMsg = se.get("message").getAsString();
                    String seType = se.has("type") ? se.get("type").getAsString() : "";
                    String seColor = "gameover".equals(seType) ? "ff0000" : "ffcc00";
                    sendChatMessage("<col=" + seColor + ">" + seMsg + "</col>");
                }
            }

            for (int i = 0; i < activeTiles.size(); i++) {
                ActiveTile t = activeTiles.get(i);
                if (t.id == tile.id) {
                    activeTiles.set(i, new ActiveTile(
                        t.id, t.tileIndex, t.taskType, t.taskConfig,
                        response.progress, response.target, t.description));
                    break;
                }
            }
            panel.updateTiles(activeTiles);
            refreshMazeState();
            String v = apiClient.fetchStateVersion(apiUrl, team);
            if (v != null) lastKnownVersion = v;
        });
    }

    private void checkStateVersion() {
        if (client.getGameState() != GameState.LOGGED_IN) return;
        String team = config.teamName();
        if (team.isEmpty()) return;
        String version = apiClient.fetchStateVersion(config.apiUrl(), team);
        if (version == null) return;
        if (lastKnownVersion == null) {
            // First check after startup/login — prime the version without a redundant refresh.
            lastKnownVersion = version;
            return;
        }
        if (!version.equals(lastKnownVersion)) {
            lastKnownVersion = version;
            refreshMazeState();
        }
    }

    private void sendChatMessage(String message) {
        chatMessageManager.queue(QueuedMessage.builder()
            .type(ChatMessageType.GAMEMESSAGE)
            .runeLiteFormattedMessage(message)
            .build());
    }

    void refreshMazeState() {
        String apiUrl = config.apiUrl();
        String team = config.teamName();
        if (team.isEmpty()) {
            panel.setStatus("No team configured");
            return;
        }

        MazeState state = apiClient.fetchMazeState(apiUrl, team);
        if (state == null) {
            panel.setStatus("Disconnected");
            return;
        }

        log.info("Maze state: size={}, tiles={}, gameOver={}", state.size, state.tiles == null ? "null" : state.tiles.size(), state.gameOver);

        if (state.tileDescriptions != null) {
            tileDescriptions = state.tileDescriptions;
        }

        if (state.boobytraps != null && state.size > 0) {
            Set<Integer> ids = new java.util.HashSet<>();
            for (com.mazebingo.model.MazeState.BoobyTrapPos b : state.boobytraps) {
                ids.add(b.row * state.size + b.col + 1);
            }
            boobyTrapTileIds = ids;
        }

        Set<Integer> revealed = MazeRevealCalculator.computeRevealed(state);
        log.info("Revealed indices: {}", revealed);

        List<ActiveTile> newActive = new ArrayList<>();
        for (int i = 0; i < state.tiles.size(); i++) {
            TileData t = state.tiles.get(i);
            if (t == null) { log.info("Tile at index {} is null", i); continue; }
            if (t.completed) continue;
            if (!revealed.contains(i)) continue;
            if (t.taskType == null) { log.info("Tile {} (index {}) skipped: taskType is null", t.id, i); continue; }
            log.info("Adding tile {} (index {}), taskType={}", t.id, i, t.taskType);

            String desc = "";
            if (state.tileDescriptions != null) {
                desc = state.tileDescriptions.getOrDefault(String.valueOf(t.id), "");
            }

            int req = t.completionsRequired > 0 ? t.completionsRequired : 1;
            JsonObject cfg = (t.taskConfig != null && t.taskConfig.isJsonObject())
                ? t.taskConfig.getAsJsonObject() : null;
            newActive.add(new ActiveTile(t.id, i, t.taskType, cfg,
                t.completionsDone, req, desc));
        }

        activeTiles.clear();
        activeTiles.addAll(newActive);
        panel.setStatus("Connected");
        panel.updateMazeState(state);
        panel.updateTiles(activeTiles);

        if (state.recentEvents != null) {
            if (!eventsInitialized) {
                for (com.mazebingo.model.MazeEventEntry e : state.recentEvents) {
                    if (e.id > lastSeenEventId) lastSeenEventId = e.id;
                }
                eventsInitialized = true;
            } else {
                for (com.mazebingo.model.MazeEventEntry e : state.recentEvents) {
                    if (e.id > lastSeenEventId) {
                        Color color = "tile_complete".equals(e.type) ? Color.WHITE
                            : "keys_missing".equals(e.type) ? Color.RED
                            : "gameover".equals(e.type) ? new Color(76, 175, 80)
                            : new Color(255, 204, 0);
                        panel.addEvent(e.message, color);
                        notifOverlay.addNotification(e.message, color);
                        lastSeenEventId = e.id;
                    }
                }
            }
        }

        int selId = selectedTileId;
        if (selId >= 0) {
            String desc = tileDescriptions.getOrDefault(String.valueOf(selId), "");
            TileData selTile = state.tiles.stream().filter(t -> t.id == selId).findFirst().orElse(null);
            boolean isBoobytrap = selTile != null && selTile.completed && boobyTrapTileIds.contains(selId);
            TileProgressResponse resp = apiClient.fetchTileProgress(apiUrl, selId, team);
            if (resp != null) {
                panel.showTileInfo(resp, desc, isBoobytrap);
            }
        }
    }

    private void snapshotXp() {
        for (Skill skill : Skill.values()) {
            xpSnapshot.put(skill.ordinal(), client.getSkillExperience(skill));
        }
    }

    private List<ActiveTile> matchingTiles(String taskType, Predicate<JsonObject> configMatcher) {
        return activeTiles.stream()
            .filter(t -> taskType.equals(t.taskType))
            .filter(t -> t.taskConfig != null && configMatcher.test(t.taskConfig))
            .collect(Collectors.toList());
    }

    @Provides
    MazeBingoConfig provideConfig(ConfigManager configManager) {
        return configManager.getConfig(MazeBingoConfig.class);
    }

    private static BufferedImage buildIcon() {
        BufferedImage icon = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = icon.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(76, 175, 80));
        g.fillRoundRect(0, 0, 15, 15, 4, 4);
        g.setColor(Color.WHITE);
        g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 8));
        g.drawString("MB", 2, 11);
        g.dispose();
        return icon;
    }
}
