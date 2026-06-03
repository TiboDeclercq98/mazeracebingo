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

    private final JLabel titleLabel;
    private final JLabel taskLabel;
    private final JProgressBar progressBar;
    private final JPanel contribPanel;
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

        content.add(titleLabel);
        content.add(Box.createRigidArea(new Dimension(0, 3)));
        content.add(taskLabel);
        content.add(Box.createRigidArea(new Dimension(0, 4)));
        content.add(progressBar);
        content.add(Box.createRigidArea(new Dimension(0, 6)));
        content.add(contribPanel);

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
        setVisible(true);
        revalidate();
        repaint();
    }

    void showTile(TileProgressResponse data, String description, boolean isBoobytrap) {
        titleLabel.setText("<html>Tile " + data.tileId + (description.isEmpty() ? "" : ": " + description) + "</html>");
        titleLabel.setForeground(isBoobytrap ? Color.RED : Color.WHITE);

        String taskLine;
        if (data.taskConfig != null && data.taskConfig.isJsonObject()) {
            JsonObject cfg = data.taskConfig.getAsJsonObject();
            if ("npc_kill".equals(data.taskType)) {
                String npcLabel;
                if (cfg.has("npcs") && cfg.get("npcs").isJsonArray()) {
                    java.util.List<String> names = new java.util.ArrayList<>();
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("npcs")) names.add(el.getAsString());
                    if (names.size() > 1) npcLabel = String.join(", ", names.subList(0, names.size() - 1)) + " or " + names.get(names.size() - 1);
                    else npcLabel = names.get(0);
                } else {
                    npcLabel = cfg.has("npc") ? cfg.get("npc").getAsString() : "?";
                }
                taskLine = String.format("Kill %s — %d / %d kills", npcLabel, data.currentProgress, data.target);
            } else if ("xp_gain".equals(data.taskType)) {
                String skillLabel;
                if (cfg.has("skills") && cfg.get("skills").isJsonArray()) {
                    java.util.List<String> names = new java.util.ArrayList<>();
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("skills")) names.add(el.getAsString());
                    if (names.size() > 1) skillLabel = String.join(", ", names.subList(0, names.size() - 1)) + " or " + names.get(names.size() - 1);
                    else skillLabel = names.get(0);
                } else {
                    skillLabel = cfg.has("skill") ? cfg.get("skill").getAsString() : "?";
                }
                taskLine = String.format("Gain %,d %s XP — %,d / %,d", data.target, skillLabel, data.currentProgress, data.target);
            } else if ("item_drop".equals(data.taskType)) {
                String itemLabel;
                if (cfg.has("items") && cfg.get("items").isJsonArray()) {
                    java.util.List<String> names = new java.util.ArrayList<>();
                    for (com.google.gson.JsonElement el : cfg.getAsJsonArray("items")) names.add(el.getAsString());
                    if (names.size() > 1) itemLabel = String.join(", ", names.subList(0, names.size() - 1)) + " or " + names.get(names.size() - 1);
                    else itemLabel = names.get(0);
                } else {
                    itemLabel = cfg.has("item") ? cfg.get("item").getAsString() : "?";
                }
                taskLine = "Receive " + itemLabel + " — " + data.currentProgress + " / " + data.target;
            } else {
                taskLine = "Progress: " + data.currentProgress + " / " + data.target;
            }
        } else {
            taskLine = "Progress: " + data.currentProgress + " / " + data.target;
        }
        taskLabel.setText("<html>" + taskLine + "</html>");

        int pct = data.target > 0 ? (int) Math.min(100.0, data.currentProgress * 100.0 / data.target) : 0;
        progressBar.setValue(pct);
        progressBar.setString("xp_gain".equals(data.taskType)
            ? String.format("%,d / %,d xp", data.currentProgress, data.target)
            : data.currentProgress + " / " + data.target);

        contribPanel.removeAll();
        if (data.contributions == null || data.contributions.isEmpty()) {
            JLabel none = new JLabel("No contributions yet");
            none.setForeground(Color.GRAY);
            none.setFont(FontManager.getRunescapeSmallFont());
            contribPanel.add(none);
        } else {
            for (TileProgressResponse.Contribution c : data.contributions) {
                String text = (c.subCategory != null && !c.subCategory.isEmpty())
                    ? c.playerName + ": " + c.amount + " " + c.subCategory
                    : c.playerName + ": " + c.amount;
                JLabel l = new JLabel(text);
                l.setForeground(new Color(170, 170, 170));
                l.setFont(FontManager.getRunescapeSmallFont());
                contribPanel.add(l);
            }
        }

        setVisible(true);
        revalidate();
        repaint();
    }

    void clear() {
        setVisible(false);
        revalidate();
        repaint();
    }
}
