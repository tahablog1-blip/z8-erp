package com.voiceagent.core

/**
 * Text normalisation for matching spoken Arabic (incl. Egyptian) against UI labels.
 *
 * [normalize] is strictly character-for-character after diacritics are removed, so indexes found in
 * the normalised string can be used to slice the original string (this keeps typed payloads intact).
 */
object ArabicText {
    private val diacritics = Regex("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u0640]")

    fun stripDiacritics(s: String): String = diacritics.replace(s, "")

    fun normalize(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            sb.append(
                when (c) {
                    'أ', 'إ', 'آ', 'ٱ' -> 'ا'
                    'ى' -> 'ي'
                    'ة' -> 'ه'
                    'ڤ' -> 'ف'
                    'گ' -> 'ك'
                    '،', '؛' -> ','
                    '؟' -> '?'
                    in '٠'..'٩' -> '0' + (c - '٠')
                    else -> c.lowercaseChar()
                },
            )
        }
        return sb.toString()
    }

    /** Normalised form for comparing two arbitrary strings (collapses whitespace too). */
    fun key(s: String): String =
        normalize(stripDiacritics(s)).trim().replace(Regex("\\s+"), " ")
}
