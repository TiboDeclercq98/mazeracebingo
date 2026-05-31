package com.mazebingo.model;

import com.google.gson.JsonObject;

public class TileData {
    public int id;
    public boolean completed;
    public int completionsDone;
    public int completionsRequired;
    public String taskType;
    public JsonObject taskConfig;
}
