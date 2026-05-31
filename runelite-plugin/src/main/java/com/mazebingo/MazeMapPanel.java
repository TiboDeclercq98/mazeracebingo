package com.mazebingo;

import com.mazebingo.model.MazeState;
import com.mazebingo.model.TileData;
import com.mazebingo.model.WallEntry;
import com.mazebingo.model.WallSides;

import javax.swing.*;
import java.awt.*;
import java.util.Set;

class MazeMapPanel extends JPanel {

    private static final int CELL = 28;
    private static final int PADDING = 10;

    private static final Color COLOR_COMPLETED = new Color(76, 175, 80);
    private static final Color COLOR_REVEALED   = new Color(55, 58, 60);
    private static final Color COLOR_HIDDEN     = new Color(20, 20, 20);
    private static final Color COLOR_GRID       = new Color(45, 45, 45);
    private static final Color COLOR_START      = new Color(255, 215, 0);
    private static final Color COLOR_END        = new Color(200, 50, 50);
    private static final Color COLOR_WALL       = Color.BLACK;

    private final MazeState state;
    private final Set<Integer> revealed;

    MazeMapPanel(MazeState state, Set<Integer> revealed) {
        this.state = state;
        this.revealed = revealed;
        int size = state != null ? state.size : 9;
        int dim = size * CELL + PADDING * 2;
        setBackground(new Color(30, 30, 30));
        setPreferredSize(new Dimension(dim, dim));
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        if (state == null || state.tiles == null) return;

        Graphics2D g2 = (Graphics2D) g;
        g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

        int size = state.size;
        int startIdx = (size - 1) * size + size / 2;
        int endIdx   = size / 2;

        // Fill tiles
        for (int row = 0; row < size; row++) {
            for (int col = 0; col < size; col++) {
                int idx = row * size + col;
                int x = PADDING + col * CELL;
                int y = PADDING + row * CELL;

                TileData tile = idx < state.tiles.size() ? state.tiles.get(idx) : null;
                boolean done = tile != null && tile.completed;
                boolean vis  = revealed != null && revealed.contains(idx);

                Color fill;
                if (done)          fill = COLOR_COMPLETED;
                else if (idx == endIdx) fill = COLOR_END;
                else if (vis)      fill = COLOR_REVEALED;
                else               fill = COLOR_HIDDEN;
                g2.setColor(fill);
                g2.fillRect(x, y, CELL, CELL);
            }
        }

        // Thin grid lines
        g2.setColor(COLOR_GRID);
        g2.setStroke(new BasicStroke(1f));
        for (int i = 0; i <= size; i++) {
            int v = PADDING + i * CELL;
            g2.drawLine(PADDING, v, PADDING + size * CELL, v);
            g2.drawLine(v, PADDING, v, PADDING + size * CELL);
        }

        // Tile IDs for revealed tiles
        g2.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 9));
        FontMetrics fm = g2.getFontMetrics();
        for (int row = 0; row < size; row++) {
            for (int col = 0; col < size; col++) {
                int idx = row * size + col;
                if ((revealed == null || !revealed.contains(idx)) && idx != endIdx) continue;
                TileData tile = idx < state.tiles.size() ? state.tiles.get(idx) : null;
                if (tile == null) continue;

                int x = PADDING + col * CELL;
                int y = PADDING + row * CELL;
                g2.setColor(tile.completed ? Color.WHITE : new Color(170, 170, 170));
                String label = String.valueOf(tile.id);
                g2.drawString(label,
                    x + (CELL - fm.stringWidth(label)) / 2,
                    y + (CELL + fm.getAscent() - fm.getDescent()) / 2);
            }
        }

        // Gold border on start tile
        int startRow = startIdx / size;
        int startCol = startIdx % size;
        g2.setColor(COLOR_START);
        g2.setStroke(new BasicStroke(2f));
        g2.drawRect(PADDING + startCol * CELL + 1, PADDING + startRow * CELL + 1, CELL - 3, CELL - 3);

        // Walls for completed tiles only
        g2.setColor(COLOR_WALL);
        g2.setStroke(new BasicStroke(3f, BasicStroke.CAP_SQUARE, BasicStroke.JOIN_MITER));
        if (state.walls != null) {
            for (WallEntry entry : state.walls) {
                int idx = entry.row * size + entry.col;
                TileData tile = idx < state.tiles.size() ? state.tiles.get(idx) : null;
                if (tile == null || !tile.completed) continue;
                int x = PADDING + entry.col * CELL;
                int y = PADDING + entry.row * CELL;
                WallSides w = entry.walls;
                if (w == null) continue;
                if (w.top)    g2.drawLine(x,        y,        x + CELL, y);
                if (w.right)  g2.drawLine(x + CELL, y,        x + CELL, y + CELL);
                if (w.bottom) g2.drawLine(x,        y + CELL, x + CELL, y + CELL);
                if (w.left)   g2.drawLine(x,        y,        x,        y + CELL);
            }
        }
    }
}
