package top.hicancan.studev.ai

import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RuntimeTest {
    private val root = generateSequence(File(checkNotNull(System.getProperty("user.dir"))).canonicalFile) { it.parentFile }.first { File(it, "src/campus/world/assistant.json").isFile }
    private fun assistant() = Assistant.of(Json.parseToJsonElement(File(root, "src/campus/world/assistant.json").readText()).jsonObject, Json.parseToJsonElement(File(root, "src/campus/world/tools.json").readText()).jsonArray)
    private val situation = Situation(null, null, "仙林", null, null, null)

    @Test fun onlyAnExplicitRuntimeCanUseLoopbackHttp() {
        for (base in listOf("http://127.0.0.1:9316/v1", "http://localhost:9316/v1")) {
            assertNotNull(Models.addressError(base)); assertNull(Models.addressError(base, true))
        }
        for (base in listOf("http://localhost.example.com/v1", "http://192.168.1.4/v1", "http://user@localhost/v1", "http://127.0.0.1/v1?key=value", "file:///tmp/model")) assertNotNull(Models.addressError(base, true))
        assertNull(Models.addressError("https://model.example.com/v1", true))
        assertFalse(Models.STARTING.runtime)
    }

    @Test fun providerErrorsInAnSseBodyDoNotDisappear() {
        val completion = assistant().Completion()
        val error = runCatching { completion.take("data: {\"error\":{\"message\":\"请先打开模型网页\",\"code\":\"provider_not_ready\"}}") }.exceptionOrNull()
        assertEquals("请先打开模型网页", error?.message)
    }

    @Test fun runtimeSourceErrorsUseTheSharedProductCopy() {
        val error = runCatching { assistant().Completion(true).take("data: {\"error\":{\"message\":\"The remote model is unavailable\",\"code\":\"provider_unavailable\"}}") }.exceptionOrNull()
        assertEquals("模型网站暂时不可用，请稍后再试。", error?.message)
        assertEquals("provider text", assistant().runtimeError("unknown-provider-error", "provider text"))
    }

    @Test fun runtimeRequestOmitsUnsupportedSamplingControls() {
        val client = assistant()
        val ordinary = client.request("model", emptyList(), situation)
        assertTrue(ordinary.containsKey("max_tokens")); assertTrue(ordinary.containsKey("temperature"))
        val runtime = client.request("deepseek-web", emptyList(), situation, runtime = true, conversationId = "owned-chat")
        assertFalse(runtime.containsKey("max_tokens")); assertFalse(runtime.containsKey("temperature"))
        assertEquals(ordinary["tools"], runtime["tools"])
        assertEquals("owned-chat", runtime.getValue("conversation_id").jsonPrimitive.content)
        assertFalse(ordinary.containsKey("conversation_id"))
        assertFalse(runtime.containsKey("retry"))
        assertEquals(JsonPrimitive(true), client.request("deepseek-web", emptyList(), situation, runtime = true, conversationId = "owned-chat", retry = true)["retry"])
    }

    @Test fun forksKeepTheirConversationWhenToolsContinueOrAnOlderBranchIsSelected() {
        fun message(role: String) = buildJsonObject { put("role", role); put("content", role) }
        val main = ChatThread().append("", "question", message("user")).append("question", "original", message("assistant")).append("original", "follow-up", message("user")).append("follow-up", "continued", message("assistant"))
        val branched = main.append("question", "fork", message("assistant")).append("fork", "tool", message("tool")).append("tool", "fork-answer", message("assistant")).append("fork-answer", "new-question", message("user"))
        val saved = SavedChat("chat", "", 0, branched, listOf("fork"), listOf("web-a", "web-b"))
        for (at in listOf("fork", "tool", "fork-answer", "new-question")) assertEquals("fork", saved.conversationId(at))
        assertEquals("chat", saved.conversationId("continued"))
        assertEquals("chat", SavedChat.of(saved.toJson()).conversationId("continued"))
        assertEquals("fork", SavedChat.of(saved.toJson()).conversationId("new-question"))
        assertEquals(listOf("web-a", "web-b"), SavedChat.of(saved.toJson()).runtimeModels)
        val partial = main.append("continued", "next-question", message("user")).append("next-question", "partial", message("assistant"))
        assertEquals("chat", saved.copy(thread = partial).conversationId("partial"))
    }

    @Test fun cancelDisconnectsAnActualSilentHttpStream() = runBlocking {
        val listening = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val peer = AtomicReference<Socket>()
        val ready = CountDownLatch(1)
        val released = CountDownLatch(1)
        val server = thread(isDaemon = true) {
            runCatching {
                listening.accept().use { socket ->
                    peer.set(socket)
                    val input = socket.getInputStream(); val headers = ByteArrayOutputStream()
                    while (!headers.toString(Charsets.US_ASCII).endsWith("\r\n\r\n")) headers.write(input.read().also { check(it >= 0) })
                    val length = Regex("(?im)^Content-Length: (\\d+)").find(headers.toString(Charsets.US_ASCII))!!.groupValues[1].toInt()
                    val request = Json.parseToJsonElement(input.readNBytes(length).toString(Charsets.UTF_8)).jsonObject
                    check(!request.containsKey("max_tokens") && !request.containsKey("temperature"))
                    socket.getOutputStream().apply { write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n: ready\n\n".toByteArray()); flush() }
                    ready.countDown()
                    if (input.read() == -1) released.countDown()
                }
            }
        }
        val job = launch(Dispatchers.Default) { assistant().askOwn(Own("http://127.0.0.1:${listening.localPort}/v1", "deepseek-web", "test-model-key", true), emptyList(), situation, false, conversationId = "owned-cancel-test") {} }
        try {
            assertTrue("the real request reached its streaming response", ready.await(3, TimeUnit.SECONDS))
            withTimeout(2_000) { job.cancelAndJoin() }
            assertTrue("cancellation closes the TCP peer", released.await(1, TimeUnit.SECONDS))
        } finally {
            peer.get()?.close(); listening.close(); job.cancel(); server.join(1_000)
        }
    }
}
