package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service that owns a MediaSession and shows the media-style notification (lock screen / notification shade
 * controls) for audio playing inside the WebView. Button presses are forwarded to the web page through {@link Listener}.
 */
public class MediaPlaybackService extends Service {
    public interface Listener {
        void onAction(String action, long positionMs);
    }

    static final String ACTION_UPDATE = "__PACKAGE__.media.UPDATE";
    static final String ACTION_STOP = "__PACKAGE__.media.STOP";
    private static final String CHANNEL = "media_playback";
    private static final int NOTIFICATION_ID = 4242;

    static volatile Listener listener;
    private static volatile MediaPlaybackService instance;
    private static String title = "";
    private static String artist = "";
    private static String album = "";
    private static boolean playing = false;
    private static long position = 0;
    private static long duration = 0;
    private static float rate = 1f;

    private MediaSession session;

    static synchronized void update(Context ctx, String t, String a, String al, boolean p, long pos, long dur, float r) {
        title = t == null ? "" : t;
        artist = a == null ? "" : a;
        album = al == null ? "" : al;
        playing = p;
        position = pos;
        duration = dur;
        rate = r <= 0 ? 1f : r;
        MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.render();
            return;
        }
        if (!p) return; // never start the service just to show a paused state
        Intent i = new Intent(ctx, MediaPlaybackService.class).setAction(ACTION_UPDATE);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (RuntimeException ignored) {
            // background-start restrictions: playback continues, only the notification is skipped
        }
    }

    static void stop(Context ctx) {
        MediaPlaybackService svc = instance;
        if (svc != null) {
            svc.stopForeground(true);
            svc.stopSelf();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Media playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "WebPlayback");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play", -1); }
            @Override public void onPause() { send("pause", -1); }
            @Override public void onSkipToNext() { send("nexttrack", -1); }
            @Override public void onSkipToPrevious() { send("previoustrack", -1); }
            @Override public void onStop() { send("stop", -1); }
            @Override public void onSeekTo(long pos) { send("seekto", pos); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            send("pause", -1);
            return START_NOT_STICKY;
        }
        if (action != null && action.startsWith("__PACKAGE__.media.CMD.")) {
            send(action.substring("__PACKAGE__.media.CMD.".length()), -1);
            return START_NOT_STICKY;
        }
        render();
        return START_NOT_STICKY;
    }

    private static void send(String action, long pos) {
        Listener l = listener;
        if (l != null) l.onAction(action, pos);
    }

    private PendingIntent cmd(String name) {
        Intent i = new Intent(this, MediaPlaybackService.class).setAction("__PACKAGE__.media.CMD." + name);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, name.hashCode(), i, flags);
    }

    private void render() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? rate : 0f)
            .build());
        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (duration > 0) md.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        session.setMetadata(md.build());

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = launch == null ? null : PendingIntent.getActivity(
            this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
            .setContentTitle(title.isEmpty() ? "Playing" : title)
            .setContentText(artist)
            .setSubText(album.isEmpty() ? null : album)
            .setContentIntent(content)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .setDeleteIntent(cmd("stop"))
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", cmd("previoustrack")).build())
            .addAction(playing
                ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", cmd("pause")).build()
                : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Play", cmd("play")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", cmd("nexttrack")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        // Paused: leave the notification up but swipeable, and let the service stop being foreground.
        if (!playing) stopForeground(false);
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
