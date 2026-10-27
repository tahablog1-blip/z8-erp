package com.voiceagent.core

/**
 * Offline, deterministic parser for Arabic (MSA + Egyptian) and English commands.
 * Splits the utterance into clauses, then maps each clause to one or more [ActionStep]s.
 *
 * All regexes run on the normalised clause ([ArabicText.normalize], length-preserving); captured
 * ranges are then sliced from the original clause so typed text keeps its spelling.
 */
class RuleBasedParser : PlanParser {

    override suspend fun parse(transcript: String): ExecutionPlan = parseBlocking(transcript)

    fun parseBlocking(transcript: String): ExecutionPlan =
        PlanValidator.sanitize(ExecutionPlan(splitClauses(transcript).flatMap(::parseClause)))

    // ---- clause splitting -------------------------------------------------------------------

    private val verbStarts = listOf(
        "افتح", "شغل", "روح", "اعمل", "حط", "اكتب", "علق", "ابعت", "ارسل", "اضغط", "دوس", "كبس",
        "انزل", "اطلع", "اسكرول", "ارجع", "ابحث", "دور", "شارك", "شير", "تابع", "لايك",
        "open", "launch", "like", "comment", "write", "type", "send", "click", "tap", "scroll",
        "go", "search", "share", "follow",
    ).map(ArabicText::key)

    private val hardSeparator = Regex(
        """(?:[,.;\n]|(?<=^|\s)(?:ثم|بعدين|وبعدين|بعد كده|بعد كدا|then|and then)(?=\s|$))""",
    )
    // "و" (Arabic and) at a word start, glued to the next word ("واكتب") or standalone; or English "and".
    private val softAnd = Regex("""(?<=^|\s)(?:و(?=\S)|و\s+|and\s+)""")

