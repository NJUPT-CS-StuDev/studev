package top.hicancan.studev.account

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.background
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import top.hicancan.studev.app.Tokens
import top.hicancan.studev.app.KeyRow
import top.hicancan.studev.app.QqAvatarImage
import top.hicancan.studev.app.TextAction
import top.hicancan.studev.app.Choice
import top.hicancan.studev.world.CampusDay

/** The avatar Tencent shows for this QQ number, for checking it really is yours before registering. */
@Composable private fun QqPreview(qq: String) {
    if (!qqNumber.matches(qq)) return
    var requested by remember(qq) { mutableStateOf("") }
    LaunchedEffect(qq) {
        kotlinx.coroutines.delay(400)
        requested = qq
    }
    Row(Modifier.fillMaxWidth().testTag("qq-preview"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QqAvatarImage(requested, Modifier.size(36.dp), description = "QQ 头像") {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHigh))
        }
        Column {
            Text("联系邮箱：$qq@qq.com", style = MaterialTheme.typography.bodyMedium)
            Text("请核对邮箱。通知和找回密码的邮件会发到这里。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun SecretField(label: String, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(value, { onChange(it.take(256)) }, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = true, enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (visible) "隐藏$label" else "显示$label") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AccountScreen(client: AccountClient, onBack: () -> Unit, onSignedIn: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AccountUser?>(null) }
    var state by remember { mutableStateOf<AccountState?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var register by rememberSaveable { mutableStateOf(false) }
    var agreed by rememberSaveable { mutableStateOf(false) }
    var section by rememberSaveable { mutableStateOf("profile") }
    var student by rememberSaveable { mutableStateOf("") }
    var realName by rememberSaveable { mutableStateOf("") }
    var nickname by rememberSaveable { mutableStateOf("") }
    var qq by rememberSaveable { mutableStateOf("") }
    var signature by rememberSaveable { mutableStateOf("") }
    // Secrets are never saved in instance state, logs or ordinary preferences.
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var totp by remember { mutableStateOf("") }
    var loginFactorRequired by remember { mutableStateOf(false) }
    var trustDevice by remember { mutableStateOf(false) }
    var secret by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf<List<String>>(emptyList()) }
    var devices by remember { mutableStateOf<List<AccountDevice>>(emptyList()) }
    var trustedDevices by remember { mutableStateOf<List<AccountDevice>>(emptyList()) }
    var devicesFor by remember { mutableStateOf<String?>(null) }
    var devicesLoading by remember { mutableStateOf(false) }
    var devicesError by remember { mutableStateOf<String?>(null) }
    var verifying by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOut by remember { mutableStateOf(false) }
    var revoke by remember { mutableStateOf<AccountDevice?>(null) }
    var revokeTrust by remember { mutableStateOf<AccountDevice?>(null) }
    fun resetLoginFactor() {
        if (loginFactorRequired) notice = null
        totp = ""; loginFactorRequired = false; trustDevice = false
    }
    fun showUser(fresh: AccountUser) {
        user = fresh
        student = fresh.studentId; realName = fresh.realName; nickname = fresh.nickname; signature = fresh.signature
    }
    fun showState(fresh: AccountState) {
        state = fresh; showUser(fresh.user)
    }
    suspend fun reload() {
        showState(client.state())
    }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; notice = null
        scope.launch {
            try { action() }
            catch (failure: CancellationException) { throw failure }
            catch (failure: Exception) {
                error = if (failure is PlatformFailure) failure.message else "连接未完成，请检查网络后重试。"
                if (failure is PlatformFailure && failure.status == 401 && failure.code in listOf("TOKEN_INVALID", "AUTH_REQUIRED", "REFRESH_REPLAYED")) {
                    client.forget(); user = null; state = null; devices = emptyList(); trustedDevices = emptyList(); devicesFor = null
                }
            } finally { busy = false }
        }
    }
    suspend fun loadDevices() {
        if (devicesLoading) return
        val owner = user ?: return
        devicesLoading = true; devicesError = null
        try {
            val (signedIn, trusted) = coroutineScope {
                val sessions = async { client.devices() }
                val remembered = if (owner.totpEnabled) async { client.trustedDevices() } else null
                sessions.await() to remembered?.await().orEmpty()
            }
            if (user?.id == owner.id) { devices = signedIn; trustedDevices = trusted; devicesFor = owner.id }
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) {
            devicesError = if (failure is PlatformFailure) failure.message else "暂时看不了登录设备，请再试一次。"
        } finally { devicesLoading = false }
    }
    LaunchedEffect(client) {
        try {
            val saved = client.current()
            if (saved != null) {
                showUser(saved); loaded = true; verifying = true
                reload()
            }
        }
        catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = if (failure is PlatformFailure) failure.message else "暂时打不开账号页，请再试一次。"; if (failure is PlatformFailure && failure.status == 401) { client.forget(); user = null } }
        finally { loaded = true; verifying = false }
    }
    LaunchedEffect(section, user?.id) { if (section == "devices" && user != null && devicesFor != user?.id) loadDevices() }
    Scaffold(topBar = { TopAppBar(title = { Text("账号") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(Tokens.Space.xl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
            if (!loaded) { Text("正在打开账号页…", color = MaterialTheme.colorScheme.onSurfaceVariant); return@Column }
            Text(if (user == null) if (register) "注册 StuDev" else "登录 StuDev" else user!!.nickname, style = MaterialTheme.typography.headlineMedium)
            Text(if (user == null) "每位同学都可以注册，网页与 App 共用一个账号。" else "学号 ${user!!.studentId}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error) }
            notice?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.primary) }
            if (verifying) Text("正在验证登录状态…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (user != null && state == null && !verifying) TextAction("重试", { run { reload() } }, refresh = true)
            if (user == null) {
                Choice(listOf("login" to "登录", "register" to "注册"), if (register) "register" else "login") { value -> if (!busy) { register = value == "register"; password = ""; confirm = ""; resetLoginFactor(); error = null; notice = null } }
                OutlinedTextField(student, { student = it.take(20); resetLoginFactor() }, Modifier.fillMaxWidth(), label = { Text("学号") }, singleLine = true, enabled = !busy)
                if (register) {
                    OutlinedTextField(realName, { realName = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("真实姓名") }, singleLine = true, enabled = !busy)
                    OutlinedTextField(nickname, { nickname = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("昵称（选填）") }, supportingText = { Text("留空就用默认昵称。其他同学可以看到你的昵称、头像和签名。") }, singleLine = true, enabled = !busy)
                    OutlinedTextField(qq, { qq = it.take(12) }, Modifier.fillMaxWidth(), label = { Text("联系 QQ") }, supportingText = { Text("用这个 QQ 邮箱收通知、找回密码或确认注销。也可以用它的 QQ 头像。") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, enabled = !busy)
                    QqPreview(qq)
                }
                SecretField("密码", password, !busy) { password = it; resetLoginFactor() }
                if (register) {
                    SecretField("确认密码", confirm, !busy) { confirm = it }
                    Text("密码需要 12–256 个字符。学号被占用时，请联系管理员核实。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = agreed, onCheckedChange = { agreed = it }, enabled = !busy)
                        Column(Modifier.weight(1f)) {
                            Text("我已阅读并同意《用户协议》与《隐私政策》，承诺不使用学校统一身份认证密码。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/terms/"))) }, contentPadding = PaddingValues(0.dp)) { Text("用户协议", style = MaterialTheme.typography.bodySmall) }
                                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/privacy/"))) }, contentPadding = PaddingValues(0.dp)) { Text("隐私政策", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                }
                else if (loginFactorRequired) {
                    OutlinedTextField(totp, { totp = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("动态验证码或恢复码") }, singleLine = true, enabled = !busy)
                    Row(Modifier.fillMaxWidth().toggleable(value = trustDevice, enabled = !busy, role = Role.Checkbox, onValueChange = { trustDevice = it }),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Checkbox(checked = trustDevice, onCheckedChange = null, enabled = !busy)
                        Column(Modifier.weight(1f)) {
                            Text("信任此设备 30 天")
                            Text("仅在自己的设备上勾选。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                Button(onClick = { run {
                    if (register) {
                        if (password != confirm) { error = "两次输入的密码不一致。"; return@run }
                        client.register(student, realName, nickname, qq, password)
                        register = false; password = ""; confirm = ""; resetLoginFactor(); notice = "注册成功，请使用学号和密码登录。"
                    } else {
                        try {
                            showState(client.signIn(student, password, totp, "${Build.MANUFACTURER} ${Build.MODEL}", trustDevice))
                        } catch (failure: PlatformFailure) {
                            if (failure.code != "MFA_REQUIRED") throw failure
                            loginFactorRequired = true; notice = "请输入认证器里的动态验证码，也可用一次性恢复码。"
                            return@run
                        }
                        section = "profile"; devices = emptyList(); trustedDevices = emptyList(); devicesFor = null
                        password = ""; resetLoginFactor(); onSignedIn()
                    }
                } }, Modifier.fillMaxWidth().testTag("account-submit"), enabled = !busy && student.isNotBlank() && password.isNotBlank() &&
                    (if (register) realName.isNotBlank() && qq.isNotBlank() && confirm.isNotBlank() && agreed else !loginFactorRequired || totp.isNotBlank())) {
                    if (busy) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                    Text(if (busy) if (register) "正在注册…" else "正在登录…" else if (register) "创建账号" else "登录")
                }
                if (!register) TextButton(onClick = { run {
                    val id = student.trim().uppercase()
                    if (!Regex("[A-Z0-9]{6,20}").matches(id)) { error = "请先在上面填写学号。"; return@run }
                    client.request("/auth/password/forgot", buildJsonObject { put("studentId", id) })
                    notice = "如果这个学号有账号，重设链接已经发到它绑定的 QQ 邮箱，请在 30 分钟内打开。没收到的话看看垃圾箱。"
                } }, enabled = !busy, contentPadding = PaddingValues(0.dp)) { Text("忘记密码？发邮件找回") }
            } else {
                Choice(listOf("profile" to "我的账号", "security" to "账号安全", "devices" to "登录设备"), section) { value -> if (!busy) { section = value; password = ""; newPassword = ""; confirm = ""; totp = ""; secret = ""; recovery = emptyList() } }
                if (state?.passwordChangeRequired == true || state?.enrollmentRequired == true) Text("请先在「账号安全」中${if (state?.passwordChangeRequired == true) "修改临时密码" else "绑定认证器"}，完成账号设置。", color = MaterialTheme.colorScheme.primary)
                when (section) {
                    "profile" -> {
                        // The same profile as the web: what the account is, read only; then the two things one may change.
                        val me = user!!
                        val incomplete = state?.profileRequired == true || !me.profileComplete
                        val blocked = state == null || state?.passwordChangeRequired == true || state?.enrollmentRequired == true || state?.mfaRequired == true
                        if (incomplete) {
                            Text("请补填学号和姓名。", color = MaterialTheme.colorScheme.primary)
                            OutlinedTextField(student, { student = it.take(20) }, Modifier.fillMaxWidth(), label = { Text("学号") }, readOnly = me.studentId.isNotBlank(), singleLine = true, enabled = !busy)
                            OutlinedTextField(realName, { realName = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("真实姓名") }, readOnly = me.realName.isNotBlank(), singleLine = true, enabled = !busy)
                        }
                        Text("个人资料", style = MaterialTheme.typography.titleSmall)
                        listOf(
                            "学号" to me.studentId.ifBlank { "待补充" }, "姓名" to me.realName.ifBlank { "待补充" }, "昵称" to me.nickname,
                            "QQ 号" to me.qq, "联系邮箱" to me.email.ifBlank { "${me.qq}@qq.com" },
                        ).forEach { (key, value) -> KeyRow(key, value) }
                        for (membership in me.memberships) {
                            KeyRow("所在组织", listOf(membership.organizationName, membership.position).filter(String::isNotBlank).joinToString(" · "))
                        }
                        HorizontalDivider()
                        OutlinedTextField(nickname, { nickname = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("昵称（选填）") }, placeholder = { Text("留空使用默认昵称") }, singleLine = true, enabled = !busy && !verifying && state != null)
                        OutlinedTextField(signature, { signature = it.take(120) }, Modifier.fillMaxWidth(), label = { Text("个人签名") }, placeholder = { Text("在成员名册和个人名片上介绍自己（选填）") }, singleLine = true, enabled = !busy && !verifying && state != null)
                        Text("成员可看到你的头像、昵称和签名。身份与联系方式仅本人和授权管理员可见。", style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { run {
                            client.request("/auth/profile", buildJsonObject { put("revision", me.revision); put("studentId", student); put("realName", realName); put("nickname", nickname); put("signature", signature) }, authenticated = true)
                            reload(); notice = "资料已保存。"
                        } }, modifier = Modifier.align(Alignment.End), enabled = !busy && !blocked) { Text(if (incomplete) "确认并绑定身份" else "保存个人资料") }
                    }
                    "devices" -> {
                        Text("查看已登录的浏览器和应用，退出后需要重新登录。", style = MaterialTheme.typography.bodySmall)
                        TextAction(if (devicesLoading) "正在读取设备…" else "刷新", { scope.launch { loadDevices() } }, enabled = !devicesLoading, refresh = !devicesLoading)
                        devicesError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        if (!devicesLoading && devicesError == null && devicesFor != null && devices.isEmpty()) Text("没有其他登录设备。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        for (device in devices) {
                            val created = runCatching { java.time.Instant.parse(device.createdAt).atZone(CampusDay.zone).format(java.time.format.DateTimeFormatter.ofPattern("yyyy年M月d日 HH:mm")) }.getOrDefault(device.createdAt)
                            KeyRow(null, device.deviceName + if (device.current) " · 当前设备" else "", "${if (device.kind == "cookie") "浏览器" else "应用"} · 登录于 $created", trailing = {
                                TextAction("退出", { revoke = device }, enabled = !busy, muted = true)
                            })
                        }
                        if (user!!.totpEnabled) {
                            HorizontalDivider()
                            Text("受信任的设备", style = MaterialTheme.typography.titleSmall)
                            Text("这些设备再次登录时可以少输一次验证码。", style = MaterialTheme.typography.bodySmall)
                            if (!devicesLoading && devicesError == null && devicesFor != null && trustedDevices.isEmpty()) Text("暂无受信任的设备。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            for (device in trustedDevices) {
                                val expires = java.time.Instant.ofEpochMilli(device.expiresAt).atZone(CampusDay.zone).format(java.time.format.DateTimeFormatter.ofPattern("yyyy年M月d日 HH:mm"))
                                KeyRow(null, device.deviceName + if (device.current) " · 当前设备" else "", "${if (device.kind == "cookie") "浏览器" else "应用"} · $expires 到期", trailing = {
                                    TextAction("取消信任", { revokeTrust = device }, enabled = !busy, muted = true)
                                })
                            }
                        }
                    }
                    else -> {
                        Text("修改密码", style = MaterialTheme.typography.titleLarge)
                        SecretField("当前密码", password, !busy) { password = it }
                        SecretField("新密码", newPassword, !busy) { newPassword = it }
                        SecretField("确认新密码", confirm, !busy) { confirm = it }
                        if (user!!.totpEnabled) OutlinedTextField(totp, { totp = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("动态验证码或恢复码") }, singleLine = true, enabled = !busy)
                        Button(onClick = { run {
                            if (newPassword != confirm) { error = "两次输入的新密码不一致。"; return@run }
                            client.request("/auth/password", buildJsonObject { put("currentPassword", password); put("newPassword", newPassword); put("totp", totp) }, authenticated = true)
                            client.forget(); user = null; state = null; password = ""; newPassword = ""; confirm = ""; totp = ""; notice = "密码已修改，请重新登录。"
                        } }, enabled = !busy && password.isNotBlank() && newPassword.length >= 12 && confirm.isNotBlank() && (!user!!.totpEnabled || totp.isNotBlank())) { Text("修改密码并重新登录") }
                        HorizontalDivider()
                        Text("认证器验证", style = MaterialTheme.typography.titleLarge)
                        Text(if (user!!.totpEnabled) "已开启。新设备登录时，请输入动态验证码或恢复码。" else "可使用任意支持 TOTP 的认证器，无需 Google 服务。", style = MaterialTheme.typography.bodyMedium)
                        if (recovery.isNotEmpty()) {
                            Text("恢复码只显示这一次，请抄下来或存到安全的地方。每个恢复码只能用一次。", color = MaterialTheme.colorScheme.primary)
                            SelectionContainer { Text(recovery.joinToString("\n")) }
                            TextButton(onClick = { recovery = emptyList() }) { Text("我已保存恢复码") }
                        }
                        if (!user!!.totpEnabled) {
                            if (secret.isEmpty()) OutlinedButton(onClick = { run {
                                val reply = client.request("/auth/totp/setup", buildJsonObject { put("password", password) }, authenticated = true)
                                secret = reply.getValue("secret").jsonPrimitive.content; totp = ""
                            } }, enabled = !busy && password.isNotBlank() && state?.passwordChangeRequired != true) { Text("绑定认证器") }
                            else {
                                Text("在认证器中手动添加：名称 studev，类型基于时间，SHA1，6 位，每 30 秒更新。")
                                SelectionContainer { Text(secret, style = MaterialTheme.typography.bodyLarge) }
                                OutlinedTextField(totp, { totp = it.take(6) }, Modifier.fillMaxWidth(), label = { Text("认证器的 6 位动态码") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, enabled = !busy)
                                Button(onClick = { run {
                                    val reply = client.request("/auth/totp/confirm", buildJsonObject { put("code", totp) }, authenticated = true)
                                    recovery = reply.getValue("recoveryCodes").jsonArray.map { it.jsonPrimitive.content }; secret = ""; totp = ""; password = ""; reload()
                                } }, enabled = !busy && totp.length == 6) { Text("确认绑定") }
                            }
                        } else if (user!!.role != "owner") OutlinedButton(onClick = { run {
                            client.request("/auth/totp/disable", buildJsonObject { put("password", password); put("code", totp) }, authenticated = true)
                            client.forget(); user = null; state = null; password = ""; totp = ""; notice = "认证器已解绑，请重新登录。"
                        } }, enabled = !busy && password.isNotBlank() && totp.isNotBlank()) { Text("解绑认证器并重新登录") }
                        if (user!!.role != "owner") {
                            HorizontalDivider()
                            Text("注销账号", style = MaterialTheme.typography.titleLarge)
                            Text("输入当前密码后，确认邮件会发到 ${user!!.email}。点邮件里的链接才会注销。注销后，账号和学号绑定都会删除，所有设备也会退出。此操作无法撤销。", style = MaterialTheme.typography.bodyMedium)
                            OutlinedButton(onClick = { run {
                                client.request("/auth/account/delete", buildJsonObject { put("password", password) }, authenticated = true)
                                password = ""; notice = "注销确认信已发到 ${user!!.email}，30 分钟内点信里的按钮完成注销。"
                            } }, enabled = !busy && password.isNotBlank()) { Text("发送注销确认信", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
                OutlinedButton(onClick = { confirmOut = true }, enabled = !busy) { Text("退出登录") }
            }
        }
    }
    if (confirmOut || revoke != null) AlertDialog(onDismissRequest = { if (!busy) { confirmOut = false; revoke = null } }, title = { Text("退出${revoke?.deviceName ?: "此账号"}？") }, text = { Text("这台设备退出后，需要重新登录。") },
        confirmButton = { TextButton(enabled = !busy, onClick = { run {
            val target = revoke
            if (target == null) client.signOut() else client.revokeDevice(target.id)
            if (target == null || target.current) { client.forget(); user = null; state = null; devices = emptyList(); trustedDevices = emptyList(); devicesFor = null } else devices = devices.filter { it.id != target.id }
            confirmOut = false; revoke = null
        } }) { Text(if (busy) "正在退出…" else "确认退出") } }, dismissButton = { TextButton(enabled = !busy, onClick = { confirmOut = false; revoke = null }) { Text("取消") } })
    revokeTrust?.let { device -> AlertDialog(onDismissRequest = { if (!busy) revokeTrust = null }, title = { Text("取消信任此设备？") },
        text = { Text("${device.deviceName} 下次登录时需要输入动态验证码或恢复码。") },
        confirmButton = { TextButton(enabled = !busy, onClick = { run {
            client.revokeTrustedDevice(device)
            trustedDevices = trustedDevices.filter { it.id != device.id }
            revokeTrust = null; notice = "已取消信任。"
        } }) { Text(if (busy) "正在取消…" else "确认取消信任") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { revokeTrust = null }) { Text("返回") } }) }
}
