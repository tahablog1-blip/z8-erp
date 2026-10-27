package com.voiceagent.core

/**
 * STT hook. The Android app ships [SpeechRecognizer]-based and (optionally) cloud/Whisper-based
 * implementations; anything that can produce transcripts can plug in here.
 */
interface SpeechEngine {
    /** BCP-47 tag, e.g. "ar-EG" or "en-US". */
    var languageTag: String

    fun start(listener: Listener)
    fun stop()
    fun release()

    interface Listener {
        fun onListening() {}
        fun onPartial(text: String) {}
        fun onFinal(text: String)
        fun onError(message: String)
    }
}
