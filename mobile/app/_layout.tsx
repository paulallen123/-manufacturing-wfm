import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: "#0b2a4a",
          headerStyle: { backgroundColor: "#ffffff" },
          contentStyle: { backgroundColor: "#f4f8fc" }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Vecta" }} />
        <Stack.Screen name="login" options={{ title: "Sign in" }} />
        <Stack.Screen name="assistant" options={{ title: "Ask Vecta" }} />
        <Stack.Screen name="recommendations" options={{ title: "Recommendations" }} />
        <Stack.Screen name="recommendation/[id]" options={{ title: "Recommendation" }} />
      </Stack>
    </>
  );
}
