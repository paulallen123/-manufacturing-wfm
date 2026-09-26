import { useCallback, useEffect, useState } from "react";
import { Link } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { listRecommendations, VectaEpisode } from "@/src/api";

export default function Recommendations() {
  const [items, setItems] = useState<VectaEpisode[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try { setItems(await listRecommendations()); }
    catch (e: any) { setError(e?.message || "Could not load recommendations."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Decisions needing you</Text>
          <Text style={styles.help}>Live server-side Vecta decision episodes. Mobile cannot bypass authority or tenant controls.</Text>
        </View>
        <Pressable onPress={load} style={styles.refresh}><Text style={styles.refreshText}>Refresh</Text></Pressable>
      </View>

      {busy && <ActivityIndicator />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!busy && !items.length && !error && <Text style={styles.empty}>No recommendation episodes are waiting.</Text>}

      {items.map(item => {
        const recommended = item.options.find(option => option.id === item.recommendation.optionId);
        return (
          <Link
            key={item.episodeId}
            href={{ pathname: "/recommendation/[id]", params: { id: item.episodeId } }}
            style={styles.link}
          >
            <View style={styles.card}>
              <Text style={styles.type}>{item.decisionType.replace(/-/g, " ").toUpperCase()}</Text>
              <Text style={styles.cardTitle}>{recommended?.label || "Review Vecta recommendation"}</Text>
              <Text style={styles.meta}>{item.site} · {new Date(item.triggeredAt).toLocaleString()}</Text>
              <Text style={styles.authority}>{item.recommendation.authorityRequired}</Text>
            </View>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 12 },
  top: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  title: { color: "#0b2a4a", fontSize: 28, fontWeight: "800" },
  help: { color: "#48647d", lineHeight: 20, marginTop: 4 },
  refresh: { backgroundColor: "#e8f4ff", padding: 10, borderRadius: 12 },
  refreshText: { color: "#0969da", fontWeight: "800" },
  error: { color: "#a11b1b" },
  empty: { color: "#48647d", marginTop: 20 },
  link: { textDecorationLine: "none" },
  card: { backgroundColor: "white", borderRadius: 18, padding: 18, gap: 6 },
  type: { color: "#59809e", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  cardTitle: { color: "#0b2a4a", fontSize: 19, fontWeight: "800" },
  meta: { color: "#61798e" },
  authority: { color: "#0969da", fontWeight: "800", marginTop: 4 }
});
