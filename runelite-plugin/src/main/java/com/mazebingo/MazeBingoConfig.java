package com.mazebingo;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;
import net.runelite.client.config.ConfigSection;
import net.runelite.client.config.Range;

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

    @ConfigSection(
        name = "Sounds",
        description = "Notification sound settings",
        position = 2
    )
    String sounds = "sounds";

    @ConfigItem(
        keyName = "soundsEnabled",
        name = "Enable sounds",
        description = "Play a sound when a notification event occurs",
        section = "sounds",
        position = 3
    )
    default boolean soundsEnabled() {
        return true;
    }

    @Range(min = 0, max = 100)
    @ConfigItem(
        keyName = "soundVolume",
        name = "Volume",
        description = "Volume of notification sounds (0-100)",
        section = "sounds",
        position = 4
    )
    default int soundVolume() {
        return 100;
    }

    @ConfigItem(
        keyName = "customSoundsFolder",
        name = "Custom sounds folder",
        description = "Absolute path to a folder containing replacement .wav files "
            + "(completion.wav, special.wav, success.wav, fail.wav). Leave blank to use the built-in sounds.",
        section = "sounds",
        position = 5
    )
    default String customSoundsFolder() {
        return "";
    }
}
