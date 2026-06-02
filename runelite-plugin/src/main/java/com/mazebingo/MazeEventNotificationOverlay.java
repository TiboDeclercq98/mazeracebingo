package com.mazebingo;

import net.runelite.client.ui.FontManager;
import net.runelite.client.ui.overlay.Overlay;
import net.runelite.client.ui.overlay.OverlayLayer;
import net.runelite.client.ui.overlay.OverlayPosition;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.awt.*;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

@Singleton
public class MazeEventNotificationOverlay extends Overlay {

    private static final int DISPLAY_MS = 4000;
    private static final int MAX_VISIBLE = 5;
    private static final int PADDING = 8;
    private static final int ACCENT_WIDTH = 4;
    private static final int GAP = 3;

    private final Deque<NotifEntry> entries = new ArrayDeque<>();

    @Inject
    MazeEventNotificationOverlay() {
        setPosition(OverlayPosition.ABOVE_CHATBOX_RIGHT);
        setLayer(OverlayLayer.ABOVE_SCENE);
    }

    public synchronized void addNotification(String message, Color color) {
        entries.addLast(new NotifEntry(message, color, System.currentTimeMillis() + DISPLAY_MS));
    }

    @Override
    public synchronized Dimension render(Graphics2D graphics) {
        long now = System.currentTimeMillis();
        entries.removeIf(e -> now > e.expireTime);
        if (entries.isEmpty()) return null;

        graphics.setFont(FontManager.getRunescapeSmallFont());
        FontMetrics fm = graphics.getFontMetrics();

        List<NotifEntry> visible = new ArrayList<>(entries);
        if (visible.size() > MAX_VISIBLE) {
            visible = visible.subList(visible.size() - MAX_VISIBLE, visible.size());
        }

        int entryHeight = fm.getHeight() + PADDING * 2;
        int maxTextWidth = visible.stream().mapToInt(e -> fm.stringWidth(e.message)).max().orElse(0);
        int width = ACCENT_WIDTH + PADDING + maxTextWidth + PADDING;
        int totalHeight = visible.size() * entryHeight + (visible.size() - 1) * GAP;

        for (int i = 0; i < visible.size(); i++) {
            NotifEntry entry = visible.get(i);
            int y = i * (entryHeight + GAP);

            graphics.setColor(new Color(0, 0, 0, 180));
            graphics.fillRect(0, y, width, entryHeight);

            graphics.setColor(entry.color);
            graphics.fillRect(0, y, ACCENT_WIDTH, entryHeight);

            graphics.setFont(FontManager.getRunescapeSmallFont());
            graphics.setColor(Color.WHITE);
            graphics.drawString(entry.message, ACCENT_WIDTH + PADDING, y + PADDING + fm.getAscent());
        }

        return new Dimension(width, totalHeight);
    }

    private static class NotifEntry {
        final String message;
        final Color color;
        final long expireTime;

        NotifEntry(String message, Color color, long expireTime) {
            this.message = message;
            this.color = color;
            this.expireTime = expireTime;
        }
    }
}
