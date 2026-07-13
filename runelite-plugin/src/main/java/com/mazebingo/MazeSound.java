package com.mazebingo;

public enum MazeSound {
    NONE("None"),
    COMPLETION("Completion"),
    SPECIAL("Special"),
    SUCCESS("Success"),
    FAIL("Fail");

    private final String displayName;

    MazeSound(String displayName) {
        this.displayName = displayName;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
