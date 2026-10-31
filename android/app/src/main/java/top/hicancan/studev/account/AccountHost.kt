package top.hicancan.studev.account

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag

@Composable fun AccountHost(campusLink: String?, content: @Composable (onAccount: () -> Unit) -> Unit) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    var open by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(campusLink) { if (campusLink != null) open = false }
    Box(Modifier.fillMaxSize()) {
        content { open = true }
        if (open) Surface(Modifier.fillMaxSize().testTag("account-host")) {
            AccountScreen(client, onBack = { open = false })
        }
    }
    BackHandler(enabled = open) { open = false }
}
