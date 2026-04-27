package com.obubba.app.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.obubba.app.MainActivity;
import com.obubba.app.R;

public class TimerService extends Service {

    private static final String CHANNEL_ID = "obubba_timers";
    private static final int NOTIFICATION_ID = 99999;
    private static final long UPDATE_INTERVAL_MS = 10000; // 10 seconds
    public static final String PREFS_NAME = "obubba_timer_state";

    public static final String ACTION_START = "com.obubba.app.TIMER_START";
    public static final String ACTION_STOP = "com.obubba.app.TIMER_STOP";
    public static final String ACTION_UPDATE = "com.obubba.app.TIMER_UPDATE";
    public static final String ACTION_START_PREDICTION = "com.obubba.app.PREDICTION_START";
    public static final String ACTION_STOP_PREDICTION = "com.obubba.app.PREDICTION_STOP";

    public static final String EXTRA_START_TIME = "startTime";
    public static final String EXTRA_TIMER_TYPE = "timerType";
    public static final String EXTRA_BABY_NAME = "babyName";
    public static final String EXTRA_SIDE = "side";
    public static final String EXTRA_TARGET_TIME = "targetTime";
    public static final String EXTRA_LABEL = "label";
    public static final String EXTRA_TIME_FORMATTED = "timeFormatted";

    private static final int PREDICTION_NOTIFICATION_ID = 99998;

