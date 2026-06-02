package com.mazebingo;

public enum MazeSound {
    NONE("None"),
    SHORT_DOG_BARK("Short dog bark"),
    WHIP("Whip");

    private final String displayName;

    MazeSound(String displayName) {
        this.displayName = displayName;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
