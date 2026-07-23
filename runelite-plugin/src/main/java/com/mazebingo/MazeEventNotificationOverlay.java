package com.mazebingo;

import net.runelite.api.Client;
import net.runelite.api.WidgetNode;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetModalMode;
import net.runelite.client.callback.ClientThread;
import com.mazebingo.model.MazeEventEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.inject.Inject;
import javax.inject.Singleton;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.Clip;
import javax.sound.sampled.FloatControl;
import javax.sound.sampled.LineEvent;
import java.awt.Color;
import java.io.File;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
    @Inject private MazeBingoConfig config;

    // Notification sounds play on a dedicated single thread so that multiple tasks completed in one maze
    // refresh are announced one after another instead of overlapping. Each clip blocks its task until it
    // finishes, so the executor's queue drains sequentially.
    private final ExecutorService soundExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "maze-bingo-sound");
        t.setDaemon(true);
        return t;
    });

    private WidgetNode popupWidgetNode;
    private final List<String> queue = new ArrayList<>();

    /** Opens the audio for one sound; resolved on the sound thread. Returns null when there is nothing to play. */
    private interface AudioSource {
        AudioInputStream open() throws Exception;
    }

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

        // Resolution touches disk (custom sound lookup), so it runs on the sound thread rather than the caller.
        enqueue(() -> {
            if (pack == MazeSoundPack.CUSTOM) {
                File custom = SoundGenerator.customFile(sound);
                if (custom != null && custom.isFile()) {
                    return AudioSystem.getAudioInputStream(custom);
                }
            }
            return openResource(SoundGenerator.classpathResource(pack, sound));
        }, gainDb);
    }

    /**
     * The Lore pack gives each maze tile its own numbered sound (tile N -> lore/N.wav) and uses dedicated
     * end-tile sounds. The backend emits exactly one "gameover" event, and only when the end tile is
     * completed, so gameover is always the WIN. A keys-missing event (trying to finish without all keys) is
     * the fail case. Booby-trap "key found" events are intentionally silent. Any tile without a bundled Lore
     * file falls back to the matching Default category sound.
     */
    private void playLoreSound(MazeEventEntry event, float gainDb) {
        final String loreFilename;
        final MazeSound fallback;
        if ("gameover".equals(event.type)) {
            // Only emitted when the end tile is completed — the win.
            loreFilename = "success.wav";
            fallback = MazeSound.SUCCESS;
        } else if ("keys_missing".equals(event.type)) {
            // Tried to finish the end tile without all keys.
            loreFilename = "fail.wav";
            fallback = MazeSound.FAIL;
        } else if ("tile_complete".equals(event.type)) {
            loreFilename = event.tileId + ".wav";
            fallback = MazeSound.COMPLETION;
        } else {
            // Booby-trap key found: no Lore sound.
            return;
        }

        enqueue(() -> {
            String lore = SoundGenerator.loreResourceIfPresent(loreFilename);
            return openResource(lore != null
                ? lore
                : SoundGenerator.classpathResource(MazeSoundPack.DEFAULT, fallback));
        }, gainDb);
    }

    /** Queues a sound for sequential playback on the sound thread. */
    private void enqueue(AudioSource source, float gainDb) {
        soundExecutor.submit(() -> {
            try {
                playBlocking(source, gainDb);
            } catch (Exception ex) {
                log.warn("Failed to play notification sound", ex);
            }
        });
    }

    /** Plays one clip and blocks until it has finished, so the next queued sound does not overlap it. */
    private void playBlocking(AudioSource source, float gainDb) throws Exception {
        try (AudioInputStream in = source.open()) {
            if (in == null) {
                return;
            }
            Clip clip = AudioSystem.getClip();
            try {
                CountDownLatch finished = new CountDownLatch(1);
                clip.addLineListener(ev -> {
                    if (ev.getType() == LineEvent.Type.STOP) {
                        finished.countDown();
                    }
                });
                clip.open(in);
                setGain(clip, gainDb);
                clip.start();
                // Bounded so a clip that never signals STOP cannot wedge the queue; comfortably longer
                // than any notification sound.
                finished.await(30, TimeUnit.SECONDS);
            } finally {
                clip.close();
            }
        }
    }

    private static AudioInputStream openResource(String resource) throws Exception {
        if (resource == null) {
            return null;
        }
        URL url = SoundGenerator.class.getResource(resource);
        return url == null ? null : AudioSystem.getAudioInputStream(url);
    }

    private static void setGain(Clip clip, float gainDb) {
        if (!clip.isControlSupported(FloatControl.Type.MASTER_GAIN)) {
            return;
        }
        FloatControl gain = (FloatControl) clip.getControl(FloatControl.Type.MASTER_GAIN);
        gain.setValue(Math.max(gain.getMinimum(), Math.min(gain.getMaximum(), gainDb)));
    }

    /** Stops the sound thread; called when the plugin shuts down. */
    public void shutdown() {
        soundExecutor.shutdownNow();
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
