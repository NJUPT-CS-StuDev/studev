package top.hicancan.studev.activity

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import top.hicancan.studev.account.AccountScreen
import top.hicancan.studev.account.Accounts

/** One root registration. Map modules can call ActivityEntryPoints.createAt. */
@Composable fun ActivityHost(link: String?, campusLink: String?, onLinkHandled: () -> Unit, onPlace: (String) -> Unit, content: @Composable (onActivities: () -> Unit, onAccount: () -> Unit) -> Unit) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    val service = remember { Activities(client) }
    var screen by rememberSaveable { mutableStateOf("map") }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var draftPlace by rememberSaveable { mutableStateOf<String?>(null) }
    val pending by ActivityEntryPoints.pendingPlace.collectAsStateWithLifecycle()
    LaunchedEffect(link) { ActivityLinks.parse(link)?.let { selected = it; screen = "activities"; onLinkHandled() } }
    LaunchedEffect(campusLink) { if (campusLink != null) screen = "map" }
    LaunchedEffect(pending) { pending?.let { draftPlace = activityJson.encodeToString<ActivityPlace>(it); selected = null; screen = "create"; ActivityEntryPoints.pendingPlace.value = null } }
    var accountReturn by rememberSaveable { mutableStateOf("map") }
    Box(Modifier.fillMaxSize()) {
        content({ screen = "activities" }, { accountReturn = "map"; screen = "account" })
        if (screen != "map") Surface(Modifier.fillMaxSize().testTag("activity-host-$screen")) {
            when (screen) {
                "account" -> AccountScreen(client, onBack = { screen = accountReturn }, onSignedIn = { screen = accountReturn })
                "create" -> ActivityEditor(service, client, draftPlace?.let { activityJson.decodeFromString<ActivityPlace>(it) },
                    onBack = { screen = "activities" }, onSignIn = { accountReturn = "create"; screen = "account" }, onSaved = { selected = it.id; draftPlace = null; screen = "activities" })
                else -> ActivitiesScreen(service, client, selected, onSelect = { selected = it }, onBack = { if (selected != null) selected = null else screen = "map" },
                    onAccount = { accountReturn = "activities"; screen = "account" }, onCreate = { selected = null; draftPlace = null; screen = "create" },
                    onPlace = { onPlace(it); screen = "map" })
            }
        }
    }
    // Register after the campus content so an overlay owns Back while it is open.
    BackHandler(enabled = screen != "map") {
        if (screen == "activities" && selected != null) selected = null
        else screen = when (screen) { "account" -> accountReturn; "create" -> "activities"; else -> "map" }
    }
}
