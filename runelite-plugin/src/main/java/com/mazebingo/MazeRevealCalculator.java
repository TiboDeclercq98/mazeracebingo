package com.mazebingo;

import com.mazebingo.model.MazeState;
import com.mazebingo.model.WallEntry;
import com.mazebingo.model.WallSides;

import java.util.HashSet;
import java.util.Set;

/**
 * Mirrors the tile-reveal logic from script.js lines 59-126.
 * A tile is revealed if it is the START tile, completed, or adjacent to a
 * completed tile with no wall blocking the passage between them.
 */
class MazeRevealCalculator {

    private MazeRevealCalculator() {}

    static Set<Integer> computeRevealed(MazeState state) {
        int size = state.size;
        Set<Integer> completed = new HashSet<>();
        Set<Integer> revealed = new HashSet<>();

        for (int i = 0; i < state.tiles.size(); i++) {
            if (state.tiles.get(i).completed) completed.add(i);
        }

        int startIdx = (size - 1) * size + size / 2;
        revealed.add(startIdx);

        if (state.gameOver) {
            for (int i = 0; i < state.tiles.size(); i++) revealed.add(i);
            return revealed;
        }

        for (int idx : completed) {
            revealed.add(idx);
            int row = idx / size;
            int col = idx % size;
            WallSides w = getWallSides(state, row, col);

            if (row > 0) {
                WallSides nw = getWallSides(state, row - 1, col);
                if (isOpenV(w, false, nw, true)) revealed.add((row - 1) * size + col);
            }
            if (row < size - 1) {
                WallSides nw = getWallSides(state, row + 1, col);
                if (isOpenV(w, true, nw, false)) revealed.add((row + 1) * size + col);
            }
            if (col > 0) {
                WallSides nw = getWallSides(state, row, col - 1);
                if (isOpenH(w, false, nw, true)) revealed.add(row * size + (col - 1));
            }
            if (col < size - 1) {
                WallSides nw = getWallSides(state, row, col + 1);
                if (isOpenH(w, true, nw, false)) revealed.add(row * size + (col + 1));
            }
        }

        return revealed;
    }

    /** Vertical passage: aBottom=true checks tile A's bottom wall, bBottom=true checks tile B's bottom wall. */
    private static boolean isOpenV(WallSides a, boolean aBottom, WallSides b, boolean bBottom) {
        boolean aBlocked = a != null && (aBottom ? a.bottom : a.top);
        boolean bBlocked = b != null && (bBottom ? b.bottom : b.top);
        return !aBlocked && !bBlocked;
    }

    /** Horizontal passage: aRight=true checks tile A's right wall, bRight=true checks tile B's right wall. */
    private static boolean isOpenH(WallSides a, boolean aRight, WallSides b, boolean bRight) {
        boolean aBlocked = a != null && (aRight ? a.right : a.left);
        boolean bBlocked = b != null && (bRight ? b.right : b.left);
        return !aBlocked && !bBlocked;
    }

    private static WallSides getWallSides(MazeState state, int row, int col) {
        if (state.walls == null) return null;
        for (WallEntry entry : state.walls) {
            if (entry.row == row && entry.col == col) return entry.walls;
        }
        return null;
    }
}
