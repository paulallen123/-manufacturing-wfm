import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const APPROVAL_PREF = "vecta.approvals.biometric";

export async function enableBiometricApprovals(enabled: boolean) {
  await SecureStore.setItemAsync(APPROVAL_PREF, enabled ? "1" : "0");
}

export async function biometricApprovalsEnabled() {
  return (await SecureStore.getItemAsync(APPROVAL_PREF)) !== "0";
}

export async function confirmSensitiveAction(reason: string) {
  if (!(await biometricApprovalsEnabled())) return { ok: true, method: "device-policy" as const };

  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) {
    return { ok: false, method: "unavailable" as const };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm Vecta action",
    promptSubtitle: reason,
    cancelLabel: "Cancel",
    disableDeviceFallback: false
  });
  return { ok: result.success, method: "biometric" as const };
}