    private Handler handler;
    private Runnable updateRunnable;
    private Runnable predictionRunnable;
    private long startTimeMs;
    private String timerType;
    private String babyName;
    private String side;
    private boolean running = false;
    private boolean predictionRunning = false;
    private long predictionTargetMs;
    private String predictionLabel;
    private String predictionTimeFormatted;
    private String predictionBabyName;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        ensureNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // When Android restarts the service after killing it, intent is null.
        // Recover from persisted state instead of dying.
        if (intent == null) {
            if (restoreTimerState()) {
                startTimer();
                return START_STICKY;
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (action == null) action = ACTION_START;

        switch (action) {
            case ACTION_STOP:
                clearTimerState();
                stopTimer();
                return START_NOT_STICKY;

            case ACTION_UPDATE:
                if (!running) {
                    stopSelf();
                    return START_NOT_STICKY;
                }
                // Update side for breast feeding switch
                if (intent.hasExtra(EXTRA_SIDE)) {
                    side = intent.getStringExtra(EXTRA_SIDE);
                }
                if (intent.hasExtra(EXTRA_BABY_NAME)) {
                    babyName = intent.getStringExtra(EXTRA_BABY_NAME);
                }
                saveTimerState();
                updateNotification();
                return START_STICKY;

            case ACTION_START_PREDICTION:
                stopPrediction();
                predictionTargetMs = intent.getLongExtra(EXTRA_TARGET_TIME, 0);
                predictionLabel = intent.getStringExtra(EXTRA_LABEL);
                predictionTimeFormatted = intent.getStringExtra(EXTRA_TIME_FORMATTED);
                predictionBabyName = intent.getStringExtra(EXTRA_BABY_NAME);
                if (predictionLabel == null) predictionLabel = "Next event";
                if (predictionBabyName == null) predictionBabyName = "Baby";
                startPrediction();
                return START_STICKY;

            case ACTION_STOP_PREDICTION:
                stopPrediction();
                if (!running) { stopSelf(); }
                return START_NOT_STICKY;

            case ACTION_START:
            default:
                stopPrediction(); // prediction goes away when a real timer starts
                startTimeMs = intent.getLongExtra(EXTRA_START_TIME, System.currentTimeMillis());
                timerType = intent.getStringExtra(EXTRA_TIMER_TYPE);
                babyName = intent.getStringExtra(EXTRA_BABY_NAME);
                side = intent.getStringExtra(EXTRA_SIDE);
                if (timerType == null) timerType = "feed";
                if (babyName == null) babyName = "Baby";
                saveTimerState();
                startTimer();
                return START_STICKY;
        }
    }

    private void startTimer() {
        running = true;
        acquireWakeLock();

        // Build initial notification and start foreground
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);

        // Schedule periodic updates
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) return;
                updateNotification();
                handler.postDelayed(this, UPDATE_INTERVAL_MS);
            }
        };
        handler.postDelayed(updateRunnable, UPDATE_INTERVAL_MS);
    }

    private void stopTimer() {
        running = false;
        if (handler != null && updateRunnable != null) {
            handler.removeCallbacks(updateRunnable);
        }
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private Notification buildNotification() {
        // Intent to open the app when tapped
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = buildTitle();
        String body = formatElapsedTime();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#C07088"))
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setUsesChronometer(false)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        return builder.build();
    }

    private String buildTitle() {
        switch (timerType) {
            case "feed":
                String feedTitle = "\uD83C\uDF7C Feeding " + babyName;
                if (side != null && !side.isEmpty()) {
                    feedTitle += " \u2014 " + side + " side";
                }
                return feedTitle;
            case "nap":
                return "\uD83D\uDE34 " + babyName + " is napping";
            case "sleep":
                return "\uD83C\uDF19 " + babyName + " \u2014 bedtime";
            default:
                return "\u23F1 Timer running for " + babyName;
        }
    }

    private String formatElapsedTime() {
        long elapsedMs = System.currentTimeMillis() - startTimeMs;
        if (elapsedMs < 0) elapsedMs = 0;
        long totalSeconds = elapsedMs / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;

        if (hours > 0) {
            return hours + "h " + minutes + "m " + seconds + "s";
        } else {
            return minutes + "m " + seconds + "s";
        }
    }

    private void startPrediction() {
        predictionRunning = true;
        Notification notification = buildPredictionNotification();
        if (!running) {
            startForeground(PREDICTION_NOTIFICATION_ID, notification);
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(PREDICTION_NOTIFICATION_ID, notification);
        }
        predictionRunnable = new Runnable() {
            @Override
            public void run() {
                if (!predictionRunning) return;
                long remaining = predictionTargetMs - System.currentTimeMillis();
                if (remaining <= 0) {
                    stopPrediction();
                    if (!running) stopSelf();
                    return;
                }
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.notify(PREDICTION_NOTIFICATION_ID, buildPredictionNotification());
                handler.postDelayed(this, 60000); // update every minute
            }
        };
        handler.postDelayed(predictionRunnable, 60000);
    }

    private void stopPrediction() {
        predictionRunning = false;
        if (handler != null && predictionRunnable != null) {
            handler.removeCallbacks(predictionRunnable);
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(PREDICTION_NOTIFICATION_ID);
        if (!running) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        }
    }

    private Notification buildPredictionNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 1, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        long remaining = predictionTargetMs - System.currentTimeMillis();
        String countdown;
        if (remaining <= 0) {
            countdown = "Any moment now";
        } else {
            long mins = remaining / 60000;
            if (mins >= 60) {
                countdown = (mins / 60) + "h " + (mins % 60) + "m";
            } else {
                countdown = mins + " min";
            }
        }

        String title = "\uD83D\uDD2E " + predictionLabel + " at " + (predictionTimeFormatted != null ? predictionTimeFormatted : "");
        String body = countdown + " \u2014 " + predictionBabyName;

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#C07088"))
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Active Timers",
                    NotificationManager.IMPORTANCE_LOW // Low = no sound, but visible
            );
            channel.setDescription("Shows while a feed, nap, or bedtime timer is running");
            channel.enableVibration(false);
            channel.setSound(null, null);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    // ── State persistence: survives process death ──

    private void saveTimerState() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putLong("startTimeMs", startTimeMs)
                .putString("timerType", timerType)
                .putString("babyName", babyName)
                .putString("side", side)
                .putBoolean("running", true)
                .apply();
    }

    private boolean restoreTimerState() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("running", false)) return false;

        startTimeMs = prefs.getLong("startTimeMs", 0);
        if (startTimeMs == 0) return false;

        // Don't resurrect timers older than 16 hours — they're stale (bed timers can run up to 16h)
        if (System.currentTimeMillis() - startTimeMs > 16 * 3600 * 1000L) {
            clearTimerState();
            return false;
        }

        timerType = prefs.getString("timerType", "feed");
        babyName = prefs.getString("babyName", "Baby");
        side = prefs.getString("side", null);
        return true;
    }

    private void clearTimerState() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
    }

    // ── WakeLock: prevents Samsung/OEM aggressive killing ──

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "obubba:timer");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(16 * 60 * 60 * 1000L); // 16h max (covers bed timers), auto-releases
            }
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    // ── Survive app swipe-away from recents ──

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (running) {
            // Reschedule the service so it restarts after being swiped away
            Intent restartIntent = new Intent(this, TimerService.class);
            restartIntent.setAction(ACTION_START);
            restartIntent.putExtra(EXTRA_START_TIME, startTimeMs);
            restartIntent.putExtra(EXTRA_TIMER_TYPE, timerType);
            restartIntent.putExtra(EXTRA_BABY_NAME, babyName);
            if (side != null) restartIntent.putExtra(EXTRA_SIDE, side);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent);
            } else {
                startService(restartIntent);
            }
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        predictionRunning = false;
        if (handler != null) {
            if (updateRunnable != null) handler.removeCallbacks(updateRunnable);
            if (predictionRunnable != null) handler.removeCallbacks(predictionRunnable);
        }
        releaseWakeLock();
        super.onDestroy();
    }
}
