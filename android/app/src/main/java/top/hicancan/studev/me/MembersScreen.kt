package top.hicancan.studev.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import top.hicancan.studev.account.*
import top.hicancan.studev.app.*

/** Only the public member projection reaches this page. Private account records stay in AccountScreen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun MembersScreen(client: AccountClient, initialId: String? = null, initialQuery: String = "", onBack: () -> Unit) {
    val account by client.user.collectAsStateWithLifecycle()
    var authLoaded by remember { mutableStateOf(false) }
    var signingIn by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf(initialQuery) }
    var selected by rememberSaveable { mutableStateOf(initialId) }
    var detail by remember { mutableStateOf<PublicMember?>(null) }
    var members by remember { mutableStateOf<List<PublicMember>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var generation by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(client) { try { client.current() } finally { authLoaded = true } }
    suspend fun load(reset: Boolean) {
        val visit = ++generation
        loading = true; error = null
        if (reset) members = emptyList()
        try {
            val page = client.members(query.trim(), if (reset) 0 else members.size)
            if (generation == visit) { members = if (reset) page.items else (members + page.items).distinctBy { it.id }; total = page.total }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (generation == visit) error = if (failure is PlatformFailure) failure.message else "成员暂时无法加载，请重试。" }
        finally { if (generation == visit) loading = false }
    }
    LaunchedEffect(query, account?.id, attempt, authLoaded, signingIn, selected) {
        if (!authLoaded || signingIn || account == null || selected != null) return@LaunchedEffect
        if (query.isNotBlank()) delay(250)
        load(true)
    }
    LaunchedEffect(selected, account?.id, attempt, signingIn) {
        val id = selected ?: return@LaunchedEffect
        if (signingIn || account == null || detail?.id == id) return@LaunchedEffect
        loading = true; error = null
        try { detail = client.member(id) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = if (failure is PlatformFailure) failure.message else "资料暂时无法加载，请重试。" }
        finally { loading = false }
    }
    if (signingIn) {
        BackHandler { signingIn = false }
        AccountScreen(client, onBack = { signingIn = false }, onSignedIn = { signingIn = false })
        return
    }
    fun back() { if (selected != null) { selected = null; detail = null; error = null } else onBack() }
    BackHandler { back() }
    Scaffold(topBar = { TopAppBar(title = { Text(if (selected != null) "成员资料" else "成员") }, navigationIcon = { IconButton({ back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = Tokens.Space.l.dp)) {
            if (!authLoaded) { LinearProgressIndicator(Modifier.fillMaxWidth()); return@Column }
            if (account == null) {
                Spacer(Modifier.height(24.dp)); Plain("登录后查看成员", 19.sp, weight = FontWeight.SemiBold)
                TextAction("登录", { signingIn = true }); return@Column
            }
            if (selected == null) {
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("搜索昵称") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, shape = RoundedCornerShape(Tokens.Radius.pill.dp))
                Plain("共 $total 位成员", 12.sp, Ink.muted, modifier = Modifier.padding(vertical = 12.dp))
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Plain(it, 14.sp, MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 12.dp)); TextAction("重试", { detail = null; attempt++ }, refresh = true) }
            if (selected != null) {
                detail?.let { member ->
                    Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        MemberFace(member, 88)
                        Plain(member.nickname, 26.sp, weight = FontWeight.SemiBold)
                        Plain(member.signature.ifBlank { "还没有签名" }, 15.sp, Ink.muted)
                    }
                }
            } else LazyColumn(Modifier.weight(1f)) {
                items(members, key = { it.id }) { member ->
                    Row(Modifier.fillMaxWidth().bottomHairline(Ink.line).clickable { detail = member; selected = member.id }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        MemberFace(member, 48)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Plain(member.nickname, 16.sp, weight = FontWeight.SemiBold, maxLines = 1)
                            if (member.signature.isNotBlank()) Plain(member.signature, 13.sp, Ink.muted, maxLines = 2)
                        }
                        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(16.dp), tint = Ink.faint)
                    }
                }
                if (members.isEmpty() && !loading && error == null) item { Plain("没有找到这个昵称", 14.sp, Ink.muted, modifier = Modifier.padding(vertical = 24.dp)) }
                if (members.size < total && !loading) item { TextAction("加载更多", { scope.launch { load(false) } }, modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
}

@Composable private fun MemberFace(member: PublicMember, size: Int) = AvatarImage(member.avatarUrl, Modifier.size(size.dp).background(Ink.sunken, CircleShape)) {
    Plain(avatarLetter(member.nickname), (size * .36f).sp, Ink.brand, FontWeight.SemiBold)
}
