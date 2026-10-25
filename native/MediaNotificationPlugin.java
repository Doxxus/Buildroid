package __PACKAGE__;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Bridges the page's media state to {@link MediaPlaybackService} (system media notification) and back. */
@CapacitorPlugin(
    name = "MediaNotification",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
)
public class MediaNotificationPlugin extends Plugin {
    @Override
    public void load() {
        MediaPlaybackService.listener = (action, pos) -> {
            JSObject o = new JSObject();
            o.put("action", action);
            if (pos >= 0) o.put("position", pos / 1000.0);
            notifyListeners("mediaAction", o);
        };
    }

    @Override
    protected void handleOnDestroy() {
        MediaPlaybackService.listener = null;
        MediaPlaybackService.stop(getContext());
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        apply(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        // Still shown as a media session even if denied; the notification itself may be hidden by the system.
        apply(call);
    }

    private void apply(PluginCall call) {
        MediaPlaybackService.update(
            getContext(),
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            Boolean.TRUE.equals(call.getBoolean("playing", false)),
            (long) (call.getDouble("position", 0.0) * 1000),
            (long) (call.getDouble("duration", 0.0) * 1000),
            call.getFloat("rate", 1f)
        );
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MediaPlaybackService.stop(getContext());
        call.resolve();
    }
}
