package com.voiceagent.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.RadioButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.voiceagent.core.ClaudePlanParser
import com.voiceagent.core.ExecutionPlan
import com.voiceagent.core.FallbackPlanParser
import com.voiceagent.core.PlanJson
import com.voiceagent.core.PlanParser
import com.voiceagent.core.RuleBasedParser
import com.voiceagent.core.SpeechEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity(), SpeechEngine.Listener {

    private lateinit var speech: AndroidSpeechEngine
    private lateinit var serviceStatus: Button
    private lateinit var micButton: Button
    private lateinit var transcript: EditText
    private lateinit var apiKey: EditText
    private lateinit var planView: TextView
    private lateinit var runButton: Button
    private lateinit var logView: TextView

    private var plan: ExecutionPlan? = null
    private var runJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        speech = AndroidSpeechEngine(this)

        serviceStatus = findViewById(R.id.serviceStatus)
        micButton = findViewById(R.id.micButton)
        transcript = findViewById(R.id.transcript)
        apiKey = findViewById(R.id.apiKey)
        planView = findViewById(R.id.planView)
        runButton = findViewById(R.id.runButton)
        logView = findViewById(R.id.logView)

        apiKey.setText(prefs().getString(KEY_API, ""))
        serviceStatus.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        micButton.setOnClickListener { onMic() }
        findViewById<Button>(R.id.parseButton).setOnClickListener { buildPlan() }
        runButton.setOnClickListener { runPlan() }
        findViewById<RadioButton>(R.id.langAr).setOnClickListener { speech.languageTag = "ar-EG" }
        findViewById<RadioButton>(R.id.langEn).setOnClickListener { speech.languageTag = "en-US" }
    }

    override fun onResume() {
        super.onResume()
        serviceStatus.setText(if (VoiceAgentService.instance != null) R.string.service_on else R.string.service_off)
    }

    override fun onPause() {
        prefs().edit().putString(KEY_API, apiKey.text.toString().trim()).apply()
        super.onPause()
    }

    override fun onDestroy() {
        speech.release()
        super.onDestroy()
    }

    // ---- speech -----------------------------------------------------------------------------

    private fun onMic() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        micButton.setText(R.string.listening)
        speech.start(this)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (code == REQ_MIC && results.firstOrNull() == PackageManager.PERMISSION_GRANTED) onMic()
    }

    override fun onPartial(text: String) = transcript.setText(text)

    override fun onFinal(text: String) {
        micButton.setText(R.string.listen)
        transcript.setText(text)
        buildPlan()
    }

    override fun onError(message: String) {
        micButton.setText(R.string.listen)
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    // ---- plan + execute ---------------------------------------------------------------------

    private fun parser(): PlanParser {
        val rules = RuleBasedParser()
        val key = apiKey.text.toString().trim()
        return if (key.isEmpty()) rules else FallbackPlanParser(ClaudePlanParser(key), rules)
    }

    private fun buildPlan() {
        val text = transcript.text.toString().trim()
        if (text.isEmpty()) return
        val p = parser()
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { p.parse(text) }
            plan = result
            planView.text = if (result.steps.isEmpty()) "—" else PlanJson.encode(result)
            runButton.isEnabled = result.steps.isNotEmpty()
            logView.text = if (result.steps.isEmpty()) "Couldn't build a plan from that command." else ""
        }
    }

    private fun runPlan() {
        val p = plan ?: return
        val svc = VoiceAgentService.instance
        if (svc == null) {
            Toast.makeText(this, R.string.service_off, Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }
        runJob?.cancel()
        logView.text = ""
        runButton.isEnabled = false
        runJob = lifecycleScope.launch {
            val done = ActionExecutor(applicationContext, svc).run(p) { r ->
                logView.append("${if (r.ok) "✓" else "✗"} ${r.index + 1}. ${r.step.actionType} — ${r.message}\n")
            }
            logView.append(if (done) "Done.\n" else "Stopped.\n")
            runButton.isEnabled = true
        }
    }

    private fun prefs() = getSharedPreferences("voice_agent", Context.MODE_PRIVATE)

    private companion object {
        const val REQ_MIC = 1
        const val KEY_API = "anthropic_key"
    }
}
