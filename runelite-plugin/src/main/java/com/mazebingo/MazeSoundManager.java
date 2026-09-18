package com.mazebingo;

import net.runelite.client.util.Filepath;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Resolves the files behind notification sounds, and downloads them on first use.
 *
 * <p>The two packs are around 21 MB of WAV, far more than a plugin should carry in its jar, so they are
 * fetched at runtime into {@code .runelite/plugin-data/<internal-name>/sounds} instead. Nothing is
 * bundled, which means notifications are silent until the first download has succeeded.
 */
@Singleton
class MazeSoundManager {

    private static final Logger log = LoggerFactory.getLogger(MazeSoundManager.class);

    /**
     * Bumped alongside a new release tag whenever the sounds themselves change; a mismatch against the
     * marker on disk is what triggers a re-download. This stands in for a checksum: the packs come from
     * an immutable release asset, so the tag alone identifies their contents.
     */
    private static final String PACK_VERSION = "sounds-v1";
    private static final String PACK_URL =
        "https://github.com/TiboDeclercq98/MazeRaceBingo/releases/download/" + PACK_VERSION + "/sounds.zip";

    private static final String SOUNDS_DIR = "sounds";
    private static final String LORE_DIR = "lore";
    private static final String MEME_DIR = "meme";
    private static final String VERSION_MARKER = ".pack-version";

    /** The filenames the packs are known to hold: one per maze tile, plus the four category sounds. */
    private static final Pattern PACK_FILENAME =
        Pattern.compile("(\\d{1,3}|success|fail|completion|special)\\.wav");

    @Inject private OkHttpClient httpClient;

    private final AtomicBoolean downloading = new AtomicBoolean();

    // Set once from startUp, then read from the sound thread and from OkHttp's dispatcher.
    private volatile Filepath soundsDir;

    /** Points the manager at the sounds directory inside the plugin data directory. */
    void init(Filepath pluginDir) throws IOException {
        Filepath dir = pluginDir.join(SOUNDS_DIR);
        dir.createDirectories();
        soundsDir = dir;
        log.info("Maze Race Bingo sounds directory: {}", dir);
    }

    /**
     * Downloads both packs unless they are already on disk. Runs on OkHttp's dispatcher rather than the
     * plugin's scheduler, which is single-threaded and drives the maze polls.
     */
    void ensureDownloaded() {
        Filepath dir = soundsDir;
        if (dir == null || PACK_VERSION.equals(installedVersion(dir)) || !downloading.compareAndSet(false, true)) {
            return;
        }

        Request request = new Request.Builder().url(PACK_URL).get().build();
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                downloading.set(false);
                log.warn("Failed to download sound packs; notifications will be silent", e);
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response r = response) {
                    if (!r.isSuccessful() || r.body() == null) {
                        log.warn("Sound pack download returned {}", r.code());
                        return;
                    }
                    extract(dir, r.body().byteStream());
                    // Written only once every file has landed, so a download that dies halfway leaves no
                    // marker behind and the next startup simply tries again.
                    dir.joinSegment(VERSION_MARKER).write(PACK_VERSION);
                    log.info("Downloaded sound packs {}", PACK_VERSION);
                } catch (IOException e) {
                    log.warn("Failed to unpack sound packs", e);
                } finally {
                    downloading.set(false);
                }
            }
        });
    }

    /**
     * The file holding this event's sound within the given pack, or null if the sound has no file of its
     * own. CUSTOM has no downloaded files and resolves to the MEME pack, which is also the per-file
     * fallback when a user has not supplied their own override.
     */
    Filepath packFile(MazeSoundPack pack, MazeSound sound) {
        Filepath dir = soundsDir;
        String filename = filenameFor(sound);
        if (dir == null || filename == null) {
            return null;
        }
        return dir.joinSegment(pack == MazeSoundPack.LORE ? LORE_DIR : MEME_DIR).joinSegment(filename);
    }

    /**
     * A user-supplied file at {@code sounds/<name>.wav} that overrides the pack sound for this event, or
     * null if no override is present.
     */
    Filepath customFile(MazeSound sound) {
        Filepath dir = soundsDir;
        String filename = filenameFor(sound);
        if (dir == null || filename == null) {
            return null;
        }
        return dir.joinSegment(filename);
    }

    /**
     * The Lore file with the given filename (e.g. {@code "3.wav"}, {@code "success.wav"}) if it was
     * downloaded, else null. Lets callers fall back to a Meme category sound when a specific tile has no
     * dedicated Lore sound.
     */
    Filepath loreFileIfPresent(String filename) {
        Filepath dir = soundsDir;
        if (dir == null || !PACK_FILENAME.matcher(filename).matches()) {
            return null;
        }
        Filepath file = dir.joinSegment(LORE_DIR).joinSegment(filename);
        return file.isFile() ? file : null;
    }

    private static String installedVersion(Filepath dir) {
        Filepath marker = dir.joinSegment(VERSION_MARKER);
        if (!marker.isFile()) {
            return null;
        }
        try (BufferedReader reader = marker.openBufferedReader()) {
            return reader.readLine();
        } catch (IOException e) {
            log.warn("Could not read the sound pack version marker; re-downloading", e);
            return null;
        }
    }

    /**
     * Unpacks the archive's {@code lore/} and {@code meme/} entries into the sounds directory. Entry
     * names are checked against the filenames the packs are known to hold, and {@link
     * Filepath#joinSegment} rejects anything containing a path separator, so a malformed archive cannot
     * write outside the plugin data directory.
     */
    private static void extract(Filepath dir, InputStream body) throws IOException {
        try (ZipInputStream zip = new ZipInputStream(body)) {
            for (ZipEntry entry; (entry = zip.getNextEntry()) != null; ) {
                Filepath target = targetFor(dir, entry);
                if (target == null) {
                    log.debug("Skipping unexpected sound pack entry {}", entry.getName());
                    continue;
                }
                target.getParent().createDirectories();
                try (OutputStream out = target.openOutputStream()) {
                    // ZipInputStream reports end-of-stream at the entry boundary, so this copies one file.
                    zip.transferTo(out);
                }
            }
        }
    }

    private static Filepath targetFor(Filepath dir, ZipEntry entry) {
        if (entry.isDirectory()) {
            return null;
        }
        String[] parts = entry.getName().split("/");
        if (parts.length != 2
            || !(LORE_DIR.equals(parts[0]) || MEME_DIR.equals(parts[0]))
            || !PACK_FILENAME.matcher(parts[1]).matches()) {
            return null;
        }
        return dir.joinSegment(parts[0]).joinSegment(parts[1]);
    }

    private static String filenameFor(MazeSound sound) {
        switch (sound) {
            case COMPLETION: return "completion.wav";
            case SPECIAL:     return "special.wav";
            case SUCCESS:     return "success.wav";
            case FAIL:        return "fail.wav";
            default:          return null;
        }
    }
}
