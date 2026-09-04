package com.mazebingo;

import com.mazebingo.model.MazeState;
import com.mazebingo.model.TileData;
import com.mazebingo.model.TileProgressResponse;
import net.runelite.client.ui.ColorScheme;
import net.runelite.client.ui.FontManager;
import net.runelite.client.ui.PluginPanel;

import javax.inject.Inject;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

public class MazeBingoPanel extends PluginPanel {

    private static final int MAX_EVENTS = 8;
    /** A task row's own left/right border (6px each), plus a small margin so text never touches the edge. */
    private static final int ROW_HORIZONTAL_PADDING = 16;

    private final JLabel statusLabel;
    private final JPanel tilesPanel;
    private final MazeMapPanel mazeMapPanel;
    private final TileInfoPanel tileInfoPanel;
    private final JPanel eventFeedPanel;
    private final Deque<String[]> recentEvents = new ArrayDeque<>();
    private Runnable onRefresh;

    @Inject
    MazeBingoPanel() {
        setLayout(new BorderLayout(0, 6));
        setBorder(new EmptyBorder(10, 10, 10, 10));
        setBackground(ColorScheme.DARK_GRAY_COLOR);

        JLabel title = new JLabel("Maze Race Bingo");
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
        headerPanel.setBorder(new EmptyBorder(0, 0, 6, 0));
        headerPanel.setAlignmentX(Component.LEFT_ALIGNMENT);
        headerPanel.add(topRow, BorderLayout.NORTH);
        headerPanel.add(statusLabel, BorderLayout.SOUTH);

        mazeMapPanel = new MazeMapPanel();
        tileInfoPanel = new TileInfoPanel();

        tilesPanel = new JPanel();
        tilesPanel.setLayout(new BoxLayout(tilesPanel, BoxLayout.Y_AXIS));
        tilesPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        tilesPanel.setAlignmentX(Component.LEFT_ALIGNMENT);
        tilesPanel.setBorder(BorderFactory.createTitledBorder(
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Active Tasks"));

        eventFeedPanel = new JPanel();
        eventFeedPanel.setLayout(new BoxLayout(eventFeedPanel, BoxLayout.Y_AXIS));
        eventFeedPanel.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        eventFeedPanel.setAlignmentX(Component.LEFT_ALIGNMENT);
        eventFeedPanel.setBorder(BorderFactory.createTitledBorder(
            BorderFactory.createLineBorder(ColorScheme.MEDIUM_GRAY_COLOR), "Recent Events"));

        JPanel content = new JPanel();
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.setBackground(ColorScheme.DARK_GRAY_COLOR);
        content.add(headerPanel);
        content.add(mazeMapPanel);
        content.add(Box.createRigidArea(new Dimension(0, 6)));
        content.add(tileInfoPanel);
        content.add(tilesPanel);
        content.add(Box.createRigidArea(new Dimension(0, 6)));
        content.add(eventFeedPanel);

        add(content, BorderLayout.NORTH);
    }

    void updateMazeState(MazeState state) {
        if (state != null) {
            Set<Integer> revealed = MazeRevealCalculator.computeRevealed(state);
            SwingUtilities.invokeLater(() -> mazeMapPanel.updateState(state, revealed));
        }
    }

    void setOnRefresh(Runnable callback) {
        this.onRefresh = callback;
    }

    void setOnTileClick(Consumer<TileData> callback) {
        mazeMapPanel.setOnTileClick(callback);
    }

    void showTileInfoLoading(int tileId, String description) {
        SwingUtilities.invokeLater(() -> tileInfoPanel.showLoading(tileId, description));
    }

    void showTileInfo(TileProgressResponse data, String description, boolean isBoobytrap) {
        SwingUtilities.invokeLater(() -> tileInfoPanel.showTile(data, description, isBoobytrap));
    }

    void setSelectedTileOnMap(int tileId) {
        SwingUtilities.invokeLater(() -> mazeMapPanel.setSelectedTileId(tileId));
    }

    void hideTileInfo() {
        SwingUtilities.invokeLater(() -> {
            tileInfoPanel.clear();
            mazeMapPanel.setSelectedTileId(-1);
        });
    }

    void setOnTileInfoClose(Runnable callback) {
        tileInfoPanel.setOnClose(callback);
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

    void addEvent(String message, Color color) {
        SwingUtilities.invokeLater(() -> {
            String hex = String.format("%02x%02x%02x", color.getRed(), color.getGreen(), color.getBlue());
            if (recentEvents.size() >= MAX_EVENTS) recentEvents.pollFirst();
            recentEvents.addLast(new String[]{message, hex});
            rebuildEventFeed();
        });
    }

    private void rebuildEventFeed() {
        eventFeedPanel.removeAll();
        if (recentEvents.isEmpty()) {
            JLabel empty = new JLabel("No events yet");
            empty.setForeground(Color.GRAY);
            empty.setFont(FontManager.getRunescapeSmallFont());
            empty.setBorder(new EmptyBorder(4, 6, 4, 6));
            eventFeedPanel.add(empty);
        } else {
            for (String[] entry : recentEvents) {
                JLabel lbl = new JLabel("<html><body style='width:160px'>" + entry[0] + "</body></html>");
                lbl.setForeground(Color.decode("#" + entry[1]));
                lbl.setFont(FontManager.getRunescapeSmallFont());
                lbl.setBorder(new EmptyBorder(2, 6, 2, 6));
                eventFeedPanel.add(lbl);
            }
        }
        eventFeedPanel.revalidate();
        eventFeedPanel.repaint();
    }

    void clear() {
        SwingUtilities.invokeLater(() -> {
            tilesPanel.removeAll();
            tilesPanel.revalidate();
            tilesPanel.repaint();
            tileInfoPanel.clear();
            mazeMapPanel.setSelectedTileId(-1);
            recentEvents.clear();
            rebuildEventFeed();
            statusLabel.setText("● Not connected");
            statusLabel.setForeground(Color.RED);
        });
    }

    private JPanel buildTileRow(ActiveTile tile) {
        JPanel row = new JPanel(new BorderLayout(0, 3));
        row.setBackground(ColorScheme.DARKER_GRAY_COLOR);
        row.setBorder(new EmptyBorder(5, 6, 5, 6));

        String name = "Tile " + tile.id + ": " + tile.description;
        // Wrap instead of clipping: task descriptions are longer than the side panel is wide.
        JLabel nameLabel = new JLabel("<html><body style='width:" + taskTextWidth() + "px'>"
            + escapeHtml(name) + "</body></html>");
        nameLabel.setForeground(Color.WHITE);
        nameLabel.setFont(FontManager.getRunescapeSmallFont());
        nameLabel.setToolTipText(name);

        int req = tile.completionsRequired > 0 ? tile.completionsRequired : 1;
        int pct = (int) Math.min(100.0, (tile.completionsDone * 100.0) / req);

        String progress = progressString(tile);
        JProgressBar bar = new JProgressBar(0, 100);
        bar.setValue(pct);
        bar.setStringPainted(true);
        bar.setString(progress);
        bar.setFont(FontManager.getRunescapeSmallFont());
        bar.setToolTipText(progress);
        bar.setForeground(new Color(76, 175, 80));
        bar.setBackground(ColorScheme.MEDIUM_GRAY_COLOR);
        bar.setPreferredSize(new Dimension(0, 16));

        row.add(nameLabel, BorderLayout.NORTH);
        row.add(bar, BorderLayout.SOUTH);
        // Height must follow the (possibly multi-line) label, or BoxLayout clips the wrapped text.
        row.setMaximumSize(new Dimension(Integer.MAX_VALUE, row.getPreferredSize().height));
        return row;
    }

    /** Width available for a task row's text, i.e. the tasks panel minus its own and the row's padding. */
    private int taskTextWidth() {
        int width = tilesPanel.getWidth();
        if (width <= 0) {
            // Not laid out yet: fall back to the fixed side panel width minus this panel's border.
            width = PluginPanel.PANEL_WIDTH - 20;
        }
        Insets insets = tilesPanel.getInsets();
        return Math.max(100, width - insets.left - insets.right - ROW_HORIZONTAL_PADDING);
    }

    private static String escapeHtml(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private String progressString(ActiveTile tile) {
        int req = tile.completionsRequired > 0 ? tile.completionsRequired : 1;
        if ("xp_gain".equals(tile.taskType)) {
            return String.format("%,d / %,d xp", tile.completionsDone, req);
        }
        if ("npc_damage".equals(tile.taskType)) {
            return String.format("%,d / %,d damage", tile.completionsDone, req);
        }
        return String.format("%,d / %,d", tile.completionsDone, req);
    }
}
