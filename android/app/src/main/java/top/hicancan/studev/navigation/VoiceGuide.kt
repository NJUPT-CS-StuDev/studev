package top.hicancan.studev.navigation

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import kotlinx.coroutines.*

/** Speaks only kernel prompts. Logs onStart/onDone prove playback, rather than just enqueueing. */
@android.annotation.SuppressLint("LogNotTimber") // Platform logcat callbacks are verification evidence.
class VoiceGuide(context: Context, private val unavailable: () -> Unit) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private var closed = false
    private var warned = false
    private var pending: String? = null
    private var sequence = 0
    private var currentId: String? = null
    var muted = false
        set(value) { field = value; if (value) { pending = null; tts?.stop() } }
    var speaking = false
        private set
    init {
        tts = TextToSpeech(context) { status -> main.post { scope.launch {
            if (closed) return@launch
            val engine = tts
            ready = status == TextToSpeech.SUCCESS && engine != null &&
                withContext(Dispatchers.IO) { engine.setLanguage(Locale.SIMPLIFIED_CHINESE) >= TextToSpeech.LANG_AVAILABLE }
            if (closed) return@launch
            if (!ready) warn() else {
                engine?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) { Log.i("StudevTTS", "onStart $id"); main.post { if (id == currentId) speaking = true } }
                    override fun onDone(id: String?) { Log.i("StudevTTS", "onDone $id"); main.post { if (id == currentId) speaking = false } }
                    override fun onStop(id: String?, interrupted: Boolean) { main.post { if (id == currentId) speaking = false } }
                    @Deprecated("Platform callback") override fun onError(id: String?) { main.post { speaking = false; warn() } }
                    override fun onError(id: String?, errorCode: Int) { Log.w("StudevTTS", "onError $errorCode"); main.post { speaking = false; warn() } }
                })
                pending?.let { pending = null; speak(it) }
            }
        } } }
    }
    private fun warn() { if (!warned) { warned = true; unavailable() } }
    fun speak(text: String) {
        if (closed || muted) return
        if (!ready) { if (!warned) pending = text; return }
        val id = "guidance-${++sequence}"
        currentId = id
        Log.i("StudevTTS", "request $id $text")
        speaking = true
        if (tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) { speaking = false; warn() }
    }
    override fun close() { closed = true; scope.cancel(); pending = null; tts?.stop(); tts?.shutdown(); tts = null }
}
