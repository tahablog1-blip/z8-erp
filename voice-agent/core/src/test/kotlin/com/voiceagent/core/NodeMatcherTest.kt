package com.voiceagent.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame

class NodeMatcherTest {
    private class N(
        override val text: String? = null,
        override val contentDescription: String? = null,
        override val className: String? = null,
        override val isClickable: Boolean = false,
        override val isEditable: Boolean = false,
        override val isScrollable: Boolean = false,
        kids: List<N> = emptyList(),
    ) : UiNode {
        override val viewId: String? = null
        override var parent: UiNode? = null
        override val children: List<UiNode> = kids
        init { kids.forEach { it.parent = this } }
    }

    @Test
    fun `finds arabic text ignoring hamza variants and prefers exact match`() {
        val exact = N(text = "محمد أحمد")
        val longer = N(text = "محمد احمد شاركك صورة")
        val root = N(kids = listOf(longer, exact))
        assertSame(exact, NodeMatcher.find(root, "محمد احمد"))
    }

    @Test
    fun `synonym labels and clickable ancestor`() {
        val label = N(text = "إعجاب")
        val button = N(isClickable = true, kids = listOf(label))
        val root = N(kids = listOf(button))
        val hit = NodeMatcher.findAny(root, Synonyms.labelsFor("Like"))
        assertSame(label, hit)
        assertSame(button, NodeMatcher.clickableAncestor(hit!!))
    }

    @Test
    fun `editable lookup uses hint then falls back`() {
        val a = N(className = "android.widget.EditText", isEditable = true, contentDescription = "Search")
        val b = N(className = "android.widget.EditText", isEditable = true, text = "Write a comment")
        val root = N(kids = listOf(a, b))
        assertSame(b, NodeMatcher.findEditable(root, "comment"))
        assertSame(a, NodeMatcher.findEditable(root, "zzz"))
        assertNull(NodeMatcher.find(root, "nothing here"))
    }

    @Test
    fun `app registry resolves aliases`() {
        assertEquals("com.facebook.katana", AppRegistry.resolve("الفيس بوك"))
        assertEquals("com.whatsapp", AppRegistry.resolve("WhatsApp"))
    }
}
