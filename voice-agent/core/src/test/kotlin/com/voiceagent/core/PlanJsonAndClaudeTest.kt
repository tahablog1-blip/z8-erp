package com.voiceagent.core

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlanJsonAndClaudeTest {
    @Test
    fun `round trip uses snake_case keys and omits nulls`() {
        val json = PlanJson.encode(ExecutionPlan(listOf(ActionStep(ActionType.OPEN_APP, targetPackage = "com.facebook.katana"))))
        assertTrue("\"action_type\": \"open_app\"" in json)
        assertTrue("target_package" in json && "search_text" !in json)
        assertEquals(1, PlanJson.decode(json).steps.size)
    }

    @Test
    fun `decode tolerates fences unknown action and drops invalid steps`() {
        val raw = "```json\n{\"steps\":[{\"action_type\":\"fly\"},{\"action_type\":\"click\"},{\"action_type\":\"back\"}]}\n```"
        val plan = PlanValidator.sanitize(PlanJson.decode(raw))
        assertEquals(listOf(ActionType.BACK), plan.steps.map { it.actionType })
    }

    @Test
    fun `claude parser builds request and parses reply`() = runBlocking {
        var seenHeaders = emptyMap<String, String>()
        var seenBody = ""
        val reply = """{"content":[{"type":"text","text":"{\"steps\":[{\"action_type\":\"open_app\",\"target_package\":\"com.whatsapp\"}]}"}]}"""
        val parser = ClaudePlanParser("k", transport = { _, h, b -> seenHeaders = h; seenBody = b; reply })
        val plan = parser.parse("افتح واتساب")
        assertEquals("com.whatsapp", plan.steps.single().targetPackage)
        assertEquals("k", seenHeaders["x-api-key"])
        assertTrue("افتح واتساب" in seenBody)
    }

    @Test
    fun `fallback parser uses rules when llm fails`() = runBlocking {
        val failing = ClaudePlanParser("k", transport = { _, _, _ -> error("offline") })
        val plan = FallbackPlanParser(failing, RuleBasedParser()).parse("افتح يوتيوب")
        assertEquals("com.google.android.youtube", plan.steps.single().targetPackage)
    }
}
