package com.mazebingo;

import com.google.gson.JsonObject;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class ActiveTile {
    public final int id;
    public final int tileIndex;
    public final String taskType;
    public final JsonObject taskConfig;
    public final int completionsDone;
    public final int completionsRequired;
    public final String description;
}
