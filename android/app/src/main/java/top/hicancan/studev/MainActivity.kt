package top.hicancan.studev

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import top.hicancan.studev.campus.CampusApp
import top.hicancan.studev.ui.theme.StuDevTheme
import top.hicancan.studev.activities.ActivityHost
import top.hicancan.studev.activities.ActivityLinks
import top.hicancan.studev.account.PLATFORM_ORIGIN

class MainActivity : ComponentActivity() {
    private var place by mutableStateOf<String?>(null)
    private var activityLink by mutableStateOf<String?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        if (android.os.Build.VERSION.SDK_INT < 31) {
            val theme = top.hicancan.studev.me.CampusSettings(this).state.value.theme
            if (theme != "system") applyOverrideConfiguration(android.content.res.Configuration().apply {
                uiMode = if (theme == "dark") android.content.res.Configuration.UI_MODE_NIGHT_YES else android.content.res.Configuration.UI_MODE_NIGHT_NO
            })
        }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) readLink(intent) else { place = savedInstanceState.getString("pendingPlace"); activityLink = savedInstanceState.getString("pendingActivity") }
        setContent { StuDevTheme {
            ActivityHost(activityLink, campusLink = place, onLinkHandled = { activityLink = null }, onPlace = {
                place = android.net.Uri.Builder().scheme("https").authority(android.net.Uri.parse(PLATFORM_ORIGIN).host).path("/map/").appendQueryParameter("place", it).build().toString()
            }) { onActivities, onAccount ->
                CampusApp(place, onDeepLinkHandled = { place = null }, onActivities = onActivities, onAccount = onAccount)
            }
        } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); readLink(intent) }
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        // Compose and the map restyle from LocalConfiguration. Keep the native
        // surface attached, and update the system bars for the new palette too.
        enableEdgeToEdge()
    }
    override fun onSaveInstanceState(outState: Bundle) { outState.putString("pendingPlace", place); outState.putString("pendingActivity", activityLink); super.onSaveInstanceState(outState) }
    private fun readLink(intent: Intent) {
        val uri = intent.data ?: return
        if (ActivityLinks.parse(uri.toString()) != null) { place = null; activityLink = uri.toString(); return }
        if (uri.scheme == "https" && uri.host == android.net.Uri.parse(PLATFORM_ORIGIN).host) {
            activityLink = null
            place = uri.toString()
        }
    }
}
