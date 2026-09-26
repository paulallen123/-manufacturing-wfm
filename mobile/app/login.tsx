import { useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { signIn } from "@/src/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Sign in to Vecta</Text>
      <Text style={styles.help}>Your role and tenant permissions come from Vecta. The mobile app cannot elevate them.</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="username"
        placeholder="Email"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        placeholder="Password"
        style={styles.input}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable disabled={busy || !email || !password} onPress={submit} style={({ pressed }) => [styles.button, (pressed || busy) && styles.dim]}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 14, justifyContent: "center" },
  title: { color: "#0b2a4a", fontSize: 30, fontWeight: "800" },
  help: { color: "#48647d", fontSize: 15, lineHeight: 21, marginBottom: 8 },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: "#ccdae8", borderRadius: 14, padding: 16, fontSize: 16 },
  error: { color: "#a11b1b" },
  button: { backgroundColor: "#0969da", borderRadius: 14, padding: 16, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "800" },
  dim: { opacity: 0.6 }
});
