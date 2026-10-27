package com.voiceagent.core

import kotlin.test.Test
import kotlin.test.assertEquals

class RuleBasedParserTest {
    private val parser = RuleBasedParser()
    private fun parse(s: String) = parser.parseBlocking(s).steps

    @Test
    fun `egyptian facebook like and comment example`() {
        val steps = parse("افتح فيسبوك، واعمل لايك لبوست محمد أحمد، واكتب له تعليق منور يا محمد")
        assertEquals(
            listOf(
                ActionStep(ActionType.OPEN_APP, targetPackage = "com.facebook.katana"),
                ActionStep(ActionType.FIND_AND_CLICK, searchText = "محمد أحمد", targetComponent = "post"),
                ActionStep(ActionType.CLICK, targetDescription = "Like"),
                ActionStep(ActionType.TYPE_TEXT, targetComponent = "comment box", textPayload = "منور يا محمد"),
                ActionStep(ActionType.CLICK, targetDescription = "Send"),
            ),
            steps,
        )
    }

    @Test
    fun `short colloquial form without comment keyword`() {
        val steps = parse("اعمل لايك لبوست فلان واكتب له منور")
        assertEquals(ActionType.FIND_AND_CLICK, steps[0].actionType)
        assertEquals("فلان", steps[0].searchText)
        assertEquals("منور", steps[2].textPayload)
        assertEquals("Send", steps[3].targetDescription)
    }

    @Test
    fun `and between names is not a split`() {
        val steps = parse("اعمل لايك لبوست محمد و أحمد")
        assertEquals("محمد و أحمد", steps[0].searchText)
    }

    @Test
    fun `english command`() {
        val steps = parse("open whatsapp, then scroll down")
        assertEquals(
            listOf(
                ActionStep(ActionType.OPEN_APP, targetPackage = "com.whatsapp"),
                ActionStep(ActionType.SCROLL, direction = "down"),
            ),
            steps,
        )
    }

    @Test
    fun `plain write only types`() {
        val steps = parse("اكتب أهلا بيك")
        assertEquals(listOf(ActionStep(ActionType.TYPE_TEXT, targetComponent = "text field", textPayload = "أهلا بيك")), steps)
    }

    @Test
    fun `search click back home`() {
        assertEquals("قهوة", parse("دور على قهوة")[0].textPayload)
        assertEquals("Share", parse("اضغط على شير")[0].targetDescription)
        assertEquals(ActionType.BACK, parse("ارجع")[0].actionType)
        assertEquals(ActionType.HOME, parse("الشاشة الرئيسية")[0].actionType)
    }

    @Test
    fun `unknown app and gibberish yield no steps`() {
        assertEquals(0, parse("افتح تطبيق مجهول تماما").size)
        assertEquals(0, parse("blah blah").size)
    }
}
