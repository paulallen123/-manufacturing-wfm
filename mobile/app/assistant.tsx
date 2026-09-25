import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Speech from "expo-speech";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { getLocales } from "expo-localization";
import { sendAssistantAudio, sendAssistantMessage } from "@/src/api";

type Turn = { role: "user" | "vecta"; text: string };

export default function Assistant() {
  const language = useMemo(() => getLocales()[0]?.languageTag || "en-GB", []);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([
    { role: "vecta", text: "Ask me what is happening, what I recommend, or whether I can take an action for you." }
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  useEffect(() => {
    void (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (permission.granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, []);

  function add(role: Turn["role"], text: string) {
    setTurns(existing => [...existing, { role, text }]);
  }

  async function speak(text: string) {
    await Speech.stop();
    Speech.speak(text, { language });
  }

  async function sendText() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    add("user", message);
    setBusy(true);
    setError("");
    try {
      const result = await sendAssistantMessage(message, language);
      add("vecta", result.answer);
      await speak(result.answer);
    } catch (e: any) {
      setError(e?.message || "Vecta assistant is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (busy) return;
    setError("");
    if (!recorderState.isRecording) {
      await recorder.prepareToRecordAsync();
      recorder.record();
      return;
    }

    await recorder.stop();
    if (!recorder.uri) return;
    setBusy(true);
    try {
      const result = await sendAssistantAudio(recorder.uri, language);
      add("user", result.transcript);
      add("vecta", result.answer);
      await speak(result.answer);
    } catch (e: any) {
      setError(e?.message || "Voice request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.thread}>
        {turns.map((turn, index) => (
          <View key={index} style={[styles.bubble, turn.role === "user" ? styles.user : styles.vecta]}>
            <Text style={turn.role === "user" ? styles.userText : styles.vectaText}>{turn.text}</Text>
          </View>
        ))}
        {busy && <ActivityIndicator />}
      </ScrollView>

      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <Pressable onPress={toggleVoice} style={[styles.voice, recorderState.isRecording && styles.recording]}>
          <Text style={styles.voiceText}>{recorderState.isRecording ? "Stop" : "Speak"}</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask Vecta…"
          multiline
          style={styles.input}
        />
        <Pressable disabled={!draft.trim() || busy} onPress={sendText} style={styles.send}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14, gap: 8 },
  thread: { gap: 10, paddingBottom: 10 },
  bubble: { maxWidth: "88%", borderRadius: 18, padding: 13 },
  user: { alignSelf: "flex-end", backgroundColor: "#0969da" },
  vecta: { alignSelf: "flex-start", backgroundColor: "white" },
  userText: { color: "white", lineHeight: 20 },
  vectaText: { color: "#193a57", lineHeight: 20 },
  error: { color: "#a11b1b", paddingHorizontal: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  voice: { backgroundColor: "#e8f4ff", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 12 },
  recording: { backgroundColor: "#ffe8e8" },
  voiceText: { color: "#0b2a4a", fontWeight: "800" },
  input: { flex: 1, maxHeight: 110, backgroundColor: "white", borderRadius: 14, padding: 13, borderWidth: 1, borderColor: "#ccdae8" },
  send: { backgroundColor: "#0969da", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 },
  sendText: { color: "white", fontWeight: "800" }
});
