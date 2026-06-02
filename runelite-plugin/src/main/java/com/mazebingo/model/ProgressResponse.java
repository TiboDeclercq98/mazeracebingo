package com.mazebingo.model;

import com.google.gson.JsonElement;

public class ProgressResponse {
    public boolean success;
    public int progress;
    public int target;
    public boolean completed;
    public JsonElement specialEvent;
    public String error;
}
