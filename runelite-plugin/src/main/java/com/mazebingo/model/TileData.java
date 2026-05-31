package com.mazebingo.model;

import com.google.gson.JsonElement;

public class TileData {
    public int id;
    public boolean completed;
    public int completionsDone;
    public int completionsRequired;
    public String taskType;
    public JsonElement taskConfig;
}
