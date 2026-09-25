# Vecta App Store release gate

No App Store submission is allowed until all of the following are evidenced against the exact candidate build:

- Native value beyond a repackaged website: voice input/output, push/deep links, biometric confirmation, secure device storage and mobile-native workflows.
- Physical-device acceptance on supported iPhones/iPads; no simulator-only pass.
- Role parity matrix proves every authorised web capability has a mobile route or is explicitly blocked with a documented safety reason.
- Golden Journey passes from sign-in through recommendation, approval, execution/verification where permitted, audit receipt and recovery.
- Cross-tenant, role escalation, stolen-session, replayed approval, stale-context and offline-queue attacks fail closed.
- Consequential actions cannot be approved from stale/offline evidence and cannot bypass server policy.
- Voice/audio permissions are purpose-limited; recordings are not retained longer than required by the declared product policy.
- Push notification contents do not leak sensitive employee/payroll information onto a locked screen.
- Privacy policy, App Privacy answers, data retention/deletion wording and support contact are complete and match runtime behaviour.
- App Review receives a working review account or approved review path and all backend services are live during review.
- Accessibility checks include VoiceOver, Voice Control, Dynamic Type, contrast and non-colour-only state.
- Crash-free launch, reconnect, background/foreground, interrupted voice, notification deep-link and expired-session scenarios pass.
- TestFlight candidate hash/build number is bound to the evidence package before App Review submission.

The provisional bundle id is `com.vecta.workforce`. Confirm ownership/availability before the first App Store Connect record because the production identifier should be treated as permanent.
