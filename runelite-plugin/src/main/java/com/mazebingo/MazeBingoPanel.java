package com.mazebingo;

import com.mazebingo.model.MazeState;
import net.runelite.client.ui.ColorScheme;
import net.runelite.client.ui.FontManager;
import net.runelite.client.ui.PluginPanel;

import javax.inject.Inject;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.util.List;
import java.util.Set;

public class MazeBingoPanel extends PluginPanel {

    private final JLabel statusLabel;
    private final JPanel tilesPanel;
    private Runnable onRefresh;
    private volatile MazeState currentMazeState;

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

        JButton viewMazeButton = new JButton("View Maze");
        viewMazeButton.setFont(FontManager.getRunescapeSmallFont());
        viewMazeButton.setFocusPainted(false);
        viewMazeButton.addActionListener(e -> openMazeMap());

        JPanel topSection = new JPanel(new BorderLayout(0, 4));
        topSection.setBackground(ColorScheme.DARK_GRAY_COLOR);
        topSection.setBorder(new EmptyBorder(0, 0, 6, 0));
        topSection.add(headerPanel, BorderLayout.NORTH);
        topSection.add(viewMazeButton, BorderLayout.SOUTH);

        tilesPanel = new JPanel();
        tilesPanel.setLayout(new BoxLayout(tilesPanel, BoxLayout.Y_AXIS));
        tilesPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        tilesPanel.setBorder(BorderFactory.createTitledBorder(
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Active Tasks"));

        JPanel content = new JPanel();
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.setBackground(ColorScheme.DARK_GRAY_COLOR);
        content.add(topSection);
        content.add(tilesPanel);

        add(content, BorderLayout.NORTH);
    }

    void updateMazeState(MazeState state) {
        this.currentMazeState = state;
    }

    private void openMazeMap() {
        MazeState snapshot = currentMazeState;
        if (snapshot == null) {
            JOptionPane.showMessageDialog(this, "No maze data available yet.", "Maze Map", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        Set<Integer> revealed = MazeRevealCalculator.computeRevealed(snapshot);
        MazeMapPanel mapPanel = new MazeMapPanel(snapshot, revealed);

        JFrame frame = new JFrame("Maze Map");
        frame.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        frame.setContentPane(mapPanel);
        frame.pack();
        frame.setLocationRelativeTo(null);
        frame.setVisible(true);
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

    void clear() {
        SwingUtilities.invokeLater(() -> {
            tilesPanel.removeAll();
            tilesPanel.revalidate();
            tilesPanel.repaint();
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
}