    private fun splitClauses(text: String): List<String> {
        val clean = ArabicText.stripDiacritics(text).trim()
        return cutAt(clean, hardSeparator) { _ -> true }
            .flatMap { piece ->
                cutAt(piece, softAnd) { m ->
                    // only a split if a known verb follows, so "محمد و أحمد" stays one name
                    val rest = ArabicText.normalize(piece).substring(m.range.last + 1).trimStart()
                    verbStarts.any(rest::startsWith)
                }
            }
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    private fun cutAt(s: String, re: Regex, accept: (MatchResult) -> Boolean): List<String> {
        val out = mutableListOf<String>()
        var from = 0
        for (m in re.findAll(ArabicText.normalize(s))) {
            if (!accept(m)) continue
            out.add(s.substring(from, m.range.first))
            from = m.range.last + 1
        }
        out.add(s.substring(from))
        return out
    }

    // ---- clause -> steps --------------------------------------------------------------------

    private val openRe = Regex("""^(?:افتح|فتح|شغل|روح علي|روح الي|روح|اطلع علي|open|launch|start|go to)\s+(.+)$""")
    private val searchRe = Regex("""^(?:ابحث عن|ابحث|دور علي|دور|search for|search)\s+(.+)$""")
    private val likeRe = Regex("""^(?:(?:اعمل|عمل|حط|ضيف|اضغط|دوس)\s+)?(?:لايك|اعجاب|like)(?:\s+(?:علي|ع|for|on|to|ل))?\s*(.*)$""")
    private val shareFollowRe = Regex("""^(?:(?:اعمل|حط)\s+)?(شير|شارك|مشاركه|share|تابع|متابعه|follow)(?:\s+(?:علي|ع|ل))?\s*(.*)$""")
    private val writeRe = Regex("""^(?:اعمل تعليق|حط تعليق|ضيف تعليق|add (?:a )?comment|اكتب|علق|write|type|comment)\s*(.*)$""")
    private val sendRe = Regex("""^(?:ارسل|ابعت|ابعته|ارسلها|ابعتها|send|post|submit)$""")
    private val clickRe = Regex("""^(?:اضغط|دوس|كبس|اختار|click|tap|press|select)(?:\s+(?:علي|ع|on))?\s+(.+)$""")
    private val scrollRe = Regex("""^(?:انزل|نزل|اسكرول|scroll|اطلع)(.*)$""")
    private val backRe = Regex("""^(?:ارجع|رجوع|back|go back)$""")
    private val homeRe = Regex("""^(?:الرئيسيه|الشاشه الرئيسيه|روح للرئيسيه|home|go home)$""")

    private val postWord = Regex("""^(?:ل|ال)?(?:بوست|منشور|post)\s*(?:بتاع|بتاعه|بتاعت|of|by)?\s*""")
    private val toWhom = Regex("""^(?:له|ليه|لها|ليها)\s+""")
    private val commentLabel = Regex("""^(?:تعليق|التعليق|comment)\s*(?:ب|هو|:)?\s*""")

    private class Clause(val orig: String) {
        val norm = ArabicText.normalize(orig)
        fun slice(g: MatchGroup?) = g?.let { orig.substring(it.range.first, it.range.last + 1).trim() } ?: ""
    }

    private fun parseClause(raw: String): List<ActionStep> {
        val c = Clause(raw.trim())

        openRe.matchEntire(c.norm)?.let { m ->
            val pkg = AppRegistry.resolve(c.slice(m.groups[1])) ?: return emptyList()
            return listOf(ActionStep(ActionType.OPEN_APP, targetPackage = pkg))
        }
        searchRe.matchEntire(c.norm)?.let { m ->
            return listOf(ActionStep(ActionType.TYPE_TEXT, targetComponent = "search box", textPayload = c.slice(m.groups[1])))
        }
        likeRe.matchEntire(c.norm)?.let { m ->
            return targetThen(c.slice(m.groups[1]), ActionStep(ActionType.CLICK, targetDescription = "Like"))
        }
        shareFollowRe.matchEntire(c.norm)?.let { m ->
            val first = m.groupValues[1]
            val desc = if (first.startsWith("ش") || first.startsWith("share") || first == "مشاركه") "Share" else "Follow"
            return targetThen(c.slice(m.groups[2]), ActionStep(ActionType.CLICK, targetDescription = desc))
        }
        writeRe.matchEntire(c.norm)?.let { m ->
            return writeSteps(c, m.groups[1]!!)
        }
        if (sendRe.matches(c.norm)) return listOf(ActionStep(ActionType.CLICK, targetDescription = "Send"))
        clickRe.matchEntire(c.norm)?.let { m ->
            val target = c.slice(m.groups[1])
            val label = Synonyms.canonicalLabel(target)
            return listOf(
                if (label != null) ActionStep(ActionType.CLICK, targetDescription = label)
                else ActionStep(ActionType.FIND_AND_CLICK, searchText = target),
            )
        }
        scrollRe.matchEntire(c.norm)?.let { m ->
            val up = c.norm.startsWith("اطلع") || listOf("فوق", "up", "اعلي").any(m.groupValues[1]::contains)
            return listOf(ActionStep(ActionType.SCROLL, direction = if (up) "up" else "down"))
        }
        if (backRe.matches(c.norm)) return listOf(ActionStep(ActionType.BACK))
        if (homeRe.matches(c.norm)) return listOf(ActionStep(ActionType.HOME))
        return emptyList()
    }

    /** `[find the named post] -> action`; just the action when no post is named. */
    private fun targetThen(rawTarget: String, action: ActionStep): List<ActionStep> {
        val target = stripLeading(rawTarget, postWord)
        return if (target.isBlank()) listOf(action)
        else listOf(ActionStep(ActionType.FIND_AND_CLICK, searchText = target, targetComponent = "post"), action)
    }

    /** "اكتب له تعليق X" / "علق X" -> type into comment box, then Send. Plain "اكتب X" only types. */
    private fun writeSteps(c: Clause, body: MatchGroup): List<ActionStep> {
        val verbIsComment = c.norm.startsWith("علق") || c.norm.startsWith("comment") ||
            (c.norm.contains("تعليق") && c.norm.indexOf("تعليق") < body.range.first)
        var text = c.slice(body)
        val addressed = toWhom.containsMatchIn(ArabicText.normalize(text))
        text = stripLeading(text, toWhom)
        val labelled = commentLabel.containsMatchIn(ArabicText.normalize(text))
        text = stripLeading(text, commentLabel)
        if (text.isBlank()) return emptyList()
        val isComment = verbIsComment || addressed || labelled
        return buildList {
            add(ActionStep(ActionType.TYPE_TEXT, targetComponent = if (isComment) "comment box" else "text field", textPayload = text))
            if (isComment) add(ActionStep(ActionType.CLICK, targetDescription = "Send"))
        }
    }

    private fun stripLeading(s: String, re: Regex): String {
        val m = re.find(ArabicText.normalize(s)) ?: return s.trim()
        return s.substring(m.range.last + 1).trim()
    }
}
