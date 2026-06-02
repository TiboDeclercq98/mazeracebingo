package com.mazebingo.model;

import java.util.List;
import java.util.Map;

public class MazeState {
    public List<TileData> tiles;
    public List<WallEntry> walls;
    public int size;
    public boolean gameOver;
    public Map<String, String> tileDescriptions;
    public List<BoobyTrapPos> boobytraps;
    public List<MazeEventEntry> recentEvents;

    public static class BoobyTrapPos {
        public int row;
        public int col;
    }
}
