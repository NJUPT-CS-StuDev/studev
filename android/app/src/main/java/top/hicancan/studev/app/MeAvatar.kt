package top.hicancan.studev.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.account.AccountPresence
import top.hicancan.studev.account.Accounts
import top.hicancan.studev.account.AvatarCache
import top.hicancan.studev.account.avatarLetter
import top.hicancan.studev.account.qqNumber

/** Load the local image first, then refresh an absent or stale public QQ avatar in the background. */
@Composable fun QqAvatarImage(qq: String, modifier: Modifier = Modifier, description: String? = null, fallback: @Composable () -> Unit = {}) {
    val context = LocalContext.current.applicationContext
    val picture by key(qq) { produceState(AvatarCache.memory(qq), qq) {
        if (!qqNumber.matches(qq) || value?.isFresh() == true) return@produceState
        val saved = value ?: withContext(Dispatchers.IO) { AvatarCache.disk(context, qq) }
        if (saved != null) value = saved
        if (saved?.isFresh() != true) {
            val fresh = withContext(Dispatchers.IO) { AvatarCache.fetch(context, qq) }
            if (fresh != null) value = fresh
        }
    } }
    Box(modifier.clip(CircleShape), contentAlignment = Alignment.Center) {
        val face = picture?.image
        if (face != null) Image(face, description, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else fallback()
    }
}

/** Who is signed in, at a glance. Local storage restores the name independently of image loading. */
@Composable fun MeAvatar(labelWidth: Dp? = Tokens.Size.accountNameMax.dp) {
    val presence by Accounts.get(LocalContext.current).presence.collectAsStateWithLifecycle()
    val user = presence.user
    val label = when (presence) {
        AccountPresence.Loading -> "正在读取账号…"
        AccountPresence.Unavailable -> "账号暂不可用"
        AccountPresence.SignedOut -> "未登录"
        is AccountPresence.SignedIn -> user!!.nickname
    }
    val ink = Ink.muted
    Row(
        Modifier.padding(start = 4.dp, end = if (labelWidth == null) 4.dp else 12.dp)
            .semantics { stateDescription = label },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        QqAvatarImage(user?.qq.orEmpty(), Modifier.size((Tokens.Size.search - 8).dp)) {
            when {
                user != null -> Plain(avatarLetter(user.nickname), 12.5.sp, ink, FontWeight.SemiBold)
                presence != AccountPresence.SignedOut -> Box(Modifier.size(18.dp).background(Ink.line, CircleShape))
                else -> Canvas(Modifier.size(18.dp)) {
                    val unit = size.width / 24
                    val line = Stroke(1.8f * unit, cap = StrokeCap.Round)
                    drawCircle(ink, 3.6f * unit, Offset(12 * unit, 8.5f * unit), style = line)
                    drawPath(Path().apply {
                        moveTo(5 * unit, 20 * unit)
                        quadraticTo(6.5f * unit, 14.2f * unit, 12 * unit, 14.2f * unit)
                        quadraticTo(17.5f * unit, 14.2f * unit, 19 * unit, 20 * unit)
                    }, ink, style = line)
                }
            }
        }
        if (labelWidth != null) Plain(label, 12.sp, ink, modifier = Modifier.padding(start = 6.dp).widthIn(max = labelWidth), maxLines = 1)
    }
}
