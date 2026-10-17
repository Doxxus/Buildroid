package __PACKAGE__;

import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Persists which directory Capacitor serves over https://localhost (same preference Capacitor reads on startup),
 * and hardens the WebView.
 */
@CapacitorPlugin(name = "BundlePointer")
public class BundlePointerPlugin extends Plugin {
    private static final String PREFS = "CapWebViewSettings";
    private static final String KEY = "serverBasePath";

    @Override
    public void load() {
        WebView wv = getBridge().getWebView();
        WebSettings s = wv.getSettings();
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void activate(PluginCall call) {
        String path = call.getString("path");
        try {
            if (path == null) throw new IllegalArgumentException("path required");
            File dir = new File(path).getCanonicalFile();
            String root = getContext().getFilesDir().getCanonicalPath() + File.separator;
            if (!dir.getPath().startsWith(root)) throw new SecurityException("path outside app data");
            if (!new File(dir, "index.html").isFile()) throw new IllegalStateException("index.html missing");
            // commit() (synchronous) so a failure is reported and the caller can roll back
            if (!prefs().edit().putString(KEY, dir.getPath()).commit()) throw new IllegalStateException("persist failed");
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "activate failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void reloadNow(PluginCall call) {
        final String path = prefs().getString(KEY, null);
        if (path == null) {
            call.reject("no active bundle");
            return;
        }
        getBridge().executeOnMainThread(() -> getBridge().setServerBasePath(path));
        call.resolve();
    }
}
