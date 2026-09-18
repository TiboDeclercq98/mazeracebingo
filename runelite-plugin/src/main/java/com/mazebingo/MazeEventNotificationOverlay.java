package com.mazebingo;

import net.runelite.api.Client;
import net.runelite.api.WidgetNode;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetModalMode;
import net.runelite.client.audio.AudioPlayer;
import net.runelite.client.callback.ClientThread;
import net.runelite.client.util.Filepath;
import com.mazebingo.model.MazeEventEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.awt.Color;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Singleton
public class MazeEventNotificationOverlay {

    private static final Logger log = LoggerFactory.getLogger(MazeEventNotificationOverlay.class);

    private static final int RESIZABLE_CLASSIC_LAYOUT = (161 << 16) | 13;
    private static final int RESIZABLE_MODERN_LAYOUT  = (164 << 16) | 13;
    private static final int FIXED_CLASSIC_LAYOUT     = 35913770;

    private static final float MIN_GAIN_DB = -80f;
    private static final float MAX_GAIN_DB = 0f;

    /** Gap held after a sound whose length could not be read from its header. */
    private static final long DEFAULT_SPACING_MS = 1500;
    /** Ceiling on that gap, so a bogus header cannot wedge the queue; longer than any notification sound. */
    private static final long MAX_SPACING_MS = 30_000;

    @Inject private Client client;
    @Inject private ClientThread clientThread;
    @Inject private MazeBingoConfig config;
    @Inject private MazeSoundManager soundManager;
    @Inject private AudioPlayer audioPlayer;

    // Notification sounds play on a dedicated single thread so that multiple tasks completed in one maze
    // refresh are announced one after another instead of overlapping. Each task holds the thread for the
    // length of its sound, so the executor's queue drains sequentially. Created on demand rather than once: this
    // singleton outlives a shutDown, so a plugin that is disabled and re-enabled needs a fresh thread.
    private ExecutorService soundExecutor;

    private synchronized ExecutorService soundExecutor() {
        if (soundExecutor == null || soundExecutor.isShutdown()) {
            soundExecutor = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "maze-bingo-sound");
                t.setDaemon(true);
                return t;
            });
        }
        return soundExecutor;
    }

    private WidgetNode popupWidgetNode;
    private final List<String> queue = new ArrayList<>();

    /** Locates the file for one sound; resolved on the sound thread. Returns null when there is nothing to play. */
    private interface SoundFile {
        Filepath resolve();
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
     * Meme/Custom packs pick one of four sounds from the event message. Custom plays the user's own
     * file when present, otherwise falls through to the downloaded Meme sound (packFile maps CUSTOM
     * to the same folder as MEME).
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
                Filepath custom = soundManager.customFile(sound);
                if (custom != null && custom.isFile()) {
                    return custom;
                }
            }
            return soundManager.packFile(pack, sound);
        }, gainDb);
    }

    /**
     * The Lore pack gives each maze tile its own numbered sound (tile N -> lore/N.wav) and uses dedicated
     * end-tile sounds. The backend emits exactly one "gameover" event, and only when the end tile is
     * completed, so gameover is always the WIN. A keys-missing event (trying to finish without all keys) is
     * the fail case. Booby-trap "key found" events are intentionally silent. Any tile without a Lore file
     * of its own falls back to the matching Meme category sound.
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
            Filepath lore = soundManager.loreFileIfPresent(loreFilename);
            return lore != null ? lore : soundManager.packFile(MazeSoundPack.MEME, fallback);
        }, gainDb);
    }

    /** Queues a sound for sequential playback on the sound thread. */
    private void enqueue(SoundFile source, float gainDb) {
        soundExecutor().submit(() -> {
            try {
                playBlocking(source, gainDb);
            } catch (InterruptedException ex) {
                // The plugin is shutting down; drop the sounds still queued behind this one.
                Thread.currentThread().interrupt();
            } catch (Exception ex) {
                log.warn("Failed to play notification sound", ex);
            }
        });
    }

    /**
     * Starts one sound and holds the thread for as long as that sound lasts, so the next queued sound
     * does not overlap it. An absent file — the normal state before the sound packs have finished
     * downloading — leaves the notification silent rather than failing.
     */
    private void playBlocking(SoundFile source, float gainDb) throws Exception {
        Filepath file = source.resolve();
        if (file == null || !file.isFile()) {
            return;
        }
        audioPlayer.play(file, gainDb);
        Thread.sleep(durationMillis(file));
    }

    /**
     * The playing length of a WAV, read from its own header. {@link AudioPlayer#play} starts the clip
     * and returns without offering a completion callback, so this length is what the queue waits out to
     * keep consecutive notifications apart. Every pack sound and custom override is a WAV; anything
     * whose header cannot be read falls back to a fixed gap, which still spaces the sounds out.
     */
    private static long durationMillis(Filepath file) {
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(file.openInputStream()))) {
            byte[] riff = new byte[12];
            in.readFully(riff);
            if (!isTag(riff, 0, "RIFF") || !isTag(riff, 8, "WAVE")) {
                return DEFAULT_SPACING_MS;
            }
            // Walk the chunks to the audio data, picking the byte rate out of the format chunk on the
            // way. A chunk is padded to an even length, which its size field does not count.
            long byteRate = 0;
            byte[] chunk = new byte[8];
            while (true) {
                in.readFully(chunk);
                long size = intLe(chunk, 4);
                if (isTag(chunk, 0, "data")) {
                    return byteRate > 0
                        ? Math.min(MAX_SPACING_MS, size * 1000 / byteRate)
                        : DEFAULT_SPACING_MS;
                }
                if (isTag(chunk, 0, "fmt ") && size >= 16) {
                    byte[] fmt = new byte[16];
                    in.readFully(fmt);
                    byteRate = intLe(fmt, 8);
                    skipFully(in, size - 16 + (size & 1));
                } else {
                    skipFully(in, size + (size & 1));
                }
            }
        } catch (IOException ex) {
            // Also how the walk above ends on a file that holds no data chunk at all.
            log.debug("Could not read the length of {}", file, ex);
            return DEFAULT_SPACING_MS;
        }
    }

    private static boolean isTag(byte[] buf, int offset, String tag) {
        for (int i = 0; i < 4; i++) {
            if (buf[offset + i] != (byte) tag.charAt(i)) {
                return false;
            }
        }
        return true;
    }

    /** Reads one of the little-endian 32-bit fields in a RIFF header, which are unsigned. */
    private static long intLe(byte[] buf, int offset) {
        return (buf[offset] & 0xFFL)
            | (buf[offset + 1] & 0xFFL) << 8
            | (buf[offset + 2] & 0xFFL) << 16
            | (buf[offset + 3] & 0xFFL) << 24;
    }

    private static void skipFully(DataInputStream in, long count) throws IOException {
        for (long left = count; left > 0; ) {
            long skipped = in.skip(left);
            if (skipped <= 0) {
                throw new EOFException();
            }
            left -= skipped;
        }
    }

    /** Stops the sound thread; called when the plugin shuts down. */
    public synchronized void shutdown() {
        if (soundExecutor != null) {
            soundExecutor.shutdownNow();
        }
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
