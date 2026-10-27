package com.voiceagent.core

/**
 * Canonical button descriptions ("Like", "Send"...) -> labels apps actually use, in several locales.
 * The executor tries each label until one matches a node on screen.
 */
object Synonyms {
    private val table: Map<String, List<String>> = mapOf(
        "like" to listOf("Like", "Liked", "لايك", "اعجاب", "إعجاب", "أعجبني", "Me gusta", "J'aime"),
        "comment" to listOf("Comment", "تعليق", "اكتب تعليق", "Write a comment", "أضف تعليقًا", "Add a comment"),
        "send" to listOf("Send", "Post", "Reply", "إرسال", "ارسال", "نشر", "Publish"),
        "share" to listOf("Share", "مشاركة", "شارك", "شير"),
        "follow" to listOf("Follow", "متابعة", "تابع", "Subscribe", "اشتراك"),
        "search" to listOf("Search", "بحث", "ابحث"),
        "save" to listOf("Save", "حفظ"),
        "ok" to listOf("OK", "موافق", "حسنا", "Done", "تم", "Allow", "سماح"),
        "cancel" to listOf("Cancel", "إلغاء", "الغاء"),
    )

    /** Canonical key ("like", "send"...) for any known label in any locale, or null. */
    fun canonical(word: String): String? {
        val k = ArabicText.key(word)
        return table.entries.firstOrNull { (name, labels) ->
            name == k || labels.any { ArabicText.key(it) == k }
        }?.key
    }

    /** Canonical English label ("Like", "Send"...) for a spoken/localised one, or null if unknown. */
    fun canonicalLabel(word: String): String? = canonical(word)?.let { table[it]?.first() }

    /** All labels to try for a described target; the description itself always comes first. */
    fun labelsFor(description: String): List<String> =
        (listOf(description) + (canonical(description)?.let { table[it] } ?: emptyList())).distinct()
}
