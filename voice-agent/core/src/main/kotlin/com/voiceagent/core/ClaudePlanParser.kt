package com.voiceagent.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.HttpURLConnection


/** Sends a JSON body, returns the response body. Swappable so tests (and other HTTP stacks) can stand in. */
fun interface HttpTransport {
    fun post(url: String, headers: Map<String, String>, body: String): String
}

class UrlConnectionTransport(private val timeoutMs: Int = 20_000) : HttpTransport {
    override fun post(url: String, headers: Map<String, String>, body: String): String {
        val conn = java.net.URI(url).toURL().openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.doOutput = true
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            check(conn.responseCode in 200..299) { "HTTP ${conn.responseCode}: ${text.take(300)}" }
            return text
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * LLM-backed parser: understands free-form dialect and unseen apps/actions better than the rules.
 * Output is always run through [PlanValidator], so a bad model reply can never reach the executor.
 */
class ClaudePlanParser(
    private val apiKey: String,
    private val model: String = "claude-haiku-5-5",
    private val transport: HttpTransport = UrlConnectionTransport(),
    private val endpoint: String = "https://api.anthropic.com/v1/messages",
) : PlanParser {

    override suspend fun parse(transcript: String): ExecutionPlan {
        val request = JsonObject(
            mapOf(
                "model" to JsonPrimitive(model),
                "max_tokens" to JsonPrimitive(1024),
                "system" to JsonPrimitive(SYSTEM_PROMPT),
                "messages" to JsonArray(
                    listOf(
                        JsonObject(mapOf("role" to JsonPrimitive("user"), "content" to JsonPrimitive(transcript))),
                    ),
                ),
            ),
        )
        val response = transport.post(
            endpoint,
            mapOf(
                "content-type" to "application/json",
                "x-api-key" to apiKey,
                "anthropic-version" to "2023-06-01",
            ),
            request.toString(),
        )
        val text = PlanJson.json.parseToJsonElement(response).jsonObject["content"]!!
            .jsonArray.joinToString("") { it.jsonObject["text"]?.jsonPrimitive?.contentOrNull.orEmpty() }
        return PlanValidator.sanitize(PlanJson.decode(text))
    }

    companion object {
        val SYSTEM_PROMPT = """
You convert a spoken command (Arabic incl. Egyptian dialect, or English) into a UI automation plan for an Android accessibility agent.
Reply with ONE JSON object only, no prose, no markdown: {"steps":[...]}.

Each step has "action_type" and only the fields it needs:
- open_app: "target_package" (Android package name, e.g. com.facebook.katana, com.whatsapp, com.instagram.android)
- find_and_click: "search_text" (visible text to locate, keep original spelling), optional "target_component" (e.g. "post")
- click: "target_description" (button label such as Like, Comment, Send, Share, Follow)
- type_text: "text_payload" (exact text to type), "target_component" (e.g. "comment box", "search box")
- scroll: "direction" ("down" or "up")
- back, home: no fields
- wait: "duration_ms"

Rules: keep steps minimal and in execution order; never invent text the user did not say; typing a comment is followed by a click on Send;
if the command is unclear or unsafe (payments, deleting data, passwords), return {"steps":[]}.
""".trim()
    }
}
