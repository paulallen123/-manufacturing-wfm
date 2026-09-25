# Vecta Mobile

Vecta Mobile is a first-class iOS/Android client for the existing Vecta workforce operations control plane.

## Non-negotiables

- Mobile is not an employee-only companion and is not a separate product.
- Every web capability that is safe for a user's role must have a mobile route before GA.
- The server remains authoritative for tenant isolation, role/capability checks, decision context, policy, audit, execution, rollback and verification.
- The app must never fabricate an execution plan from display data.
- Consequential approvals require a fresh server context check and device confirmation.
- Offline mode may cache safe reads and drafts. It must never execute consequential workforce/payroll mutations offline.
- Voice is an input/output surface for the same Vecta operations bot. It must not create a second agent with broader authority.
- Recommendations must show evidence, expected impact, uncertainty/risk and exact action scope before approval.
- Push notifications deep-link to the relevant Vecta object and still require server authentication/authorization.

## Current native slice

The initial client contains native sign-in, a mobile operations home, recommendation inbox/detail, biometric approval gate, text assistant UI, push-to-talk microphone capture and local-language text-to-speech. The isolated mobile branch now contains guarded server brokers for recommendation decisions and assistant text/audio. Conversational routes require a server-side OPENAI_API_KEY and fail closed when it is absent. No provider credential is embedded in the mobile binary.

## Local setup

1. Set `EXPO_PUBLIC_VECTOR_API_ORIGIN` to an isolated Vecta mobile staging origin. Never point an unproven development build at production.
2. Run `npm install` from this directory.
3. Run `npx expo install --fix` to enforce the SDK 57 dependency matrix.
4. Run `npm run typecheck`.
5. Use a development/preview native build for Face ID and remote push testing.
6. Never point a development build at production customer data.

## Release path

Development build -> isolated staging -> physical iPhone/Android proof -> Golden Journey and destructive security/recovery gates -> TestFlight -> App Review -> App Store. Android uses the same codebase and follows after the iOS gate.
