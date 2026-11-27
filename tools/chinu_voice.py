from pathlib import Path

def patch_voice(project: Path):
    root = project / "app/src/main/java/com/meraassistant"

    def load(name):
        p = root / (name + ".kt")
        return p, p.read_text(encoding="utf-8")

    def edit(s, old, new):
        if s.count(old) != 1:
            raise ValueError(f"Expected one Android source match for {old[:90]}")
        return s.replace(old, new, 1)

    p, s = load("WakeService")
    s = edit(s, "    private var lastWake = 0L", """    @Volatile private var rearmAt = 0L
    private var lastWake = 0L
    @Volatile private var destroyed = false""")
    s = edit(s, """                model = m
                handler.post(poll)""", """                if (destroyed) m.close() else {
                    model = m
                    handler.post(poll)
                }""")
    s = edit(s, """    override fun onDestroy() {
        instance = null""", """    override fun onDestroy() {
        destroyed = true
        instance = null""")
    s = edit(s, """        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        val ttsBusy""", """        if (destroyed || android.os.SystemClock.elapsedRealtime() < rearmAt) return false
        if (!getSharedPreferences("settings", MODE_PRIVATE).getBoolean("wake", true)) return false
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        val ttsBusy""")
    s = edit(s, '''        if (AssistantService.instance != null || !prefs.getBoolean("accWasOn", false)) return''', '''        if (AssistantService.instance != null || AccGuard.isOn(this) || !prefs.getBoolean("accWasOn", false)) return''')
    a = s.index("                val isFinal = recognizer.acceptWaveForm")
    b = s.index("                    val male =", a)
    s = s[:a] + """                if (!running || !recognizer.acceptWaveForm(buf, n)) continue
                val result = try { JSONObject(recognizer.result) } catch (_: Exception) { continue }
                if (running && isWake(result)) {
""" + s[b:]
    s = edit(s, """        val greets = GREETINGS.filter { g -> g.isEmpty() || k == null || g.trim() in k }""",
             """        val greets = GREET_WORDS.filter { k == null || it in k }""")
    s = edit(s, 'phrases.add((g + n).trim())', 'phrases.add("$g $n")')
    a = s.index("        while (toks.isNotEmpty()")
    b = s.index("    private fun onWakeWord", a)
    s = s[:a] + """        if (toks.size !in 2..3 || toks.any { it.first == "[unk]" }) return false
        if (toks.first().first !in GREET_WORDS || toks.first().second < .60) return false
        val name = toks.drop(1).joinToString(" ") { it.first }
        if (name !in NAME_WORDS) return false
        val sense = getSharedPreferences("settings", MODE_PRIVATE).getInt("wakeSense", 1)
        val threshold = when (sense) {
            0 -> .86
            2 -> .66
            else -> .74
        }
        val minConfidence = if (mediaPlaying()) maxOf(.86, threshold) else threshold
        return toks.drop(1).all { it.second >= minConfidence }
    }

""" + s[b:]
    s = edit(s, """        val now = System.currentTimeMillis()
        if (now - lastWake < 1200) return
        lastWake = now""", """        val now = android.os.SystemClock.elapsedRealtime()
        if (!shouldListen() || (lastWake != 0L && now - lastWake < 3500)) return
        lastWake = now
        rearmAt = now + 3500""")
    s = edit(s, """    fun pauseNow() {
        stopEngine()
    }""", """    fun pauseNow() {
        rearmAt = maxOf(rearmAt, android.os.SystemClock.elapsedRealtime() + 1800)
        stopEngine()
    }""")
    s = edit(s, '''            "chin new", "chin you", "chin u", "china"''', '''            "chin new", "chin you", "chin u"''')
    s = edit(s, '''        private val GREETINGS = listOf("", "hi ", "hey ", "hello ", "ok ", "okay ", "hai ", "haan ", "han ", "ha ")
        private val GREET_WORDS = setOf("hi", "hey", "hello", "ok", "okay", "hai", "haan", "han", "ha")''',
             '''        private val GREET_WORDS = setOf("hi", "hey", "hello", "ok", "okay", "hai", "haan")''')
    p.write_text(s, encoding="utf-8")

    p, s = load("AssistantService")
    s = edit(s, """        Speaker.load(this)
        instance = this
        getSharedPreferences("settings", MODE_PRIVATE).edit().putBoolean("accWasOn", true).apply()
        BeepMuter.forceUnmute(this)
        try {
            if (overlay == null) overlay = ChinuOverlay(this)
        } catch (e: Exception) {
        }""", """        instance = this
        getSharedPreferences("settings", MODE_PRIVATE).edit().putBoolean("accWasOn", true).apply()
        runCatching { Speaker.load(this) }
        runCatching { BeepMuter.forceUnmute(this) }""")
    s = edit(s, """        overlay?.dismiss(true)
        instance = null
        return super.onUnbind(intent)""", """        releaseOverlay()
        return super.onUnbind(intent)""")
    s = edit(s, """    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }""", """    override fun onDestroy() {
        releaseOverlay()
        super.onDestroy()
    }

    private fun releaseOverlay() {
        if (instance === this) instance = null
        val current = overlay
        overlay = null
        runCatching { current?.dispose() }
        handler.removeCallbacksAndMessages(null)
    }""")
    p.write_text(s, encoding="utf-8")

    p, s = load("ChinuOverlay")
    s = edit(s, "    private var followUps = 0          // how many times we kept listening after a reply",
             "    private var utterance: String? = null\n    private var disposed = false\n    private var retriedRecognition = false")
    s = edit(s, '            val p = Profile.load(svc)\n            listenAfter = true\n            val en = selectedLang() == "en-IN"\n            val who = Speaker.name(p)\n            reply(Bday.greet(svc) ?: (if (en) "Yes?" else "हाँ जी?"), "hi-IN".takeIf { Bday.greet(svc) != null } ?: (if (en) "en-IN" else "hi-IN"))', '            val greeting = Bday.greet(svc)\n            if (greeting != null) {\n                listenAfter = true\n                reply(greeting, "hi-IN")\n            } else {\n                val session = root\n                handler.postDelayed({ if (root === session) startListening() }, 300)\n            }')
    s = edit(s, "        followUps = 0", "        retriedRecognition = false")
    s = edit(s, """    private fun removeNow() {""", """    fun dispose() {
        disposed = true
        dismiss(true)
        handler.removeCallbacksAndMessages(null)
        runCatching { recognizer?.destroy() }
        runCatching { tts?.shutdown() }
        recognizer = null
        tts = null
        pendingSpeech = null
    }

    private fun removeNow() {""")
    s = edit(s, """        if (stopVoice) {
            tts?.stop()""", """        if (stopVoice) {
            utterance = null
            pendingSpeech = null
            tts?.stop()""")
    s = edit(s, '''        tts?.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "ov-${System.currentTimeMillis()}")''',
             '''        val id = "ov-${android.os.SystemClock.elapsedRealtimeNanos()}"
        utterance = id
        if (tts?.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) finishUtterance(id)''')
    s = edit(s, """        if (status != TextToSpeech.SUCCESS) return""", """        if (disposed) return
        if (status != TextToSpeech.SUCCESS) {
            handler.post { pendingSpeech = null; afterSpeaking() }
            return
        }""")
    s = s.replace("handler.post { afterSpeaking() }", "handler.post { finishUtterance(utteranceId) }")
    s = edit(s, """                MainActivity.speaking = false
            }

            @Deprecated""", """                handler.post { finishUtterance(utteranceId) }
            }

            @Deprecated""")
    a = s.index("    private fun afterSpeaking()")
    b = s.index("    private fun startListening()", a)
    s = s[:a] + """    private fun finishUtterance(id: String?) {
        if (id == null || id != utterance) return
        utterance = null
        afterSpeaking()
    }

    private fun afterSpeaking() {
        MainActivity.speaking = false
        WakeService.pause()
        if (root == null || disposed) return
        if (listenAfter) {
            listenAfter = false
            inFollowUp = false
            val session = root
            handler.postDelayed({ if (root === session && utterance == null) startListening() }, 600)
        } else {
            bird?.state = BirdView.State.IDLE
            handler.removeCallbacks(autoClose)
            handler.postDelayed(autoClose, 2600)
        }
    }

""" + s[b:]
    s = edit(s, """        if (root == null) return
        handler.removeCallbacks(autoClose)
        tts?.stop()""", """        if (root == null || disposed || listening || utterance != null) return
        handler.removeCallbacks(autoClose)
        WakeService.pause()""")
    s = edit(s, """        listening = false
        BeepMuter.unmute(svc)
        val matches""", """        if (!listening || root == null || disposed) return
        listening = false
        BeepMuter.unmute(svc)
        val matches""")
    s = edit(s, """        if (Ears.shouldFallBack(error)) {""", """        if (root == null || disposed) return
        if (!retriedRecognition && Ears.shouldFallBack(error)) {
            retriedRecognition = true""")
    s = edit(s, """        History.add(matches[0])
        processor.handle(matches)""", '''        val command = matches.first().trim()
        if (command.matches(Regex("""(?iu)^(?:(?:hey|hi|hello|haan|hanji|haanji|हाँजी|हाँ जी)\\s*)?(?:chinu|cheenu|chinnu|चीनू)?[.!? ]*$"""))) {
            bird?.state = BirdView.State.IDLE
            handler.postDelayed(autoClose, 900)
            return
        }
        History.add(command)
        processor.handle(matches)''')
    p.write_text(s, encoding="utf-8")
