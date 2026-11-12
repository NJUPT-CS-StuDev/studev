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

/** The account and the campus's forms, over the campus. A link to a form on the website opens it here. */
@Composable fun AccountHost(campusLink: String?, content: @Composable (onAccount: () -> Unit, onForm: (FormRequest) -> Unit) -> Unit) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    var open by rememberSaveable { mutableStateOf(false) }
    var form by remember { mutableStateOf<FormRequest?>(null) }
    LaunchedEffect(campusLink) { if (campusLink != null) Forms.fromLink(campusLink)?.let { open = false; form = it } }
    Box(Modifier.fillMaxSize()) {
        content({ open = true }, { form = it })
        form?.let { request -> Surface(Modifier.fillMaxSize()) { key(request) { FormScreen(client, request) { form = null } } } }
        if (open) Surface(Modifier.fillMaxSize().testTag("account-host")) {
            AccountScreen(client, onBack = { open = false })
        }
    }
    BackHandler(enabled = open) { open = false }
    BackHandler(enabled = form != null && !open) { form = null }
}
