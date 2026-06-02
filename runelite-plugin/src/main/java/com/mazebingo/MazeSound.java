package com.mazebingo;

public enum MazeSound {
    NONE("None"),
    DING("Ding"),
    DOUBLE_DING("Double ding"),
    CHIME("Chime"),
    SINGLE_BARK("Single bark"),
    SHORT_DOG_BARK("Short dog bark");

    private final String displayName;

    MazeSound(String displayName) {
        this.displayName = displayName;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
