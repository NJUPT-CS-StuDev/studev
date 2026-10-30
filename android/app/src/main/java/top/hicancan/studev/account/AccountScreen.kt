package top.hicancan.studev.account

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import top.hicancan.studev.ui.theme.Tokens

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AccountScreen(client: AccountClient, onBack: () -> Unit, onSignedIn: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AccountUser?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var student by rememberSaveable { mutableStateOf("") }
    // Passwords and factors deliberately never enter saved instance state.
    var password by remember { mutableStateOf("") }
    var totp by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOut by remember { mutableStateOf(false) }
    LaunchedEffect(client) { try { user = client.current() } catch (_: Exception) { error = "账号信息暂时无法读取，请重试。" }; loaded = true }
    Scaffold(topBar = { TopAppBar(title = { Text("账号") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(Tokens.Space.xl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
            if (!loaded) { CircularProgressIndicator(); return@Column }
            Icon(Icons.Outlined.Lock, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
            Text(if (user == null) "登录 studev" else user!!.nickname, style = MaterialTheme.typography.headlineMedium)
            Text(if (user == null) "使用与网页相同的学号、密码和动态验证码。" else "学号 ${user!!.studentId}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (user == null) {
                OutlinedTextField(student, { student = it.take(20) }, Modifier.fillMaxWidth(), label = { Text("学号") }, singleLine = true, enabled = !busy)
                OutlinedTextField(password, { password = it.take(256) }, Modifier.fillMaxWidth(), label = { Text("密码") }, singleLine = true, enabled = !busy,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = { IconButton(onClick = { showPassword = !showPassword }) { Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (showPassword) "隐藏密码" else "显示密码") } })
                OutlinedTextField(totp, { totp = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("动态验证码或恢复码") }, supportingText = { Text("已绑定认证器的账号需要填写。") }, singleLine = true, enabled = !busy)
                Button(onClick = { scope.launch {
                    busy = true; error = null
                    try { user = client.signIn(student, password, totp, "${Build.MANUFACTURER} ${Build.MODEL}"); password = ""; totp = ""; onSignedIn() }
                    catch (e: Exception) { error = if (e is PlatformFailure) e.message else "连接未完成，请检查网络后重试。"; totp = "" }
                    finally { busy = false }
                } }, Modifier.fillMaxWidth(), enabled = !busy && student.isNotBlank() && password.isNotBlank()) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("登录") }
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/account/"))) }) { Text("注册账号或完成网页安全设置") }
            } else {
                Text("密码与动态验证码不会保存在设备上。你可以在网页账号中心的「已登录的设备」中退出此设备。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedButton(onClick = { confirmOut = true }, enabled = !busy) { Text("退出登录") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
    if (confirmOut) AlertDialog(onDismissRequest = { if (!busy) confirmOut = false }, title = { Text("退出此账号？") }, text = { Text("此设备的登录凭据将被撤销，已分享的活动仍可查看。") },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { client.signOut(); user = null; confirmOut = false; error = null } catch(e: Exception) { confirmOut = false; user = client.current(); error = if (user == null) "登录已失效，请重新登录。" else "退出未完成，请联网后重试。" } finally { busy = false } } }) { Text(if (busy) "正在退出…" else "退出登录") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { confirmOut = false }) { Text("取消") } })
}
