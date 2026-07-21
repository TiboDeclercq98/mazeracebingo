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

    @ConfigSection(
        name = "Pop-up",
        description = "Modal pop-up notification settings",
        position = 5
    )
    String popup = "popup";

    @ConfigItem(
        keyName = "tileCompletionPopupEnabled",
        name = "Tile completion pop-up",
        description = "Show the modal pop-up notification when a tile is completed. Only affects what you see.",
        section = "popup",
        position = 6
    )
    default boolean tileCompletionPopupEnabled() {
        return true;
    }

    @ConfigSection(
        name = "Chat Messages",
        description = "Which progress messages are sent to your chatbox. Only affects your own chat.",
        position = 7
    )
    String chatMessages = "chatMessages";

    @ConfigItem(
        keyName = "chatContributionXp",
        name = "XP gain contributions",
        description = "Show \"You contributed...\" chat messages for XP gain tiles",
        section = "chatMessages",
        position = 8
    )
    default boolean chatContributionXp() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionNpcKill",
        name = "NPC kill contributions",
        description = "Show \"You contributed...\" chat messages for NPC kill tiles",
        section = "chatMessages",
        position = 9
    )
    default boolean chatContributionNpcKill() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionAgilityLap",
        name = "Agility lap contributions",
        description = "Show \"You contributed...\" chat messages for agility lap tiles",
        section = "chatMessages",
        position = 10
    )
    default boolean chatContributionAgilityLap() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionMinigame",
        name = "Minigame completion contributions",
        description = "Show \"You contributed...\" chat messages for minigame completion tiles",
        section = "chatMessages",
        position = 11
    )
    default boolean chatContributionMinigame() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionItemDrop",
        name = "Item drop contributions",
        description = "Show \"You contributed...\" chat messages for item drop tiles",
        section = "chatMessages",
        position = 12
    )
    default boolean chatContributionItemDrop() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionGpValue",
        name = "GP value contributions",
        description = "Show \"You contributed...\" chat messages for GP value tiles",
        section = "chatMessages",
        position = 13
    )
    default boolean chatContributionGpValue() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionNpcDamage",
        name = "NPC damage contributions",
        description = "Show \"You contributed...\" chat messages for NPC damage tiles",
        section = "chatMessages",
        position = 14
    )
    default boolean chatContributionNpcDamage() {
        return true;
    }

    @ConfigItem(
        keyName = "chatContributionClueCompletion",
        name = "Clue completion contributions",
        description = "Show \"You contributed...\" chat messages for clue scroll completion tiles",
        section = "chatMessages",
        position = 15
    )
    default boolean chatContributionClueCompletion() {
        return true;
    }

    @ConfigItem(
        keyName = "chatErrorMessages",
        name = "Error messages",
        description = "Show error messages in chat when a progress submission fails",
        section = "chatMessages",
        position = 16
    )
    default boolean chatErrorMessages() {
        return true;
    }

    @ConfigItem(
        keyName = "chatCompletionMessages",
        name = "Tile completion messages",
        description = "Show a chat message when you complete a tile",
        section = "chatMessages",
        position = 17
    )
    default boolean chatCompletionMessages() {
        return true;
    }

    @ConfigItem(
        keyName = "chatSpecialEventMessages",
        name = "Special event messages",
        description = "Show special event chat messages (e.g. game over, bonus events)",
        section = "chatMessages",
        position = 18
    )
    default boolean chatSpecialEventMessages() {
        return true;
    }
}
