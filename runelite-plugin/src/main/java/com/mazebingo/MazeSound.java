package com.mazebingo;

public enum MazeSound {
    NONE("None", -1),
    COLLECTION_LOG("Collection log", 3816),
    LEVEL_UP("Level up", 2277),
    QUEST_COMPLETE("Quest complete", 4914);

    private final String displayName;
    private final int id;

    MazeSound(String displayName, int id) {
        this.displayName = displayName;
        this.id = id;
    }

    public int getId() {
        return id;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
