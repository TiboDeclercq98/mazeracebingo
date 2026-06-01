package com.mazebingo;

import com.google.gson.JsonObject;
import com.mazebingo.model.TileProgressResponse;
import net.runelite.client.ui.ColorScheme;
import net.runelite.client.ui.FontManager;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;

class TileInfoPanel extends JPanel {

    private final JLabel titleLabel;
    private final JLabel taskLabel;
    private final JProgressBar progressBar;
    private final JPanel contribPanel;

    TileInfoPanel() {
        setLayout(new BoxLayout(this, BoxLayout.Y_AXIS));
        setBackground(ColorScheme.DARKER_GRAY_COLOR);
        setAlignmentX(Component.LEFT_ALIGNMENT);
        setBorder(BorderFactory.createCompoundBorder(
            BorderFactory.createTitledBorder(
                BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Tile Info"),
            new EmptyBorder(2, 4, 4, 4)));

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

        contribPanel = new JPanel();
        contribPanel.setLayout(new BoxLayout(contribPanel, BoxLayout.Y_AXIS));
        contribPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        contribPanel.setAlignmentX(Component.LEFT_ALIGNMENT);

        add(titleLabel);
        add(Box.createRigidArea(new Dimension(0, 3)));
        add(taskLabel);
        add(Box.createRigidArea(new Dimension(0, 4)));
        add(progressBar);
        add(Box.createRigidArea(new Dimension(0, 6)));
        add(contribPanel);

        setVisible(false);
    }

    void showLoading(int tileId, String description) {
        titleLabel.setText("Tile " + tileId + (description.isEmpty() ? "" : ": " + description));
        taskLabel.setText("Loading…");
        progressBar.setValue(0);
        progressBar.setString("…");
        contribPanel.removeAll();
        setVisible(true);
        revalidate();
        repaint();
    }

    void showTile(TileProgressResponse data, String description) {
        titleLabel.setText("Tile " + data.tileId + (description.isEmpty() ? "" : ": " + description));

        String taskLine;
        if (data.taskConfig != null && data.taskConfig.isJsonObject()) {
            JsonObject cfg = data.taskConfig.getAsJsonObject();
            if ("npc_kill".equals(data.taskType)) {
                String npc = cfg.has("npc") ? cfg.get("npc").getAsString() : "?";
                taskLine = String.format("Kill %s — %d / %d kills", npc, data.currentProgress, data.target);
            } else if ("xp_gain".equals(data.taskType)) {
                String skill = cfg.has("skill") ? cfg.get("skill").getAsString() : "?";
                taskLine = String.format("Gain %,d %s XP — %,d / %,d", data.target, skill, data.currentProgress, data.target);
            } else if ("item_drop".equals(data.taskType)) {
                String item = cfg.has("item") ? cfg.get("item").getAsString() : "?";
                String npc  = cfg.has("npc")  ? cfg.get("npc").getAsString()  : "?";
                taskLine = "Receive " + item + " from " + npc;
            } else {
                taskLine = "Progress: " + data.currentProgress + " / " + data.target;
            }
        } else {
            taskLine = "Progress: " + data.currentProgress + " / " + data.target;
        }
        taskLabel.setText(taskLine);

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
                JLabel l = new JLabel(c.playerName + " — " + c.amount);
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
