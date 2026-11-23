package top.hicancan.studev.app

import androidx.core.net.toUri
import top.hicancan.studev.account.PLATFORM_ORIGIN

internal fun collectionLink(id: String, answers: List<Pair<String, String>> = emptyList()): String {
    val link = "$PLATFORM_ORIGIN/forms/".toUri().buildUpon().appendQueryParameter("id", id)
    answers.forEach { (field, value) -> link.appendQueryParameter("a.$field", value) }
    return link.build().toString()
}
