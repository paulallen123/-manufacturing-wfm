import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { confirmRecommendation, listRecommendations, VectaEpisode } from "@/src/api";
import { confirmSensitiveAction } from "@/src/security";

export default function RecommendationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [episode, setEpisode] = useState<VectaEpisode | null>(null);
  const [busy, setBusy] = useState(true);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [error, setError] = useState("");
  const recommended = useMemo(
    () => episode?.options.find(option => option.id === episode.recommendation.optionId) || null,
    [episode]
  );

  useEffect(() => {
    void (async () => {
      try {
        const items = await listRecommendations();
        setEpisode(items.find(item => item.episodeId === id) || null);
      } catch (e: any) {
        setError(e?.message || "Could not load recommendation.");
      } finally {
        setBusy(false);
      }
    })();
  }, [id]);

  async function decide(decision: "APPROVE" | "REJECT") {
    if (!episode || !recommended) return;
    setDecisionBusy(true);
    setError("");
    try {
      if (decision === "APPROVE") {
        const confirmation = await confirmSensitiveAction(recommended.label);
        if (!confirmation.ok) {
          setError("Device confirmation was not completed. No Vecta action was approved.");
          return;
        }
      }

      const result = await confirmRecommendation({
        episodeId: episode.episodeId,
        optionId: recommended.id,
        contextRevision: episode.contextRevision,
        decision,
        execute: decision === "APPROVE"
      });

      Alert.alert(
        decision === "APPROVE" ? "Recommendation confirmed" : "Recommendation rejected",
        result.execution?.state
          ? "Vecta execution state: " + result.execution.state
          : "Your decision has been recorded in Vecta's audit trail."
      );
    } catch (e: any) {
      setError(e?.message || "The decision was not accepted.");
    } finally {
      setDecisionBusy(false);
    }
  }

  if (busy) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!episode || !recommended) return <View style={styles.center}><Text>{error || "Recommendation not found."}</Text></View>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.kicker}>{episode.decisionType.replace(/-/g, " ").toUpperCase()}</Text>
      <Text style={styles.title}>{recommended.label}</Text>
      <Text style={styles.meta}>{episode.site} · {new Date(episode.triggeredAt).toLocaleString()}</Text>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Why Vecta recommends this</Text>
        <Text style={styles.body}>Reason: {episode.recommendation.reason}</Text>
        <Text style={styles.body}>Uncertainty: {Math.round(recommended.uncertainty * 100)}%</Text>
        <Text style={styles.body}>Policy allowed: {recommended.policyAllowed ? "Yes" : "No"}</Text>
        <Text style={styles.body}>Hard constraints passed: {recommended.hardConstraintsPassed ? "Yes" : "No"}</Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Expected impact</Text>
        {Object.entries(recommended.prediction).map(([key, value]) =>
          value == null ? null : <Text key={key} style={styles.body}>{key}: {String(value)}</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Evidence</Text>
        {[...episode.sourceEvidence, ...recommended.evidenceRefs].map((ref, index) => (
          <Text key={ref + index} style={styles.evidence}>• {ref}</Text>
        ))}
      </View>

      <View style={styles.warning}>
        <Text style={styles.warningTitle}>Server remains authoritative</Text>
        <Text style={styles.warningBody}>
          Confirming on this phone never bypasses Vecta's current-context check, role permissions, safety gate, rollback or post-action verification.
        </Text>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable disabled={decisionBusy} onPress={() => decide("REJECT")} style={styles.reject}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
        <Pressable disabled={decisionBusy} onPress={() => decide("APPROVE")} style={styles.approve}>
          <Text style={styles.approveText}>{decisionBusy ? "Checking…" : "Confirm recommendation"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  page: { padding: 20, gap: 14 },
  kicker: { color: "#59809e", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#0b2a4a", fontSize: 30, fontWeight: "800" },
  meta: { color: "#61798e" },
  block: { backgroundColor: "white", borderRadius: 18, padding: 18, gap: 6 },
  blockTitle: { color: "#0b2a4a", fontSize: 17, fontWeight: "800", marginBottom: 4 },
  body: { color: "#3f5e78", lineHeight: 20 },
  evidence: { color: "#3f5e78", lineHeight: 20 },
  warning: { backgroundColor: "#e8f4ff", borderRadius: 18, padding: 16, gap: 5 },
  warningTitle: { color: "#0b2a4a", fontWeight: "800" },
  warningBody: { color: "#31516f", lineHeight: 20 },
  error: { color: "#a11b1b" },
  actions: { flexDirection: "row", gap: 10 },
  reject: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: "#9fb4c7", padding: 15, alignItems: "center" },
  rejectText: { color: "#31516f", fontWeight: "800" },
  approve: { flex: 2, borderRadius: 14, backgroundColor: "#0969da", padding: 15, alignItems: "center" },
  approveText: { color: "white", fontWeight: "800" }
});
