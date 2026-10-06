# FinanceAI Mobile

Native Expo / React Native client for the existing FinanceAI FastAPI backend.

## Included

- Dashboard with monthly cash flow, savings rate, spending categories, recent transactions, accounts, net worth and expense forecast.
- Transaction search/filter, creation and deletion.
- Financial goals with progress tracking and saved-amount updates.
- Monthly budgets with create/delete.
- Current and 12-month net worth.
- Deterministic monthly reports.
- Financial health score, recurring expenses and unusual-spending detection.
- AI assistant using the server-side FinanceAI context.
- Backend URL configuration saved locally on the device.

## Architecture

    Expo / React Native
            |
            | REST / JSON
            v
    FinanceAI FastAPI
            |
      Services / Repositories / Providers
            |
          SQLite

The mobile app never connects to SQLite directly and contains no AI provider secret.

## Development

From the repository root:

    cd mobile
    npm install
    npx expo install --fix
    npm run typecheck
    npx expo start

Expo recommends aligning Expo package versions with the SDK using npx expo install --fix.

Run the backend so a phone or emulator can reach it:

    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

Set the API URL in the mobile Settings screen:

- Android emulator: http://10.0.2.2:8000
- Physical phone on the same LAN: http://YOUR-PC-LAN-IP:8000
- iOS Simulator: http://127.0.0.1:8000

## EAS builds

Install and authenticate:

    npm install --global eas-cli
    eas login
    eas whoami

Configure the project if needed:

    eas build:configure

Development Android build:

    eas build --platform android --profile development

Internal preview build:

    eas build --platform android --profile preview

Production builds:

    eas build --platform android
    eas build --platform ios

Use the development profile for an installable Android APK. Production Android builds are normally AABs for Play Store distribution.

## Environment

EXPO_PUBLIC_API_URL is public runtime configuration and can be embedded in the app bundle. Never put OMNIROUTE_API_KEY, OPENROUTER_API_KEY, OPENCODE_ZEN_API_KEY, database credentials or other secrets in Expo public variables.

## Public production readiness

Before publishing this client for general public use, the backend needs multi-user authentication/authorization and user-level data isolation. It should also move from a local SQLite deployment to a secure hosted persistence layer, serve the API over HTTPS, implement privacy/account-deletion flows, and use production secret management.

## Branding

mobile/app.json intentionally leaves out final icon/image assets. Add store-quality icon, adaptive icon and splash assets before the production store build.
