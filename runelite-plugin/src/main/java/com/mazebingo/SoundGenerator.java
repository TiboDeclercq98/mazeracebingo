package com.mazebingo;

import net.runelite.client.RuneLite;

import java.io.File;

class SoundGenerator {

    private static final File SOUNDS_DIR = new File(new File(RuneLite.RUNELITE_DIR, "mazebingo"), "sounds");

    static void ensureSoundsDirExists() {
        SOUNDS_DIR.mkdirs();
    }

    /**
     * A user-supplied file at {@code .runelite/mazebingo/sounds/<name>.wav} that overrides the bundled sound
     * for this event, or null if no override is present.
     */
    static File customFile(MazeSound sound) {
        String filename = filenameFor(sound);
        return filename == null ? null : new File(SOUNDS_DIR, filename);
    }

    /**
     * Classpath resource path of the bundled sound for this event within the given pack, or null if this
     * sound has none. The CUSTOM pack has no bundled files of its own, so it resolves to the DEFAULT pack
     * (which is also the per-file fallback when a user has not supplied their own override).
     */
    static String classpathResource(MazeSoundPack pack, MazeSound sound) {
        String filename = filenameFor(sound);
        if (filename == null) {
            return null;
        }
        String dir = pack == MazeSoundPack.LORE ? "lore" : "default";
        return "/com/mazebingo/sounds/" + dir + "/" + filename;
    }

    /**
     * Classpath resource path of the Lore sound with the given filename (e.g. {@code "3.wav"},
     * {@code "success.wav"}), or null if the pack does not bundle that file. Lets callers fall back to a
     * Default category sound when a specific tile has no dedicated Lore sound.
     */
    static String loreResourceIfPresent(String filename) {
        String path = "/com/mazebingo/sounds/lore/" + filename;
        return SoundGenerator.class.getResource(path) != null ? path : null;
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
