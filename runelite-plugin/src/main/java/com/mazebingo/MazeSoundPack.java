package com.mazebingo;

public enum MazeSoundPack {
    DEFAULT("Default"),
    LORE("Lore"),
    CUSTOM("Custom");

    private final String displayName;

    MazeSoundPack(String displayName) {
        this.displayName = displayName;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
