package com.voiceagent.app

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.voiceagent.core.UiNode

/** Adapts [AccessibilityNodeInfo] to the platform-independent [UiNode] used by the matcher. */
class AccessibilityUiNode(val info: AccessibilityNodeInfo) : UiNode {
    override val text: String? get() = info.text?.toString()
    override val contentDescription: String? get() = info.contentDescription?.toString()
    override val viewId: String? get() = info.viewIdResourceName
    override val className: String? get() = info.className?.toString()
    override val isClickable: Boolean get() = info.isClickable
    override val isEditable: Boolean get() = info.isEditable
    override val isScrollable: Boolean get() = info.isScrollable
    val isPassword: Boolean get() = info.isPassword

    override val children: List<UiNode>
        get() = (0 until info.childCount).mapNotNull { i -> info.getChild(i)?.let(::AccessibilityUiNode) }

    override val parent: UiNode? get() = info.parent?.let(::AccessibilityUiNode)

    fun bounds(): Rect = Rect().also(info::getBoundsInScreen)
}
