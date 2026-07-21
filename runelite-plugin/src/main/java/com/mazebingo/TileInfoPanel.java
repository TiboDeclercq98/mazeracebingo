package com.mazebingo;

import com.google.gson.JsonObject;
import com.mazebingo.model.TileProgressResponse;
import net.runelite.client.ui.ColorScheme;
import net.runelite.client.ui.FontManager;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.plaf.basic.BasicProgressBarUI;
import java.awt.*;

class TileInfoPanel extends JPanel {

    // Caps how tall the contribution list can grow before it scrolls internally,
    // so long lists stay fully reachable instead of getting clipped by the outer panel.
    private static final int CONTRIB_MAX_HEIGHT = 140;

    private final JLabel titleLabel;
    private final JLabel taskLabel;
    private final JProgressBar progressBar;
    private final JPanel contribPanel;
    private final JScrollPane contribScrollPane;
    private Runnable onClose;

    TileInfoPanel() {
        setLayout(new BorderLayout());
        setBackground(ColorScheme.DARKER_GRAY_COLOR);
        setAlignmentX(Component.LEFT_ALIGNMENT);
        // outer EmptyBorder provides bottom gap vs tilesPanel; inner LineBorder is the visible frame
        setBorder(BorderFactory.createCompoundBorder(
            new EmptyBorder(0, 0, 6, 0),
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR)));

        // Header row
        JPanel header = new JPanel(new BorderLayout());
        header.setBackground(ColorScheme.MEDIUM_GRAY_COLOR);
        header.setBorder(new EmptyBorder(2, 6, 2, 4));

        JLabel headerLabel = new JLabel("Tile Info");
        headerLabel.setForeground(Color.WHITE);
        headerLabel.setFont(FontManager.getRunescapeSmallFont());

