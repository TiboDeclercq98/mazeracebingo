package com.mazebingo.model;

import com.google.gson.JsonElement;
import java.util.List;

public class TileProgressResponse {
    public int tileId;
    public String taskType;
    public JsonElement taskConfig;
    public int currentProgress;
    public int target;
    public List<Contribution> contributions;

    public static class Contribution {
        public String playerName;
        public String subCategory;
        public int amount;
    }
}
