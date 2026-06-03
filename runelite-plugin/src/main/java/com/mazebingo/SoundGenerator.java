package com.mazebingo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

class SoundGenerator {

    private static final Logger log = LoggerFactory.getLogger(SoundGenerator.class);
    private static final int SAMPLE_RATE = 44100;

    static InputStream generate(MazeSound sound) {
        switch (sound) {
            case SHORT_DOG_BARK: return loadWav("/com/mazebingo/sounds/short-dog-bark.wav");
            case WHIP:            return loadWav("/com/mazebingo/sounds/whip.wav");
            case BOBER:           return loadWav("/com/mazebingo/sounds/bober_kurwa.wav");
            case SAD_SOUND:     return loadWav("/com/mazebingo/sounds/sad_sound.wav");
            default:             return null;
        }
    }

    private static InputStream loadWav(String resource) {
        try (InputStream in = SoundGenerator.class.getResourceAsStream(resource)) {
            if (in == null) {
                log.warn("Sound resource not found on classpath: {}", resource);
                return null;
            }
            return new ByteArrayInputStream(in.readAllBytes());
        } catch (IOException e) {
            log.warn("Failed to read sound resource {}", resource, e);
            return null;
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
