package top.hicancan.studev.app

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.account.AccountUser
import top.hicancan.studev.account.Accounts

/** Loads a public QQ avatar image cleanly when given a valid QQ number. */
@Composable fun QqAvatarImage(qq: String, modifier: Modifier = Modifier, fallback: @Composable () -> Unit = {}) {
    val face by produceState<ImageBitmap?>(null, qq) {
        value = if (!Regex("[1-9]\\d{4,11}").matches(qq)) null else withContext(Dispatchers.IO) {
            runCatching { java.net.URL("https://q1.qlogo.cn/g?b=qq&nk=$qq&s=100").openStream().use { BitmapFactory.decodeStream(it) }?.asImageBitmap() }.getOrNull()
        }
    }
    Box(modifier.clip(CircleShape), contentAlignment = Alignment.Center) {
        if (face != null) Image(face!!, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else fallback()
    }
}

/** Who is signed in, at a glance: their QQ face, the first letter of their name, or the outline of nobody. */
@Composable fun MeAvatar() {
    val context = LocalContext.current
    val accounts = Accounts.get(context)
    val user by accounts.user.collectAsStateWithLifecycle()
    LaunchedEffect(accounts) { accounts.current() }
    val qq = user?.qq.orEmpty()
    val ink = Ink.muted
    Row(Modifier.padding(start = 3.dp, end = 9.dp), verticalAlignment = Alignment.CenterVertically) {
    QqAvatarImage(qq, Modifier.size((Tokens.Size.search - 8).dp)) {
        val shown = user
        when {
            shown != null -> Plain(shown.nickname.take(1).ifEmpty { "我" }, 12.5.sp, ink, FontWeight.SemiBold)
            else -> Canvas(Modifier.size(18.dp)) {
                val unit = size.width / 24
                val line = Stroke(1.8f * unit, cap = StrokeCap.Round)
                drawCircle(ink, 3.6f * unit, Offset(12 * unit, 8.5f * unit), style = line)
                drawPath(Path().apply { moveTo(5 * unit, 20 * unit); quadraticTo(6.5f * unit, 14.2f * unit, 12 * unit, 14.2f * unit); quadraticTo(17.5f * unit, 14.2f * unit, 19 * unit, 20 * unit) }, ink, style = line)
            }
        }
    }
    Plain(user?.nickname ?: "未登录", 12.sp, ink, modifier = Modifier.padding(start = 4.dp).widthIn(max = 48.dp), maxLines = 1)
    }
}
