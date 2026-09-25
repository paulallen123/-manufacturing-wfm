import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

const cards = [
  {
    href: "/assistant" as const,
    title: "Ask Vecta",
    body: "Type or speak. Ask what is happening, what Vecta recommends, or ask Vecta to take a supported action."
  },
  {
    href: "/recommendations" as const,
    title: "Decisions needing you",
    body: "Review evidence, impact, uncertainty and risk. Approve or reject from your phone."
  },
  {
    href: "/login" as const,
    title: "Secure access",
    body: "Use the same Vecta identity, tenant and permissions as the web product."
  }
];

export default function Home() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>WORKFORCE OPERATIONS, ANYWHERE</Text>
        <Text style={styles.title}>Vecta in your pocket.</Text>
        <Text style={styles.lead}>
          The mobile client is designed to use the same live decisions, controls and audit trail as Vecta on the web.
        </Text>
      </View>

      <View style={styles.signal}>
        <Text style={styles.signalTitle}>One control plane</Text>
        <Text style={styles.signalText}>
          Mobile does not create a second source of truth. Permissions, recommendations and actions remain server-authoritative.
        </Text>
      </View>

      {cards.map(card => (
        <Link key={card.href} href={card.href} style={styles.link}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardBody}>{card.body}</Text>
            <Text style={styles.open}>Open →</Text>
          </View>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  hero: { backgroundColor: "#0b2a4a", borderRadius: 24, padding: 24, gap: 10 },
  kicker: { color: "#9ed0ff", fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: "white", fontSize: 32, fontWeight: "800" },
  lead: { color: "#dcecff", fontSize: 16, lineHeight: 23 },
  signal: { backgroundColor: "#e8f4ff", borderRadius: 18, padding: 18, gap: 5 },
  signalTitle: { color: "#0b2a4a", fontSize: 16, fontWeight: "800" },
  signalText: { color: "#31516f", lineHeight: 20 },
  link: { textDecorationLine: "none" },
  card: { backgroundColor: "white", borderRadius: 20, padding: 20, gap: 8 },
  cardTitle: { color: "#0b2a4a", fontSize: 20, fontWeight: "800" },
  cardBody: { color: "#48647d", fontSize: 15, lineHeight: 21 },
  open: { color: "#0969da", fontWeight: "800", marginTop: 4 }
});
