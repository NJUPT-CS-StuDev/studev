package top.hicancan.studev

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import top.hicancan.studev.navigation.StudevApp
import top.hicancan.studev.ui.theme.StuDevTheme
import top.hicancan.studev.activity.ActivityHost
import top.hicancan.studev.activity.ActivityLinks

class MainActivity : ComponentActivity() {
    private var place by mutableStateOf<String?>(null)
    private var activityLink by mutableStateOf<String?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) readLink(intent) else { place = savedInstanceState.getString("pendingPlace"); activityLink = savedInstanceState.getString("pendingActivity") }
        setContent { StuDevTheme { ActivityHost(activityLink, onLinkHandled = { activityLink = null }, onPlace = { place = it }) { StudevApp(place, onDeepLinkHandled = { place = null }) } } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); readLink(intent) }
    override fun onSaveInstanceState(outState: Bundle) { outState.putString("pendingPlace", place); outState.putString("pendingActivity", activityLink); super.onSaveInstanceState(outState) }
    private fun readLink(intent: Intent) {
        val uri = intent.data ?: return
        if (ActivityLinks.parse(uri.toString()) != null) { activityLink = uri.toString(); return }
        if (uri.scheme == "https" && uri.host == "studev.hicancan.top" && uri.path?.trimEnd('/') == "/map") {
            place = uri.getQueryParameter("place")
        }
    }
}
