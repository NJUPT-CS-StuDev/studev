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
@Composable fun AccountHost(campusLink: String?, content: @Composable (onAccount: () -> Unit, onForm: (FormRequest) -> Unit, onMembers: (() -> Unit) -> Unit) -> Unit) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    var open by rememberSaveable { mutableStateOf(false) }
    var form by remember { mutableStateOf<FormRequest?>(null) }
    var members by rememberSaveable { mutableStateOf<String?>(null) }
    var memberQuery by rememberSaveable { mutableStateOf("") }
    var memberReturn by remember { mutableStateOf<(() -> Unit)?>(null) }
    LaunchedEffect(client) { runCatching { if (client.current() != null) client.state() } }
    LaunchedEffect(campusLink) { if (campusLink != null) {
        val uri = android.net.Uri.parse(campusLink)
        when (uri.path.orEmpty().trimEnd('/')) {
            "/members" -> { open = false; form = null; memberReturn = null; members = uri.getQueryParameter("id").orEmpty(); memberQuery = uri.getQueryParameter("query").orEmpty() }
            "/account", "/login" -> { members = null; form = null; memberReturn = null; open = true }
        }
        Forms.fromLink(campusLink)?.let { open = false; form = it }
    } }
    Box(Modifier.fillMaxSize()) {
        content({ open = true }, { form = it }, { back -> memberReturn = back; memberQuery = ""; members = "" })
        members?.let { id -> Surface(Modifier.fillMaxSize()) { top.hicancan.studev.me.MembersScreen(client, id.ifBlank { null }, memberQuery) { members = null; memberReturn?.invoke(); memberReturn = null } } }
        // Each layer takes back over the campus beneath it; what opens within it (signing in over a form) takes it first.
        form?.let { request -> Surface(Modifier.fillMaxSize()) { BackHandler { form = null }; key(request) { FormScreen(client, request) { form = null } } } }
        if (open) Surface(Modifier.fillMaxSize().testTag("account-host")) {
            BackHandler { open = false }
            AccountScreen(client, onBack = { open = false })
        }
    }
}
