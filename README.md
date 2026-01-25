# Piggy Bank

A Progressive Web App (PWA) designed to manually manage multiple asset accounts and allocate funds to specific "Savings Goals" to track progress.

Instead of using a dedicated backend server, this application adopts a serverless architecture using **Microsoft OneDrive** directly as the database, prioritizing user privacy and data ownership.

## 📖 Overview & Purpose

This app is not just an expense tracker or a simple asset manager; it focuses on clarifying "which asset is reserved for what purpose."

- **Asset Allocation**: Manually link assets (Positions such as Cash, Bank Deposits, Investment Funds) to specific Goals (e.g., Travel, Big Purchases) by assigning reserved amounts (Allocations).
- **Market Value Adjustment**: When the market value of an asset (e.g., Investment Trust) is updated, the allocated amounts linked to that asset are **automatically recalculated proportionally**.
- **Sharing**: Manage a "Shared Pool Account" and "Shared Goals" with partners or family members using OneDrive's sharing capabilities.

## ✨ Features

- **Microsoft Account Only**: No proprietary account registration required.
- **Fully Serverless (Client-to-OneDrive)**: All data is stored in the user's personal OneDrive (default: `/Apps/PiggyBank/`).
- **Mobile First**: UI designed for one-handed operation on smartphones.
- **Microsoft Fluent UI**: Adopts a design system that is both friendly and professional.
- **Offline Viewing**: Browse the latest cached data even without an internet connection (Editing is disabled offline).

## 🛠 Tech Stack

- **Frontend**: Next.js / React / TypeScript
- **UI Framework**: Fluent UI
- **Auth & Storage**: Microsoft Graph API (OneDrive) / MSAL
- **Data Strategy**: Snapshot (Latest State) + Event Sourcing (Logs)

## ⚠️ Constraints & Scope

This app focuses on digitizing "personal manual management" and explicitly excludes the following features:

1.  **No Automatic Sync**: No bank APIs or scraping. All balances and market values are entered manually.
2.  **JPY (Integer) Only**: Foreign currencies and investment funds are handled as integer JPY values (converted manually at input).
3.  **Conflict Resolution (First-in Wins)**:
    - The app does not support simultaneous editing or automatic merging.
    - If a newer version exists on the server when saving (ETag mismatch), the save will fail, and the user must reload the latest data.
4.  **No Real-time Sync**: While a "Lease" file is used to show an "Editing" status to others, strictly real-time locking or synchronization is not implemented.

## 📁 Data Storage

Data is stored in the user's OneDrive in the following structure.
**Note**: Deleting the root folder will reset the application (all data will be lost).

- **Snapshot**: A normalized JSON file holding the current state of Accounts, Positions, Goals, and Allocations.
- **Events**: Chunked log files for auditing and recovery.
- **Lease**: Temporary files used to control the UX for concurrent editing conflicts.
- **Shared data**: Shared folders must live under `/Apps/PiggyBank/shared/` to appear in the Shared list.

---

> **Note**
> While designed as a PWA for mobile use, this application is fully functional on desktop browsers. Recommended browsers: Latest Chrome, Edge, Safari.

## ✅ Setup

```bash
npm install
```

Create your local env file:

```bash
cp .env.example .env.local
```

## 🔐 Microsoft Sign-in Setup

This app supports **Personal Microsoft accounts only**.

1. Create a Microsoft Entra app registration for a single-page application.
2. Add a redirect URI for local development (for example, `http://localhost:3000`).
3. Configure delegated Microsoft Graph permissions:
   - `User.Read`
   - `Files.ReadWrite`
4. Update `.env.local` with your values:
   - `NEXT_PUBLIC_MSAL_CLIENT_ID`
   - `NEXT_PUBLIC_MSAL_REDIRECT_URI`
   - `NEXT_PUBLIC_MSAL_AUTHORITY` (recommended: `https://login.microsoftonline.com/consumers`)
   - `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` (recommended: `/Apps/PiggyBank/`)

### OneDrive Smoke Test

1. Start the dev server.
2. Open **Settings**.
3. Sign in and confirm the status shows your account.
4. Run **Check app folder**.
5. Run **Write test file** and **Read test file**.

The test file name is `pb-test.json` under the app folder.

## ▶️ Development

```bash
npm run dev
```

Open http://localhost:3000.

## 🔍 Quality Commands

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run check
```

## 📌 Project Constraints

- UI text and code comments must be written in English only.
- Microsoft personal accounts only (no work or school accounts).
- Offline mode is view-only; editing is disabled.
- No telemetry or analytics are added by default.
