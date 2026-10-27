package com.voiceagent.core

/** Turns a transcript into an executable plan. Implementations: offline rules, LLM, or a chain of both. */
interface PlanParser {
    suspend fun parse(transcript: String): ExecutionPlan
}

/** Tries [primary]; on failure or an empty plan falls back to [fallback]. */
class FallbackPlanParser(
    private val primary: PlanParser,
    private val fallback: PlanParser,
) : PlanParser {
    override suspend fun parse(transcript: String): ExecutionPlan {
        val p = runCatching { primary.parse(transcript) }.getOrNull()
        return if (p != null && p.steps.isNotEmpty()) p else fallback.parse(transcript)
    }
}
