# Voice Agent (Android MVP)

Speak a command (Egyptian/MSA Arabic or English) -> it becomes a JSON plan -> an `AccessibilityService`
carries it out on **any** app's UI (open app, find, click, type, scroll, back/home).

```
"افتح فيسبوك، واعمل لايك لبوست محمد أحمد، واكتب له تعليق منور يا محمد"
   -> SpeechEngine (ar-EG) -> PlanParser -> ExecutionPlan JSON -> ActionExecutor -> VoiceAgentService
```

## Layout
| Module | What | Testable here |
|---|---|---|
| `core` (pure Kotlin/JVM) | plan model + JSON, `RuleBasedParser` (offline, dialect-aware), `ClaudePlanParser` (LLM), `NodeMatcher` (UI search), `Synonyms`, `AppRegistry`, `SpeechEngine` interface | `gradle :core:test` |
| `app` (Android) | `AndroidSpeechEngine`, `VoiceAgentService`, `ActionExecutor`, `MainActivity` | build in Android Studio / `gradle :app:assembleDebug` with the SDK |

## Plan format
`action_type` is one of `open_app`, `find_and_click`, `click`, `type_text`, `scroll`, `back`, `home`, `wait`.
Fields: `target_package`, `search_text`, `target_component`, `target_description`, `text_payload`, `direction`, `duration_ms`.
Unknown/malformed steps are dropped by `PlanValidator` before anything executes.

## Parsing
- **Rules** (default, offline): splits on `،` `ثم` `بعدين` `then`, and on `و`/`and` only when a known verb follows
  (so "محمد و أحمد" stays one name). Typed text keeps its original spelling (normalisation is length-preserving).
- **Claude** (optional): paste an Anthropic API key in the app; falls back to rules on any failure.
  The key is kept in plain `SharedPreferences` — fine for an MVP, move to Keystore-backed storage before shipping.

## Run it
1. Open `voice-agent/` in Android Studio, run `app` on a device (needs Google speech services for `ar-EG`).
2. Tap the status button -> enable **Voice Agent** in Accessibility settings.
3. Tap the mic, speak, review the generated plan, tap **Run plan**.

## Behaviour notes / limits
- The plan is shown first and runs only on tap; execution **stops at the first failed step**.
- Refuses to type into password fields. Payments/deleting are told to the LLM to refuse, but the executor has no allow-list yet — add one before wider use.
- Apps that hide labels (custom-drawn UIs, games, some WebViews) can't be matched by text; that needs OCR/vision as a future step.
- The executor runs in the Activity's scope; for long plans move it into a foreground service.
- Android UI code was written without an SDK in this environment, so it has **not been compiled or run**; `core` is tested.
