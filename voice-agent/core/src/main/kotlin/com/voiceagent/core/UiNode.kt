package com.voiceagent.core

/** Minimal view of an accessibility node so matching logic is testable without Android. */
interface UiNode {
    val text: String?
    val contentDescription: String?
    val viewId: String?
    val className: String?
    val isClickable: Boolean
    val isEditable: Boolean
    val isScrollable: Boolean
    val children: List<UiNode>
    val parent: UiNode?
}

object NodeMatcher {
    fun flatten(root: UiNode): Sequence<UiNode> = sequence {
        yield(root)
        for (c in root.children) yieldAll(flatten(c))
    }

    private fun labels(n: UiNode) = listOfNotNull(n.text, n.contentDescription).map(ArabicText::key).filter { it.isNotEmpty() }

    /** 3 = exact label, 2 = label starts with / is word-contained in query, 1 = substring, 0 = no match. */
    fun score(n: UiNode, query: String): Int {
        val q = ArabicText.key(query)
        if (q.isEmpty()) return 0
        return labels(n).maxOfOrNull { l ->
            when {
                l == q -> 3
                l.startsWith("$q ") || l.endsWith(" $q") || l.contains(" $q ") -> 2
                l.contains(q) -> 1
                else -> 0
            }
        } ?: 0
    }

    /** Best match for [query]; ties prefer clickable nodes, then the shorter (more specific) label. */
    fun find(root: UiNode, query: String, requireClickable: Boolean = false): UiNode? =
        flatten(root)
            .filter { !requireClickable || it.isClickable || clickableAncestor(it) != null }
            .map { it to score(it, query) }
            .filter { it.second > 0 }
            .sortedWith(
                compareByDescending<Pair<UiNode, Int>> { it.second }
                    .thenByDescending { it.first.isClickable }
                    .thenBy { (it.first.text ?: it.first.contentDescription).orEmpty().length },
            )
            .firstOrNull()?.first

    /** Tries each synonym in order; first label with any match wins. */
    fun findAny(root: UiNode, labels: List<String>, requireClickable: Boolean = false): UiNode? =
        labels.firstNotNullOfOrNull { find(root, it, requireClickable) }

    fun clickableAncestor(n: UiNode): UiNode? {
        var cur: UiNode? = n
        var depth = 0
        while (cur != null && depth < 8) {
            if (cur.isClickable) return cur
            cur = cur.parent; depth++
        }
        return null
    }

    fun findEditable(root: UiNode, hint: String? = null): UiNode? {
        val editables = flatten(root).filter { it.isEditable || it.className?.endsWith("EditText") == true }.toList()
        if (hint == null) return editables.firstOrNull()
        return editables.firstOrNull { score(it, hint) > 0 } ?: editables.firstOrNull()
    }

    fun findScrollable(root: UiNode): UiNode? = flatten(root).firstOrNull { it.isScrollable }
}
