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
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

@Singleton
public class MazeEventNotificationOverlay {

    private static final Logger log = LoggerFactory.getLogger(MazeEventNotificationOverlay.class);

    private static final int RESIZABLE_CLASSIC_LAYOUT = (161 << 16) | 13;
    private static final int RESIZABLE_MODERN_LAYOUT  = (164 << 16) | 13;
    private static final int FIXED_CLASSIC_LAYOUT     = 35913770;

    @Inject private Client client;
    @Inject private ClientThread clientThread;
    @Inject private AudioPlayer audioPlayer;

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

                String lowerMsg = message.toLowerCase();
                MazeSound sound = lowerMsg.contains("completed the end tile") ? MazeSound.BOBER
                    : lowerMsg.contains("has found a key") ? MazeSound.WHIP
                    : lowerMsg.contains("keys") ? MazeSound.SAD_SOUND:
                    MazeSound.SHORT_DOG_BARK;
                InputStream stream = SoundGenerator.generate(sound);
                if (stream != null) {
                    try {
                        audioPlayer.play(stream, 0f);
                    } catch (Exception ex) {
                        log.warn("Failed to play notification sound", ex);
                    }
                }

                clientThread.invokeLater(this::tryClearMessage);
            } catch (IllegalStateException ex) {
                clientThread.invokeLater(this::tryClearMessage);
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
}
