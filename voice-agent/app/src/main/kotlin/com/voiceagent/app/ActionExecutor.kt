package com.voiceagent.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.voiceagent.core.ActionStep
import com.voiceagent.core.ActionType
import com.voiceagent.core.ExecutionPlan
import com.voiceagent.core.NodeMatcher
import com.voiceagent.core.Synonyms
import kotlinx.coroutines.delay

data class StepResult(val index: Int, val step: ActionStep, val ok: Boolean, val message: String)

/**
 * Runs an [ExecutionPlan] against the live UI. Stops at the first failed step so a mis-heard
 * command can't keep tapping around in an app.
 */
class ActionExecutor(
    private val context: Context,
    private val service: VoiceAgentService,
) {
    private val settleMs = 700L
    private val findTimeoutMs = 4_000L
    private val maxScrollsWhileSearching = 6

    suspend fun run(plan: ExecutionPlan, onResult: (StepResult) -> Unit): Boolean {
        for ((i, step) in plan.steps.withIndex()) {
            val result = try {
                execute(step)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Outcome(false, e.message ?: e::class.java.simpleName)
            }
            onResult(StepResult(i, step, result.ok, result.message))
            if (!result.ok) return false
            delay(settleMs)
        }
        return true
    }

    private class Outcome(val ok: Boolean, val message: String)
    private fun ok(msg: String = "ok") = Outcome(true, msg)
    private fun fail(msg: String) = Outcome(false, msg)

    private suspend fun execute(step: ActionStep): Outcome = when (step.actionType) {
        ActionType.OPEN_APP -> openApp(step.targetPackage!!)
        ActionType.FIND_AND_CLICK -> findAndClick(step.searchText!!)
        ActionType.CLICK -> click(step)
        ActionType.TYPE_TEXT -> typeText(step)
        ActionType.SCROLL -> scroll(step.direction != "up")
        ActionType.BACK -> if (service.back()) ok() else fail("back failed")
        ActionType.HOME -> if (service.home()) ok() else fail("home failed")
        ActionType.WAIT -> { delay((step.durationMs ?: 1000).coerceIn(0, 15_000)); ok() }
        ActionType.UNKNOWN -> fail("unknown action")
    }

    // ---- open_app ---------------------------------------------------------------------------

    private suspend fun openApp(pkg: String): Outcome {
        val intent = context.packageManager.getLaunchIntentForPackage(pkg)
            ?: return fail("app not installed: $pkg")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        context.startActivity(intent)
        val up = waitFor(8_000) { if (service.currentPackage() == pkg) true else null }
        return if (up == true) ok("opened $pkg") else fail("$pkg did not come to foreground")
    }

    // ---- find / click -----------------------------------------------------------------------

    private suspend fun findAndClick(text: String): Outcome {
        var node = waitFor(findTimeoutMs) { service.root()?.let { NodeMatcher.find(it, text) } }
        var scrolls = 0
        while (node == null && scrolls < maxScrollsWhileSearching) {
            scroll(down = true)
            delay(500)
            node = service.root()?.let { NodeMatcher.find(it, text) }
            scrolls++
        }
        return if (node == null) fail("'$text' not found on screen") else tapNode(node as AccessibilityUiNode, "found '$text'")
    }

    private suspend fun click(step: ActionStep): Outcome {
        val labels = Synonyms.labelsFor(step.targetDescription ?: step.searchText!!)
        val node = waitFor(findTimeoutMs) { service.root()?.let { NodeMatcher.findAny(it, labels, requireClickable = true) } }
            ?: return fail("'${labels.first()}' not found on screen")
        return tapNode(node as AccessibilityUiNode, "clicked '${labels.first()}'")
    }

    private suspend fun tapNode(node: AccessibilityUiNode, msg: String): Outcome {
        val target = (NodeMatcher.clickableAncestor(node) ?: node) as AccessibilityUiNode
        if (target.info.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return ok(msg)
        val b = target.bounds()
        return if (!b.isEmpty && service.tap(b.exactCenterX(), b.exactCenterY())) ok("$msg (gesture)")
        else fail("could not click")
    }

    // ---- type_text --------------------------------------------------------------------------

    private suspend fun typeText(step: ActionStep): Outcome {
        val text = step.textPayload!!
        val hint = step.targetComponent
            ?.replace(Regex("(?i)\\b(box|field|input)\\b"), "")?.trim()?.takeIf { it.isNotEmpty() }

        var field = service.root()?.let { NodeMatcher.findEditable(it, hint) }
        if (field == null && hint != null) {
            // Many apps only show the input after tapping a "Comment" / "Search" affordance.
            val opener = service.root()?.let { NodeMatcher.findAny(it, Synonyms.labelsFor(hint), requireClickable = true) }
            if (opener != null) tapNode(opener as AccessibilityUiNode, "opened $hint")
            field = waitFor(findTimeoutMs) { service.root()?.let { NodeMatcher.findEditable(it, hint) } }
        }
        val f = (field ?: return fail("no text field found")) as AccessibilityUiNode
        if (f.isPassword) return fail("refusing to type into a password field")

        f.info.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        f.info.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        if (f.info.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return ok("typed")

        // Fallback: clipboard paste for fields that reject SET_TEXT.
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("voice-agent", text))
        return if (f.info.performAction(AccessibilityNodeInfo.ACTION_PASTE)) ok("pasted") else fail("could not enter text")
    }

    // ---- scroll -----------------------------------------------------------------------------

    private suspend fun scroll(down: Boolean): Outcome {
        val root = service.root() ?: return fail("no active window")
        val scrollable = NodeMatcher.findScrollable(root) as AccessibilityUiNode?
        val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        if (scrollable?.info?.performAction(action) == true) return ok("scrolled")

        val b = root.bounds()
        val x = b.exactCenterX()
        val (y1, y2) = if (down) b.height() * 0.75f to b.height() * 0.25f else b.height() * 0.25f to b.height() * 0.75f
        return if (service.swipe(x, y1, x, y2)) ok("swiped") else fail("scroll failed")
    }

    // ---- util -------------------------------------------------------------------------------

    private suspend fun <T : Any> waitFor(timeoutMs: Long, poll: Long = 300, block: () -> T?): T? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            block()?.let { return it }
            if (System.currentTimeMillis() >= deadline) return null
            delay(poll)
        }
    }
}
