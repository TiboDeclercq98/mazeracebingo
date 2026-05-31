package com.mazebingo;

import com.google.gson.JsonObject;

public class ActiveTile {
    public final int id;
    public final int tileIndex;
    public final String taskType;
    public final JsonObject taskConfig;
    public final int completionsDone;
    public final int completionsRequired;
    public final String description;

    public ActiveTile(int id, int tileIndex, String taskType, JsonObject taskConfig,
                      int completionsDone, int completionsRequired, String description) {
        this.id = id;
        this.tileIndex = tileIndex;
        this.taskType = taskType;
        this.taskConfig = taskConfig;
        this.completionsDone = completionsDone;
        this.completionsRequired = completionsRequired;
        this.description = description;
    }
}
