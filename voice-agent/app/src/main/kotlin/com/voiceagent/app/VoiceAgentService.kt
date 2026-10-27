package com.voiceagent.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The hands of the agent. Holds no logic of its own beyond primitives (tap, swipe, global actions);
 * what to do is decided by [ActionExecutor].
 */
class VoiceAgentService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    fun root(): AccessibilityUiNode? = rootInActiveWindow?.let(::AccessibilityUiNode)
    fun currentPackage(): String? = rootInActiveWindow?.packageName?.toString()

    suspend fun tap(x: Float, y: Float): Boolean =
        dispatch(Path().apply { moveTo(x, y) }, durationMs = 60)

    suspend fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long = 350): Boolean =
        dispatch(Path().apply { moveTo(x1, y1); lineTo(x2, y2) }, durationMs)

    fun back() = performGlobalAction(GLOBAL_ACTION_BACK)
    fun home() = performGlobalAction(GLOBAL_ACTION_HOME)

    private suspend fun dispatch(path: Path, durationMs: Long): Boolean =
        suspendCancellableCoroutine { cont ->
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
                .build()
            val accepted = dispatchGesture(
                gesture,
                object : GestureResultCallback() {
                    override fun onCompleted(g: GestureDescription?) { if (cont.isActive) cont.resume(true) }
                    override fun onCancelled(g: GestureDescription?) { if (cont.isActive) cont.resume(false) }
                },
                null,
            )
            if (!accepted && cont.isActive) cont.resume(false)
        }

    companion object {
        @Volatile var instance: VoiceAgentService? = null
            private set
    }
}
