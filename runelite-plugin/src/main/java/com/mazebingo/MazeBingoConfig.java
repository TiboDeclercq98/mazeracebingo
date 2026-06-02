package com.mazebingo;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

@ConfigGroup("mazebingo")
public interface MazeBingoConfig extends Config {

    @ConfigItem(
        keyName = "apiUrl",
        name = "API URL",
        description = "Base URL of the Maze Race Bingo API",
        position = 0
    )
    default String apiUrl() {
        return "";
    }

    @ConfigItem(
        keyName = "teamName",
        name = "Team Name",
        description = "Your team identifier",
        position = 1
    )
    default String teamName() {
        return "";
    }

    @ConfigItem(
        keyName = "notificationSound",
        name = "Notification sound",
        description = "Sound to play when a team event appears",
        position = 2
    )
    default MazeSound notificationSound() {
        return MazeSound.DING;
    }

}
