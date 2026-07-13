package com.mazebingo;

import net.runelite.api.Client;
import net.runelite.api.WidgetNode;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetModalMode;
import net.runelite.client.audio.AudioPlayer;
import net.runelite.client.callback.ClientThread;
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

    public synchronized void addNotification(String message, Color ignored) {
        queue.add(message);
        if (queue.size() == 1) {
            showPopup(message);
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

                playSound(message);

                clientThread.invokeLater(this::tryClearMessage);
            } catch (IllegalStateException ex) {
                clientThread.invokeLater(this::tryClearMessage);
            }
        });
    }

    private void playSound(String message) {
        if (!config.soundsEnabled() || config.soundVolume() <= 0) {
            return;
        }

        String lowerMsg = message.toLowerCase();
        MazeSound sound = lowerMsg.contains("completed the end tile") ? MazeSound.SUCCESS
            : lowerMsg.contains("has found a key") ? MazeSound.SPECIAL
            : lowerMsg.contains("keys") ? MazeSound.FAIL:
            MazeSound.COMPLETION;
        float gainDb = volumeToGainDb(config.soundVolume());

        // Playback touches disk (custom sound file lookup) so it must not run on the client thread.
        executorService.submit(() -> {
            try {
                File custom = SoundGenerator.customFile(sound);
                if (custom != null && custom.isFile()) {
                    audioPlayer.play(custom, gainDb);
                    return;
                }
                String resource = SoundGenerator.classpathResource(sound);
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
