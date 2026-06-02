package com.mazebingo;

public enum MazeSound {
    NONE("None"),
    DING("Ding"),
    DOUBLE_DING("Double ding"),
    CHIME("Chime");

    private final String displayName;

    MazeSound(String displayName) {
        this.displayName = displayName;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
