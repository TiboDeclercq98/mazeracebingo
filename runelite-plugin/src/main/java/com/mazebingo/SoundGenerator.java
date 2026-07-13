package com.mazebingo;

import net.runelite.client.RuneLite;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

class SoundGenerator {

    private static final int SAMPLE_RATE = 44100;
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
     * Classpath resource path of the bundled sound for this event, or null if this sound has none.
     */
    static String classpathResource(MazeSound sound) {
        String filename = filenameFor(sound);
        return filename == null ? null : "/com/mazebingo/sounds/" + filename;
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

    private static InputStream tones(double[] frequencies, double[] durations) {
        int totalSamples = 0;
        for (double d : durations) totalSamples += (int)(SAMPLE_RATE * d);

        byte[] pcm = new byte[totalSamples * 2];
        int offset = 0;
        for (int t = 0; t < frequencies.length; t++) {
            int numSamples = (int)(SAMPLE_RATE * durations[t]);
            for (int i = 0; i < numSamples; i++) {
                double time = (double) i / SAMPLE_RATE;
                double envelope = Math.exp(-time * 6.0);
                double sample = Math.sin(2 * Math.PI * frequencies[t] * time) * envelope;
                short value = (short)(sample * (Short.MAX_VALUE * 0.75));
                pcm[offset + i * 2]     = (byte)(value & 0xFF);
                pcm[offset + i * 2 + 1] = (byte)((value >> 8) & 0xFF);
            }
            offset += numSamples * 2;
        }

        return new ByteArrayInputStream(wavBytes(pcm));
    }

    private static byte[] wavBytes(byte[] pcm) {
        ByteBuffer buf = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        buf.put(new byte[]{'R', 'I', 'F', 'F'});
        buf.putInt(36 + pcm.length);
        buf.put(new byte[]{'W', 'A', 'V', 'E'});
        buf.put(new byte[]{'f', 'm', 't', ' '});
        buf.putInt(16);
        buf.putShort((short) 1);           // PCM
        buf.putShort((short) 1);           // mono
        buf.putInt(SAMPLE_RATE);
        buf.putInt(SAMPLE_RATE * 2);       // byte rate (16-bit mono)
        buf.putShort((short) 2);           // block align
        buf.putShort((short) 16);          // bits per sample
        buf.put(new byte[]{'d', 'a', 't', 'a'});
        buf.putInt(pcm.length);
        buf.put(pcm);
        return buf.array();
    }
}
