package com.mazebingo;

import net.runelite.api.Client;
import net.runelite.api.WidgetNode;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetModalMode;
import net.runelite.client.audio.AudioPlayer;
import net.runelite.client.callback.ClientThread;
import com.mazebingo.model.MazeEventEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.awt.Color;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;

@Singleton
public class MazeEventNotificationOverlay {

    private static final Logger log = LoggerFactory.getLogger(MazeEventNotificationOverlay.class);

    private static final int RESIZABLE_CLASSIC_LAYOUT = (161 << 16) | 13;
    private static final int RESIZABLE_MODERN_LAYOUT  = (164 << 16) | 13;
    private static final int FIXED_CLASSIC_LAYOUT     = 35913770;

    private static final float MIN_GAIN_DB = -80f;
    private static final float MAX_GAIN_DB = 0f;

    @Inject private Client client;
    @Inject private ClientThread clientThread;
    @Inject private AudioPlayer audioPlayer;
    @Inject private MazeBingoConfig config;
    @Inject private ScheduledExecutorService executorService;

    private WidgetNode popupWidgetNode;
    private final List<String> queue = new ArrayList<>();

    public synchronized void addNotification(MazeEventEntry event, Color ignored, boolean showPopup) {
        playSound(event);
        if (!showPopup) {
            return;
        }
        queue.add(event.message);
        if (queue.size() == 1) {
            showPopup(event.message);
        }
    }

    private void showPopup(String message) {
        clientThread.invokeLater(() -> {
            try {
                int componentId = client.isResized()
                    ? client.getVarbitValue(4607) == 1
                        ? RESIZABLE_MODERN_LAYOUT
                        : RESIZABLE_CLASSIC_LAYOUT
                    : FIXED_CLASSIC_LAYOUT;

                popupWidgetNode = client.openInterface(componentId, 660, WidgetModalMode.MODAL_CLICKTHROUGH);
                client.runScript(3343, "Maze Race Bingo", message, -1);

                clientThread.invokeLater(this::tryClearMessage);
            } catch (IllegalStateException ex) {
                clientThread.invokeLater(this::tryClearMessage);
            }
        });
    }

    private void playSound(MazeEventEntry event) {
        if (!config.soundsEnabled() || config.soundVolume() <= 0) {
            return;
        }

        float gainDb = volumeToGainDb(config.soundVolume());
        MazeSoundPack pack = config.soundPack();
        if (pack == MazeSoundPack.LORE) {
            playLoreSound(event, gainDb);
        } else {
            playCategorySound(event.message, pack, gainDb);
        }
    }

    /**
     * Default/Custom packs pick one of four sounds from the event message. Custom plays the user's own
     * file when present, otherwise falls through to the bundled Default sound (classpathResource maps
     * CUSTOM to the default folder).
     */
    private void playCategorySound(String message, MazeSoundPack pack, float gainDb) {
        String lowerMsg = message == null ? "" : message.toLowerCase();
        MazeSound sound = lowerMsg.contains("completed the end tile") ? MazeSound.SUCCESS
            : lowerMsg.contains("has found a key") ? MazeSound.SPECIAL
            : lowerMsg.contains("keys") ? MazeSound.FAIL
            : MazeSound.COMPLETION;

        // Playback touches disk (custom sound file lookup) so it must not run on the client thread.
        executorService.submit(() -> {
            try {
                if (pack == MazeSoundPack.CUSTOM) {
                    File custom = SoundGenerator.customFile(sound);
                    if (custom != null && custom.isFile()) {
                        audioPlayer.play(custom, gainDb);
                        return;
                    }
                }
                String resource = SoundGenerator.classpathResource(pack, sound);
                if (resource != null) {
                    audioPlayer.play(SoundGenerator.class, resource, gainDb);
                }
            } catch (Exception ex) {
                log.warn("Failed to play notification sound", ex);
            }
        });
    }

    /**
     * The Lore pack gives each maze tile its own numbered sound (tile N -> lore/N.wav) and uses dedicated
     * success/fail sounds for the end tile. Key-found and keys-missing events are intentionally silent.
     * Any tile without a bundled Lore file falls back to the matching Default category sound.
     */
    private void playLoreSound(MazeEventEntry event, float gainDb) {
        String lowerMsg = event.message == null ? "" : event.message.toLowerCase();

        final String loreFilename;
        final MazeSound fallback;
        if ("gameover".equals(event.type)) {
            loreFilename = "fail.wav";
            fallback = MazeSound.FAIL;
        } else if (lowerMsg.contains("completed the end tile")) {
            loreFilename = "success.wav";
            fallback = MazeSound.SUCCESS;
        } else if ("tile_complete".equals(event.type)) {
            loreFilename = event.tileId + ".wav";
            fallback = MazeSound.COMPLETION;
        } else {
            // Key found / keys missing: no Lore sound.
            return;
        }

        executorService.submit(() -> {
            try {
                String lore = SoundGenerator.loreResourceIfPresent(loreFilename);
                String resource = lore != null
                    ? lore
                    : SoundGenerator.classpathResource(MazeSoundPack.DEFAULT, fallback);
                if (resource != null) {
                    audioPlayer.play(SoundGenerator.class, resource, gainDb);
                }
            } catch (Exception ex) {
                log.warn("Failed to play notification sound", ex);
            }
        });
    }

    private synchronized boolean tryClearMessage() {
        Widget w = client.getWidget(660, 1);

        if (w != null && w.getWidth() > 0) {
            return false;
        }

        try {
            client.closeInterface(popupWidgetNode, true);
        } catch (Exception ex) {
            // ignored
        }
        popupWidgetNode = null;
        queue.remove(0);

        if (!queue.isEmpty()) {
            clientThread.invokeLater(() -> {
                showPopup(queue.get(0));
                return true;
            });
        }
        return true;
    }

    private static float volumeToGainDb(int volumePercent) {
        float gainDb = (float) (20 * Math.log10(volumePercent / 100.0));
        return Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
    }
}