        JButton closeBtn = new JButton("×");
        closeBtn.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 12));
        closeBtn.setForeground(Color.LIGHT_GRAY);
        closeBtn.setBorderPainted(false);
        closeBtn.setContentAreaFilled(false);
        closeBtn.setFocusPainted(false);
        closeBtn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        closeBtn.addActionListener(e -> {
            clear();
            if (onClose != null) onClose.run();
        });

        header.add(headerLabel, BorderLayout.CENTER);
        header.add(closeBtn, BorderLayout.EAST);

        // Content panel
        JPanel content = new JPanel();
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        content.setBorder(new EmptyBorder(5, 6, 6, 6));

        titleLabel = new JLabel();
        titleLabel.setForeground(Color.WHITE);
        titleLabel.setFont(FontManager.getRunescapeSmallFont());
        titleLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

        taskLabel = new JLabel();
        taskLabel.setForeground(new Color(180, 180, 180));
        taskLabel.setFont(FontManager.getRunescapeSmallFont());
        taskLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

        progressBar = new JProgressBar(0, 100);
        progressBar.setStringPainted(true);
        progressBar.setForeground(new Color(76, 175, 80));
        progressBar.setBackground(ColorScheme.MEDIUM_GRAY_COLOR);
        progressBar.setMaximumSize(new Dimension(Integer.MAX_VALUE, 16));
        progressBar.setAlignmentX(Component.LEFT_ALIGNMENT);
        progressBar.setUI(new BasicProgressBarUI() {
            @Override protected Color getSelectionForeground() { return Color.WHITE; }
            @Override protected Color getSelectionBackground() { return Color.WHITE; }
        });

        contribPanel = new JPanel();
        contribPanel.setLayout(new BoxLayout(contribPanel, BoxLayout.Y_AXIS));
        contribPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        contribPanel.setAlignmentX(Component.LEFT_ALIGNMENT);

        contribScrollPane = new JScrollPane(contribPanel,
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        contribScrollPane.setAlignmentX(Component.LEFT_ALIGNMENT);
        contribScrollPane.setBorder(BorderFactory.createEmptyBorder());
        contribScrollPane.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        contribScrollPane.getViewport().setBackground(ColorScheme.DARKER_GRAY_COLOR);

        content.add(titleLabel);
        content.add(Box.createRigidArea(new Dimension(0, 3)));
        content.add(taskLabel);
        content.add(Box.createRigidArea(new Dimension(0, 4)));
        content.add(progressBar);
        content.add(Box.createRigidArea(new Dimension(0, 6)));
        content.add(contribScrollPane);

        add(header, BorderLayout.NORTH);
        add(content, BorderLayout.CENTER);

        setVisible(false);
    }

    void setOnClose(Runnable callback) {
        this.onClose = callback;
    }

    void showLoading(int tileId, String description) {
        titleLabel.setText("<html>Tile " + tileId + (description.isEmpty() ? "" : ": " + description) + "</html>");
        taskLabel.setText("<html>Loading…</html>");
        progressBar.setValue(0);
        progressBar.setString("…");
        contribPanel.removeAll();
        contribScrollPane.setPreferredSize(new Dimension(contribScrollPane.getPreferredSize().width, 0));
        contribScrollPane.setMaximumSize(new Dimension(Integer.MAX_VALUE, 0));
        setVisible(true);
        revalidate();
        repaint();
    }

    void showTile(TileProgressResponse data, String description, boolean isBoobytrap) {
        titleLabel.setText("<html>Tile " + data.tileId + (description.isEmpty() ? "" : ": " + description) + "</html>");
        titleLabel.setForeground(isBoobytrap ? Color.RED : Color.WHITE);

        boolean eachMode = data.taskConfig != null && data.taskConfig.isJsonObject()
            && data.taskConfig.getAsJsonObject().has("mode")
            && "each".equals(data.taskConfig.getAsJsonObject().get("mode").getAsString());

        String taskLine;
        if (data.taskConfig != null && data.taskConfig.isJsonObject()) {
            JsonObject cfg = data.taskConfig.getAsJsonObject();
            if ("npc_kill".equals(data.taskType)) {
                String npcLabel = buildListLabel(cfg, "npcs", "npc", eachMode);
                taskLine = eachMode
                    ? String.format("Kill each: %s — %,d / %,d kills", npcLabel, data.currentProgress, data.target)
                    : String.format("Kill %s — %,d / %,d kills", npcLabel, data.currentProgress, data.target);
            } else if ("xp_gain".equals(data.taskType)) {
                String skillLabel = buildListLabel(cfg, "skills", "skill", eachMode);
                if (eachMode) {
                    int perItemTarget = cfg.has("target") ? cfg.get("target").getAsInt() : data.target;
                    taskLine = String.format("Gain %,d XP each: %s — %,d / %,d", perItemTarget, skillLabel, data.currentProgress, data.target);
                } else {
                    taskLine = String.format("Gain %,d %s XP — %,d / %,d", data.target, skillLabel, data.currentProgress, data.target);
                }
            } else if ("item_drop".equals(data.taskType) || "loot_item".equals(data.taskType)) {
                String itemLabel = buildListLabel(cfg, "items", "item", eachMode);
                taskLine = eachMode
                    ? String.format("Receive each: %s — %,d / %,d", itemLabel, data.currentProgress, data.target)
                    : String.format("Receive %s — %,d / %,d", itemLabel, data.currentProgress, data.target);
            } else if ("npc_damage".equals(data.taskType)) {
                String npcLabel = buildListLabel(cfg, "npcs", "npc", eachMode);
                taskLine = eachMode
                    ? String.format("Deal damage to each: %s — %,d / %,d damage", npcLabel, data.currentProgress, data.target)
                    : String.format("Deal damage to %s — %,d / %,d damage", npcLabel, data.currentProgress, data.target);
            } else if ("clue_completion".equals(data.taskType)) {
                String tierLabel = buildListLabel(cfg, "tiers", "tier", eachMode);
                taskLine = eachMode
                    ? String.format("Complete each: %s clue(s) — %,d / %,d", tierLabel, data.currentProgress, data.target)
                    : String.format("Complete %s clue(s) — %,d / %,d", tierLabel, data.currentProgress, data.target);
            } else if ("agility_lap".equals(data.taskType)) {
                String courseLabel = buildListLabel(cfg, "courses", "course", eachMode);
                taskLine = eachMode
                    ? String.format("Complete laps of each: %s — %,d / %,d laps", courseLabel, data.currentProgress, data.target)
                    : String.format("Complete laps of %s — %,d / %,d laps", courseLabel, data.currentProgress, data.target);
            } else if ("minigame_completion".equals(data.taskType)) {
                String minigameLabel = cfg.has("minigame") ? cfg.get("minigame").getAsString()
                    : cfg.has("message") ? cfg.get("message").getAsString() : "minigame";
                taskLine = String.format("Complete %s — %,d / %,d", minigameLabel, data.currentProgress, data.target);
            } else if ("gp_value".equals(data.taskType)) {
                taskLine = String.format("Collect %,d gp — %,d / %,d gp", data.target, data.currentProgress, data.target);
            } else {
                taskLine = String.format("Progress: %,d / %,d", data.currentProgress, data.target);
            }
        } else {
            taskLine = String.format("Progress: %,d / %,d", data.currentProgress, data.target);
        }
        taskLabel.setText("<html>" + taskLine + "</html>");

        int pct = data.target > 0 ? (int) Math.min(100.0, data.currentProgress * 100.0 / data.target) : 0;
        progressBar.setValue(pct);
        progressBar.setString("xp_gain".equals(data.taskType)
            ? String.format("%,d / %,d xp", data.currentProgress, data.target)
            : "npc_damage".equals(data.taskType)
            ? String.format("%,d / %,d damage", data.currentProgress, data.target)
            : "gp_value".equals(data.taskType)
            ? String.format("%,d / %,d gp", data.currentProgress, data.target)
            : String.format("%,d / %,d", data.currentProgress, data.target));

        contribPanel.removeAll();
        if (eachMode && data.itemProgress != null && !data.itemProgress.isEmpty()) {
            for (TileProgressResponse.ItemProgress ip : data.itemProgress) {
                contribPanel.add(buildItemProgressRow(ip));
                contribPanel.add(Box.createRigidArea(new Dimension(0, 3)));
            }
            if (data.contributions != null && !data.contributions.isEmpty()) {
                contribPanel.add(Box.createRigidArea(new Dimension(0, 2)));
                for (TileProgressResponse.Contribution c : data.contributions) {
                    String text = (c.subCategory != null && !c.subCategory.isEmpty())
                        ? c.playerName + ": " + String.format("%,d", c.amount) + " " + c.subCategory
                        : c.playerName + ": " + String.format("%,d", c.amount);
                    JLabel l = new JLabel(text);
                    l.setForeground(new Color(140, 140, 140));
                    l.setFont(FontManager.getRunescapeSmallFont());
                    contribPanel.add(l);
                }
            }
        } else if (data.contributions == null || data.contributions.isEmpty()) {
            JLabel none = new JLabel("No contributions yet");
            none.setForeground(Color.GRAY);
            none.setFont(FontManager.getRunescapeSmallFont());
            contribPanel.add(none);
        } else {
            for (TileProgressResponse.Contribution c : data.contributions) {
                String text = (c.subCategory != null && !c.subCategory.isEmpty())
                    ? c.playerName + ": " + String.format("%,d", c.amount) + " " + c.subCategory
                    : c.playerName + ": " + String.format("%,d", c.amount);
                JLabel l = new JLabel(text);
                l.setForeground(new Color(170, 170, 170));
                l.setFont(FontManager.getRunescapeSmallFont());
                contribPanel.add(l);
            }
        }

        int neededHeight = contribPanel.getPreferredSize().height;
        int cappedHeight = Math.min(neededHeight, CONTRIB_MAX_HEIGHT);
        Dimension currentPref = contribScrollPane.getPreferredSize();
        contribScrollPane.setPreferredSize(new Dimension(currentPref.width, cappedHeight));
        contribScrollPane.setMaximumSize(new Dimension(Integer.MAX_VALUE, cappedHeight));
        contribScrollPane.getVerticalScrollBar().setValue(0);

        setVisible(true);
        revalidate();
        repaint();
    }

    // Joins a list field from taskConfig. In each mode, all names are comma-separated.
    // In shared mode, the last item is joined with "or".
    private static String buildListLabel(JsonObject cfg, String pluralKey, String singularKey, boolean eachMode) {
        if (cfg.has(pluralKey) && cfg.get(pluralKey).isJsonArray()) {
            java.util.List<String> names = new java.util.ArrayList<>();
            for (com.google.gson.JsonElement el : cfg.getAsJsonArray(pluralKey)) names.add(el.getAsString());
            if (!eachMode && names.size() > 1) {
                return String.join(", ", names.subList(0, names.size() - 1)) + " or " + names.get(names.size() - 1);
            }
            return String.join(", ", names);
        }
        return cfg.has(singularKey) ? cfg.get(singularKey).getAsString() : "?";
    }

    // Builds a compact name + progress-bar row for a single entry in an "each" mode tile.
    private JPanel buildItemProgressRow(TileProgressResponse.ItemProgress ip) {
        JPanel row = new JPanel(new BorderLayout(0, 1));
        row.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        row.setAlignmentX(Component.LEFT_ALIGNMENT);
        row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));

        JLabel nameLabel = new JLabel(ip.name);
        nameLabel.setForeground(new Color(200, 200, 200));
        nameLabel.setFont(FontManager.getRunescapeSmallFont());

        JProgressBar bar = new JProgressBar(0, ip.target);
        bar.setValue(ip.progress);
        bar.setStringPainted(true);
        bar.setString(String.format("%,d / %,d", ip.progress, ip.target));
        bar.setForeground(ip.progress >= ip.target ? new Color(76, 175, 80) : new Color(100, 149, 237));
        bar.setBackground(ColorScheme.MEDIUM_GRAY_COLOR);
        bar.setMaximumSize(new Dimension(Integer.MAX_VALUE, 14));
        bar.setUI(new BasicProgressBarUI() {
            @Override protected Color getSelectionForeground() { return Color.WHITE; }
            @Override protected Color getSelectionBackground() { return Color.WHITE; }
        });

        row.add(nameLabel, BorderLayout.NORTH);
        row.add(bar, BorderLayout.SOUTH);
        return row;
    }

    void clear() {
        setVisible(false);
        revalidate();
        repaint();
    }
}
