package com.mazebingo;

import net.runelite.client.ui.ColorScheme;
import net.runelite.client.ui.FontManager;
import net.runelite.client.ui.PluginPanel;

import javax.inject.Inject;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

public class MazeBingoPanel extends PluginPanel {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm:ss");
    private static final int MAX_LOG_LINES = 20;

    private final JLabel statusLabel;
    private final JPanel tilesPanel;
    private final DefaultListModel<String> activityModel;
    private Runnable onRefresh;

    @Inject
    MazeBingoPanel() {
        setLayout(new BorderLayout(0, 6));
        setBorder(new EmptyBorder(10, 10, 10, 10));
        setBackground(ColorScheme.DARK_GRAY_COLOR);

        JLabel title = new JLabel("Maze Bingo");
        title.setFont(FontManager.getRunescapeBoldFont());
        title.setForeground(Color.WHITE);

        statusLabel = new JLabel("● Not connected");
        statusLabel.setFont(FontManager.getRunescapeSmallFont());
        statusLabel.setForeground(Color.RED);

        JButton refreshButton = new JButton("Refresh");
        refreshButton.setFont(FontManager.getRunescapeSmallFont());
        refreshButton.setFocusPainted(false);
        refreshButton.addActionListener(e -> {
            if (onRefresh != null) onRefresh.run();
        });

        JPanel topRow = new JPanel(new BorderLayout(6, 0));
        topRow.setBackground(ColorScheme.DARK_GRAY_COLOR);
        topRow.add(title, BorderLayout.CENTER);
        topRow.add(refreshButton, BorderLayout.EAST);

        JPanel headerPanel = new JPanel(new BorderLayout(0, 2));
        headerPanel.setBackground(ColorScheme.DARK_GRAY_COLOR);
        headerPanel.add(topRow, BorderLayout.NORTH);
        headerPanel.add(statusLabel, BorderLayout.SOUTH);

        tilesPanel = new JPanel();
        tilesPanel.setLayout(new BoxLayout(tilesPanel, BoxLayout.Y_AXIS));
        tilesPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);

        JScrollPane tilesScroll = new JScrollPane(tilesPanel);
        tilesScroll.setBorder(BorderFactory.createTitledBorder(
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Active Tasks"));
        tilesScroll.getViewport().setBackground(ColorScheme.DARKER_GRAY_COLOR);
        tilesScroll.setPreferredSize(new Dimension(0, 250));

        activityModel = new DefaultListModel<>();
        JList<String> activityList = new JList<>(activityModel);
        activityList.setFont(FontManager.getRunescapeSmallFont());
        activityList.setForeground(Color.LIGHT_GRAY);
        activityList.setBackground(ColorScheme.DARKER_GRAY_COLOR);

        JScrollPane activityScroll = new JScrollPane(activityList);
        activityScroll.setBorder(BorderFactory.createTitledBorder(
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Recent Activity"));
        activityScroll.getViewport().setBackground(ColorScheme.DARKER_GRAY_COLOR);
        activityScroll.setPreferredSize(new Dimension(0, 130));

        add(headerPanel, BorderLayout.NORTH);
        add(tilesScroll, BorderLayout.CENTER);
        add(activityScroll, BorderLayout.SOUTH);
    }

    void setOnRefresh(Runnable callback) {
        this.onRefresh = callback;
    }

    void setStatus(String message) {
        SwingUtilities.invokeLater(() -> {
            boolean connected = "Connected".equals(message);
            statusLabel.setText("● " + message);
            statusLabel.setForeground(connected ? new Color(76, 175, 80) : Color.RED);
        });
    }

    void updateTiles(List<ActiveTile> tiles) {
        SwingUtilities.invokeLater(() -> {
            tilesPanel.removeAll();
            if (tiles.isEmpty()) {
                JLabel empty = new JLabel("No active tasks");
                empty.setForeground(Color.GRAY);
                empty.setFont(FontManager.getRunescapeSmallFont());
                empty.setBorder(new EmptyBorder(6, 6, 6, 6));
                tilesPanel.add(empty);
            } else {
                for (ActiveTile tile : tiles) {
                    tilesPanel.add(buildTileRow(tile));
                    tilesPanel.add(Box.createRigidArea(new Dimension(0, 2)));
                }
            }
            tilesPanel.revalidate();
            tilesPanel.repaint();
        });
    }

    void addActivity(ActiveTile tile, int amount) {
        SwingUtilities.invokeLater(() -> {
            String line = String.format("[%s] Tile %d +%s",
                LocalTime.now().format(TIME_FMT),
                tile.id,
                formatAmount(tile.taskType, amount));
            activityModel.add(0, line);
            while (activityModel.size() > MAX_LOG_LINES) {
                activityModel.remove(activityModel.size() - 1);
            }
        });
    }

    void clear() {
        SwingUtilities.invokeLater(() -> {
            tilesPanel.removeAll();
            tilesPanel.revalidate();
            tilesPanel.repaint();
            activityModel.clear();
            statusLabel.setText("● Not connected");
            statusLabel.setForeground(Color.RED);
        });
    }

    private JPanel buildTileRow(ActiveTile tile) {
        JPanel row = new JPanel(new BorderLayout(0, 3));
        row.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        row.setBorder(new EmptyBorder(5, 6, 5, 6));
        row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 55));

        JLabel nameLabel = new JLabel("Tile " + tile.id + ": " + tile.description);
        nameLabel.setForeground(Color.WHITE);
        nameLabel.setFont(FontManager.getRunescapeSmallFont());

        int req = tile.completionsRequired > 0 ? tile.completionsRequired : 1;
        int pct = (int) Math.min(100.0, (tile.completionsDone * 100.0) / req);

        JProgressBar bar = new JProgressBar(0, 100);
        bar.setValue(pct);
        bar.setStringPainted(true);
        bar.setString(progressString(tile));
        bar.setForeground(new Color(76, 175, 80));
        bar.setBackground(ColorScheme.MEDIUM_GRAY_COLOR);

        row.add(nameLabel, BorderLayout.NORTH);
        row.add(bar, BorderLayout.SOUTH);
        return row;
    }

    private String progressString(ActiveTile tile) {
        int req = tile.completionsRequired > 0 ? tile.completionsRequired : 1;
        if ("xp_gain".equals(tile.taskType)) {
            return String.format("%,d / %,d xp", tile.completionsDone, req);
        }
        return tile.completionsDone + " / " + req;
    }

    private String formatAmount(String taskType, int amount) {
        if ("xp_gain".equals(taskType)) return String.format("%,d xp", amount);
        if ("npc_kill".equals(taskType)) return "kill";
        return String.valueOf(amount);
    }
}
