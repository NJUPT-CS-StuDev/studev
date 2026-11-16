package top.hicancan.studev.world

import android.content.ContextWrapper
import android.content.res.AssetManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import top.hicancan.studev.MainActivity
import top.hicancan.studev.app.StuDevTheme
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.data.DataRelease
import top.hicancan.studev.knowledge.KnowledgeIndex
import kotlin.math.abs

class DocAnchorTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun releasedDocumentKeepsItsAnchorUntilTheReaderInteracts() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val target = instrumentation.targetContext
        val release = Json.decodeFromString<DataRelease>(assets.open("data/release.json").bufferedReader().use { it.readText() })
        // Read the released fixture through the repository's normal bundled-asset path and device cache.
        val source = object : ContextWrapper(target) { override fun getAssets(): AssetManager = assets }
        val repository = AcademicRepository(source, release)
        val text = runBlocking { repository.bytes("knowledge/materials/batch-2/B0300053S/数据结构第5章-树课件.md").decodeToString() }
        val hosts = runBlocking { AcademicRepository.bundled(target).read<KnowledgeIndex>("knowledge/knowledge.json").media }
        val sources = Regex("!\\[[^\\]]*\\]\\(([^)]+)\\)").findAll(text).map { it.groupValues[1] }.distinct().toList()
        assertTrue("the released lecture exercises a long document", sources.size >= 100)
        val pictures = runBlocking { sources.take(4).map { checkNotNull(repository.media(it, hosts)) { "Released picture unavailable: $it" } } }
        val blocks = Docs.read(text)
        var document by mutableIntStateOf(0)
        var pending = mutableMapOf<String, CompletableDeferred<ByteArray?>>()
        lateinit var scroll: ScrollState
        compose.runOnUiThread { compose.activity.setContent {
            StuDevTheme {
                scroll = rememberScrollState()
                key(document) {
                    DocAnchors("图525-核等价关系分组", scroll) { anchors ->
                        Column(Modifier.fillMaxSize().then(anchors).testTag("document").verticalScroll(scroll)) {
                            Doc(blocks, imageBytes = { src -> pending.getOrPut(src) { CompletableDeferred() }.await() })
                        }
                    }
                }
            }
        } }
        val heading = compose.onAllNodesWithText("图5.25 核等价关系分组", substring = true, useUnmergedTree = true).onFirst()
        val viewport = compose.onNodeWithTag("document")
        fun top() = heading.fetchSemanticsNode().positionInRoot.y - viewport.fetchSemanticsNode().positionInRoot.y
        compose.waitUntil(15_000) { pending.size == sources.size && scroll.value > 100 }
        val pinnedTop = top()
        assertTrue("the addressed heading is visible even when the document end clamps scrolling", pinnedTop >= 0 && pinnedTop < viewport.fetchSemanticsNode().size.height)
        fun assertPinned() { compose.waitUntil(15_000) { abs(top() - pinnedTop) < 2 } }
        for (at in 0..1) {
            val before = scroll.value
            compose.runOnIdle { pending.getValue(sources[at]).complete(pictures[at]) }
            compose.waitUntil(15_000) { scroll.value > before + 20 }
            assertPinned()
        }
        viewport.performTouchInput { swipeDown() }
        compose.waitForIdle()
        val manualOffset = scroll.value
        val manualTop = top()
        compose.runOnIdle { pending.getValue(sources[2]).complete(pictures[2]) }
        compose.waitUntil(15_000) { abs(top() - manualTop) > 20 }
        compose.waitForIdle()
        assertEquals("later image layout preserves the reader's manual scroll", manualOffset, scroll.value)

        compose.runOnIdle { pending = mutableMapOf(); document++ }
        compose.waitUntil(15_000) { pending.size == sources.size }
        assertPinned()
        val before = scroll.value
        compose.runOnIdle { pending.getValue(sources[3]).complete(pictures[3]) }
        compose.waitUntil(15_000) { scroll.value > before + 20 }
        assertPinned()
    }
}
