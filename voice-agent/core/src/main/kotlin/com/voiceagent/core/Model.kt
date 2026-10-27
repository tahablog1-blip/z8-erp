package com.voiceagent.core

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class ActionType {
    @SerialName("open_app") OPEN_APP,
    @SerialName("find_and_click") FIND_AND_CLICK,
    @SerialName("click") CLICK,
    @SerialName("type_text") TYPE_TEXT,
    @SerialName("scroll") SCROLL,
    @SerialName("back") BACK,
    @SerialName("home") HOME,
    @SerialName("wait") WAIT,
    @SerialName("unknown") UNKNOWN,
}

/** One atomic UI operation. Only the fields relevant to [actionType] are populated. */
@Serializable
data class ActionStep(
    @SerialName("action_type") val actionType: ActionType = ActionType.UNKNOWN,
    @SerialName("target_package") val targetPackage: String? = null,
    @SerialName("search_text") val searchText: String? = null,
    @SerialName("target_component") val targetComponent: String? = null,
    @SerialName("target_description") val targetDescription: String? = null,
    @SerialName("text_payload") val textPayload: String? = null,
    /** "down" | "up" for [ActionType.SCROLL]. */
    val direction: String? = null,
    /** Milliseconds for [ActionType.WAIT]. */
    @SerialName("duration_ms") val durationMs: Long? = null,
)

@Serializable
data class ExecutionPlan(val steps: List<ActionStep> = emptyList())

object PlanJson {
    @OptIn(ExperimentalSerializationApi::class)
    val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
        prettyPrint = true
    }

    fun encode(plan: ExecutionPlan): String = json.encodeToString(ExecutionPlan.serializer(), plan)

    /** Decodes a plan, tolerating markdown fences / prose around the JSON object (common in LLM output). */
    fun decode(raw: String): ExecutionPlan {
        val start = raw.indexOf('{')
        val end = raw.lastIndexOf('}')
        require(start in 0 until end) { "No JSON object found in plan text" }
        return json.decodeFromString(ExecutionPlan.serializer(), raw.substring(start, end + 1))
    }
}

/** Drops malformed steps so the executor never sees a step it cannot act on. */
object PlanValidator {
    fun sanitize(plan: ExecutionPlan): ExecutionPlan =
        ExecutionPlan(plan.steps.filter(::isValid))

    fun isValid(s: ActionStep): Boolean = when (s.actionType) {
        ActionType.OPEN_APP -> !s.targetPackage.isNullOrBlank()
        ActionType.FIND_AND_CLICK -> !s.searchText.isNullOrBlank()
        ActionType.CLICK -> !s.targetDescription.isNullOrBlank() || !s.searchText.isNullOrBlank()
        ActionType.TYPE_TEXT -> !s.textPayload.isNullOrEmpty()
        ActionType.SCROLL, ActionType.BACK, ActionType.HOME, ActionType.WAIT -> true
        ActionType.UNKNOWN -> false
    }
}
