package com.voiceagent.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.voiceagent.core.SpeechEngine

/** STT via the platform [SpeechRecognizer]. Must be created and used on the main thread. */
class AndroidSpeechEngine(private val context: Context) : SpeechEngine {
    override var languageTag: String = "ar-EG"

    private var recognizer: SpeechRecognizer? = null

    override fun start(listener: SpeechEngine.Listener) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            listener.onError("Speech recognition is not available on this device")
            return
        }
        release()
        val sr = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = listener.onListening()
            override fun onPartialResults(partial: Bundle?) {
                first(partial)?.let(listener::onPartial)
            }
            override fun onResults(results: Bundle?) {
                val text = first(results)
                if (text.isNullOrBlank()) listener.onError("Didn't catch that") else listener.onFinal(text)
            }
            override fun onError(error: Int) = listener.onError(describe(error))
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        sr.startListening(intent)
    }

    override fun stop() {
        recognizer?.stopListening()
    }

    override fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun first(b: Bundle?): String? =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    private fun describe(code: Int) = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch that"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network error"
        SpeechRecognizer.ERROR_AUDIO -> "Audio error"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
        else -> "Speech error ($code)"
    }
}
