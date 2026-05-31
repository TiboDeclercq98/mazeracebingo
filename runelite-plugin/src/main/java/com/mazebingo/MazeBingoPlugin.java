package com.mazebingo;

import com.google.gson.JsonObject;
import com.mazebingo.model.MazeState;
import com.mazebingo.model.ProgressResponse;
import com.mazebingo.model.TileData;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.InventoryID;
import net.runelite.api.Item;
import net.runelite.api.NPC;
import net.runelite.api.Player;
import net.runelite.api.Skill;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.ItemContainerChanged;
import net.runelite.api.events.NpcDespawned;
import net.runelite.api.events.StatChanged;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.game.ItemManager;
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
import java.util.HashMap;
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

@Slf4j
@PluginDescriptor(
    name = "Maze Bingo",
    description = "Automatically tracks task progress for Maze Race Bingo",
    tags = {"maze", "bingo", "tracker", "task"}
)
public class MazeBingoPlugin extends Plugin {

    private static final int KILL_TICK_WINDOW = 5;

    @Inject private Client client;
    @Inject private MazeBingoConfig config;
    @Inject private MazeApiClient apiClient;
    @Inject private MazeBingoPanel panel;
    @Inject private ClientToolbar clientToolbar;
    @Inject private ItemManager itemManager;

    @Getter
    private final List<ActiveTile> activeTiles = new CopyOnWriteArrayList<>();

    // Keyed by Skill.ordinal() — ConcurrentHashMap since event handlers run on client thread
    // but snapshotXp() can be called from executor thread
    private final Map<Integer, Integer> xpSnapshot = new ConcurrentHashMap<>();

    // NPC kill tracking: npcIndex → game tick on which we last attacked it
    private final Map<Integer, Integer> attackedNpcTicks = new HashMap<>();
    private int currentTick = 0;

    // Item drop tracking: previous inventory state
    private Item[] previousInventory = null;

    private ScheduledExecutorService executor;
    private ScheduledFuture<?> pollTask;
    private NavigationButton navButton;

    @Override
    protected void startUp() {
        executor = Executors.newSingleThreadScheduledExecutor();

        navButton = NavigationButton.builder()
            .tooltip("Maze Bingo")
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
    }

    @Override
    protected void shutDown() {
        if (pollTask != null) {
            pollTask.cancel(false);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        clientToolbar.removeNavigation(navButton);
        activeTiles.clear();
        xpSnapshot.clear();
        attackedNpcTicks.clear();
        previousInventory = null;
        panel.clear();
    }

    @Subscribe
    public void onGameStateChanged(GameStateChanged event) {
        if (event.getGameState() == GameState.LOGGED_IN) {
            executor.execute(this::refreshMazeState);
            snapshotXp();
        } else if (event.getGameState() == GameState.LOGIN_SCREEN
            || event.getGameState() == GameState.HOPPING) {
            activeTiles.clear();
            xpSnapshot.clear();
            attackedNpcTicks.clear();
            previousInventory = null;
            panel.clear();
        }
    }

    // --- XP gain ---

    @Subscribe
    public void onStatChanged(StatChanged event) {
        if (!config.autoSubmit()) return;

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
        List<ActiveTile> matches = matchingTiles("xp_gain", cfg ->
            cfg.has("skill") && skillName.equalsIgnoreCase(cfg.get("skill").getAsString()));

        for (ActiveTile tile : matches) {
            submitProgress(tile, gained);
        }
    }

    // --- NPC kills ---

    @Subscribe
    public void onGameTick(GameTick event) {
        currentTick++;
        if (!config.autoSubmit()) return;
        Player local = client.getLocalPlayer();
        if (local == null) return;
        Actor target = local.getInteracting();
        if (target instanceof NPC) {
            attackedNpcTicks.put(((NPC) target).getIndex(), currentTick);
        }
    }

    @Subscribe
    public void onNpcDespawned(NpcDespawned event) {
        if (!config.autoSubmit()) return;
        NPC npc = event.getNpc();
        Integer lastAttackTick = attackedNpcTicks.remove(npc.getIndex());
        if (lastAttackTick == null) return;
        if (currentTick - lastAttackTick > KILL_TICK_WINDOW) return;

        String npcName = npc.getName();
        if (npcName == null) return;

        List<ActiveTile> matches = matchingTiles("npc_kill", cfg ->
            cfg.has("npc") && npcName.equalsIgnoreCase(cfg.get("npc").getAsString()));
        for (ActiveTile tile : matches) {
            submitProgress(tile, 1);
        }
    }

    // --- Item drops ---

    @Subscribe
    public void onItemContainerChanged(ItemContainerChanged event) {
        if (!config.autoSubmit()) return;
        if (event.getContainerId() != InventoryID.INVENTORY.getId()) return;

        Item[] current = event.getItemContainer().getItems();
        if (previousInventory == null) {
            previousInventory = current.clone();
            return;
        }

        Map<Integer, Integer> before = toItemMap(previousInventory);
        Map<Integer, Integer> after = toItemMap(current);
        previousInventory = current.clone();

        for (Map.Entry<Integer, Integer> entry : after.entrySet()) {
            int itemId = entry.getKey();
            int gained = entry.getValue() - before.getOrDefault(itemId, 0);
            if (gained <= 0) continue;

            String itemName = itemManager.getItemComposition(itemId).getName();
            List<ActiveTile> matches = matchingTiles("item_drop", cfg ->
                cfg.has("item") && itemName.equalsIgnoreCase(cfg.get("item").getAsString()));
            for (ActiveTile tile : matches) {
                submitProgress(tile, gained);
            }
        }
    }

    // --- Internal helpers ---

    private void submitProgress(ActiveTile tile, int amount) {
        if (client.getLocalPlayer() == null) return;
        String playerName = client.getLocalPlayer().getName();
        if (playerName == null) return;

        String apiUrl = config.apiUrl();
        String team = config.teamName();
        if (team.isEmpty()) return;

        executor.execute(() -> {
            ProgressResponse response = apiClient.postProgress(apiUrl, tile.id, playerName, amount, team);
            panel.addActivity(tile, amount);
            if (response != null && response.completed) {
                refreshMazeState();
            }
        });
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

        Set<Integer> revealed = MazeRevealCalculator.computeRevealed(state);

        List<ActiveTile> newActive = new ArrayList<>();
        for (int i = 0; i < state.tiles.size(); i++) {
            TileData t = state.tiles.get(i);
            if (t.completed) continue;
            if (!revealed.contains(i)) continue;
            if (t.taskType == null) continue;

            String desc = "";
            if (state.tileDescriptions != null) {
                desc = state.tileDescriptions.getOrDefault(String.valueOf(t.id), "");
            }

            int req = t.completionsRequired > 0 ? t.completionsRequired : 1;
            newActive.add(new ActiveTile(t.id, i, t.taskType, t.taskConfig,
                t.completionsDone, req, desc));
        }

        activeTiles.clear();
        activeTiles.addAll(newActive);
        panel.setStatus("Connected");
        panel.updateTiles(activeTiles);
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

    private static Map<Integer, Integer> toItemMap(Item[] items) {
        Map<Integer, Integer> map = new HashMap<>();
        for (Item item : items) {
            if (item.getId() >= 0) {
                map.merge(item.getId(), item.getQuantity(), Integer::sum);
            }
        }
        return map;
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
