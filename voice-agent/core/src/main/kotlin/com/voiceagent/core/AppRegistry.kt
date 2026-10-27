package com.voiceagent.core

/** Spoken app names (Arabic dialects + English) -> Android package names. */
object AppRegistry {
    private val apps: Map<String, List<String>> = mapOf(
        "com.facebook.katana" to listOf("فيسبوك", "فيس بوك", "فيس", "facebook", "fb"),
        "com.whatsapp" to listOf("واتساب", "واتس اب", "واتس", "whatsapp"),
        "com.instagram.android" to listOf("انستجرام", "انستغرام", "انستا", "instagram"),
        "com.google.android.youtube" to listOf("يوتيوب", "youtube"),
        "org.telegram.messenger" to listOf("تيليجرام", "تليجرام", "تلجرام", "telegram"),
        "com.twitter.android" to listOf("تويتر", "اكس", "twitter"),
        "com.zhiliaoapp.musically" to listOf("تيك توك", "تيكتوك", "tiktok"),
        "com.snapchat.android" to listOf("سناب شات", "سنابشات", "سناب", "snapchat"),
        "com.android.chrome" to listOf("كروم", "المتصفح", "chrome", "browser"),
        "com.google.android.gm" to listOf("جيميل", "gmail"),
        "com.google.android.apps.maps" to listOf("الخرائط", "خرائط جوجل", "جوجل مابس", "maps"),
        "com.android.settings" to listOf("الاعدادات", "اعدادات", "settings"),
        "com.android.camera" to listOf("الكاميرا", "كاميرا", "camera"),
        "com.facebook.orca" to listOf("ماسنجر", "messenger"),
    )

    private fun strip(s: String) = ArabicText.key(s).removePrefix("ال")

    private val index: List<Pair<String, String>> = apps.flatMap { (pkg, names) ->
        names.map { strip(it) to pkg }
    }.sortedByDescending { it.first.length } // longest alias wins ("فيس بوك" before "فيس")

    fun resolve(spokenName: String): String? {
        val k = strip(spokenName)
        return index.firstOrNull { it.first == k }?.second
            ?: index.firstOrNull { k.contains(it.first) }?.second
    }
}
