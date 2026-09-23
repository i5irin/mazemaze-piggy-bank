# Mazemaze Piggy Bank

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-horizontal-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/lockup-horizontal.png" />
  <img alt="Mazemaze Piggy Bank Logo" src="docs/brand/lockup-horizontal.png" />
</picture>

A Progressive Web App (PWA) designed to manually manage multiple asset accounts and allocate funds to specific "Savings Goals" to track progress.

The adopted Product Architecture uses a **thin stateless API and Managed PostgreSQL** for Canonical data, with app-managed sharing and versioned Export / Import for portability.

**Implementation boundary:** The runnable application still uses the earlier Bring Your Own Storage (BYOS) implementation with Microsoft OneDrive / Google Drive. The setup and deployment instructions below run that implementation; they do not provision the PostgreSQL backend or the new authentication / membership system.

## Documentation

The repository is the canonical workspace for this product.

- [Product Specification](docs/specification.md) — Product / Domain / Storage / Persistence / Sharing / UI / UX / PWA requirements and behavior
- [Brand Specification](docs/brand/README.md) — Naming, colors, icon, logo / wordmark, and lockup rules
- Code and tests — current implementation and executable behavior

The specification describes the intended product behavior and is not used as a task tracker. When implementation and specification differ, review the difference explicitly rather than recording temporary implementation status inside the specification.

## 📖 Overview & Purpose

The product focuses on clarifying "which asset is reserved for what purpose." The overview and architecture below summarize the adopted [Product Specification](docs/specification.md).

- **Asset Allocation**: Manually link assets (Positions such as Cash, Bank Deposits, Investment Funds) to specific Goals (e.g., Travel, Big Purchases) by assigning reserved amounts (Allocations).
- **Market Value Adjustment**: When the market value of an asset (e.g., Investment Trust) is updated, the allocated amounts linked to that asset are **recalculated according to the Position's allocation mode**.
- **Sharing**: Manage shared pool accounts and Goals with partners or family through app-managed Workspace membership. Personal / Shared is a Workspace property; Accounts, Positions, Goals, and Allocations stay within that Workspace.

## ✨ Product Features

- **Mobile First**: A PWA designed for one-handed use, also usable in desktop browsers.
- **Microsoft Fluent UI**: A design system that is both friendly and professional.
- **Offline Viewing**: Browse eligible cached data with its freshness limitations visible; editing requires an online, verified Workspace context.
- **Dark Mode**: System / light / dark appearance preferences.
- **Shared Workspaces**: Multiple Shared Workspaces with `Can edit` and `View-only` access.
- **Data Portability**: Versioned ZIP exports containing JSON / JSONL; Import uses validation, preview, and explicit apply.

## 🛠 Intended Product Architecture

- **Frontend**: Next.js / React / TypeScript, delivered as a PWA.
- **UI Framework**: Fluent UI.
- **API**: A thin stateless API mediates Canonical reads and writes, enforcing current authorization and Domain validation.
- **Canonical Storage**: App-hosted Managed PostgreSQL. Persistence correctness must not depend on a particular hosting provider.
- **Browser Storage**: IndexedDB holds a rebuildable Canonical cache and an Unresolved Operation Journal for input protection and recovery when a save cannot be confirmed. It is not an offline editing queue.
- **Sharing**: App-managed Workspace membership. Authentication technology, identity lifecycle, and invitation mechanics remain Production design decisions.
- **Portability**: Versioned ZIP + JSON / JSONL for current State, History, and associated portable Domain records. Export provides a downloadable backup, not ownership of the live storage service. Full Import replaces the target Workspace dataset.

OneDrive / Google Drive are not Canonical persistence in this architecture. See the [Product Specification](docs/specification.md) for the full persistence, recovery, sharing, and Workspace lifecycle contracts.

## ⚠️ Product Constraints & Scope

1. **Manual Financial Input**: No bank APIs or scraping. Balances and market values are entered manually.
2. **JPY (Integer) Only**: Foreign currencies and investment funds are entered as integer JPY values, converted manually.
3. **Optimistic Concurrency**: Reject stale writes and require explicit review against refreshed Canonical data. No automatic merge, automatic rebase, or CRDT.
4. **Offline Is View-only**: No offline editing or general-purpose mutation synchronization.
5. **Domain History**: Activity supports user-facing History and eligible Undo; Full Event Sourcing is not adopted. Editing presence is not an MVP requirement, and there are no server-side pending drafts.

## Current Implementation / Development Setup

The instructions from here through Deployment describe the **current BYOS application**. It uses MSAL / Microsoft Graph for OneDrive and Google Identity Services / Google Drive API for Google Drive. One provider is active at a time, and sharing uses provider capabilities. These are implementation facts, not the adopted Product Architecture or a choice of authentication for the new backend.

The current code and tests define this executable behavior:

- [Authentication](src/components/AuthProvider.tsx) and [provider selection](src/components/StorageProviderContext.tsx)
- [Storage adapter](src/lib/storage/storageService.ts), [OneDrive implementation](src/lib/onedrive/oneDriveService.ts), and [Google Drive implementation](src/lib/google/googleDriveService.ts)
- [Current persistence code](src/lib/persistence) and [Settings / portability tools](src/app/settings/SettingsClient.tsx)

### Current BYOS Data Storage

The existing application stores snapshots, event chunks, and editing-presence lease files in the selected user's Drive, with an IndexedDB snapshot cache. These files and provider-specific concurrency checks are not the new PostgreSQL commit contract.

- **Snapshot**: JSON containing Accounts, Positions, Goals, and Allocations.
- **Events**: Chunked Domain history with a derived event index.
- **Lease**: Editing-presence records in cloud storage.
- **Shared data**: Owned shared workspaces live under the app root's `shared/` folder; access to other shared workspaces uses provider sharing.

Default app root labels / locations:

- **OneDrive**: `/Apps/Mazemaze Piggy Bank/` (the implementation resolves Microsoft Graph's app root).
- **Google Drive**: `/My Drive/Apps/MazemazePiggyBank/`.

The implementation follows stored folder IDs / pointers, so names alone do not identify existing roots. Deleting an app root removes the cloud data under it; export a backup before deleting non-disposable data. See the development reset procedure below for pointer and cache cleanup.

Current ZIP Import / Export and provider-switch / Move tools operate on this BYOS format. They are not migration tools for the PostgreSQL architecture. Import overwrites data. Move copies the Personal snapshot and event chunks, then deletes the source app root, including owned Shared folders; it does not migrate Shared workspaces. Review destructive confirmations and export backups of affected data before using these tools.

## ✅ Setup

```bash
npm install
```

Create your local env file:

```bash
cp .env.example .env.local
```

## 🔐 Microsoft Sign-in Setup

The current Microsoft setup targets **personal Microsoft accounts** using the consumers authority.

1. Create a Microsoft Entra app registration for personal Microsoft accounts and add the Single-page application (SPA) platform.
2. Add a redirect URI for local development (for example, `http://localhost:3000`) and each deployed environment. Each URI must match that environment's `NEXT_PUBLIC_MSAL_REDIRECT_URI`.
3. Configure delegated Microsoft Graph permissions:
   - `User.Read`
   - `Files.ReadWrite`
4. Update `.env.local` with your values:
   - `NEXT_PUBLIC_MSAL_CLIENT_ID` (required for Microsoft sign-in)
   - `NEXT_PUBLIC_MSAL_REDIRECT_URI` (required for Microsoft sign-in)
   - `NEXT_PUBLIC_MSAL_AUTHORITY` (optional; default: `https://login.microsoftonline.com/consumers`)
   - `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` (optional app root label; default: `/Apps/Mazemaze Piggy Bank/`)

Microsoft sign-in reports a configuration error if the Client ID or Redirect URI is missing. `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` is a display label; OneDrive storage uses the Microsoft Graph app root, so this setting does not relocate it.

### OneDrive Smoke Test

This optional check verifies the OneDrive connection after setup:

1. Start the dev server.
2. Open **Settings**.
3. Sign in with Microsoft, select OneDrive as the active provider, and confirm the status shows your account. Open **Advanced / Diagnostics**, then **Storage checks**.
4. Run **Check app folder**.
5. Run **Write test file** and **Read test file**.

The test file name is `pb-test.json` under the app folder. **Write test file** creates or overwrites it; run **Read test file** afterward and confirm both checks succeed.

## 🔐 Google Sign-in Setup

The current Google setup is intended for **personal Google accounts**.

1. Create or select a Google Cloud project and enable the **Google Drive API**.
2. Configure OAuth branding, audience, and consent settings. If the app is in testing, add the accounts that will test it as test users.
3. Create an OAuth Client ID with application type **Web application**.
4. Add local and deployed origins to **Authorized JavaScript origins**, including `http://localhost:3000` for local development and the dev / production origins you use.
5. Update `.env.local` with your values:
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (required)
   - `NEXT_PUBLIC_GOOGLE_DRIVE_APP_ROOT` (optional; default: `/My Drive/Apps/MazemazePiggyBank/`)

Google sign-in reports a configuration error if the Client ID is missing. The implementation uses Google Identity Services' browser token flow and requests `openid`, profile / email scopes, `drive.file`, and `drive.appdata`. App-data access is used for pointer storage.

See Google's [OAuth setup requirements](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow) for API enablement and authorized origins, and the [Google Identity Services setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) for client configuration.

## ▶️ Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Development / Test Data Reset

During development, incompatible data does not require migration or recovery. Reset disposable workspaces when needed. Use this procedure if incompatible data prevents the application's reset UI from working.

### Before deleting data

- Confirm the cloud account and the actual app folder. Development and production can share cloud data when they use the same account and app registration; different site URLs do not isolate storage.
- Close all app tabs and installed PWA windows on every test device so an old session cannot save data again. Reset only disposable data you own. Deleting a shared workspace also affects its other members.
- Reset the whole app root, including `personal/`, owned workspaces under `shared/`, `events/index.json`, event chunks, leases, and root metadata. Deleting only a snapshot leaves unrelated history and metadata behind. Do not delete the parent `Apps` folder or other applications' data.

### OneDrive

1. Open OneDrive in the browser with the test Microsoft account. Locate the application's folder under `Apps` (the documented default is `Mazemaze Piggy Bank`). The code uses Microsoft Graph's `/me/drive/special/approot`; the actual folder name may differ, especially after renaming or changing the app registration. `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` is only a display label.
2. Confirm the folder contents, then delete that app root. Its `.mpb-pointer.json` is inside the root and is deleted with it. If test roots were manually moved outside it, also remove those identified test roots.
3. Leave unrelated files and the rest of the recycle bin alone. Do not restore the deleted test root during this test. On the next online initialization, the app resolves or creates its app root again.

### Google Drive

1. Open Google Drive in the browser with the test Google account. Locate the actual app root, normally `My Drive/Apps/MazemazePiggyBank` (or the configured Google app root). Confirm its contents and move that root to the trash. A rename alone is not a reset: the app follows folder IDs. Remove any additional disposable test roots with the same name that could be selected during recovery, and any identified test roots moved outside the app root.
2. The pointer `.mpb-pointer.json` is in the hidden `appDataFolder`, **outside** the visible app root. For a full reset, open Drive settings → **Manage apps**, identify this application's OAuth app, and use its hidden-app-data deletion option when available. This clears this app's hidden data, not just one visible workspace. See [Google's hidden app data guidance](https://support.google.com/drive/answer/6374270?hl=en) and [application data folder documentation](https://developers.google.com/workspace/drive/api/guides/appdata).
3. If no hidden-data deletion option is offered, deleting all identified test roots is enough for the current pointer recovery logic: a pointer to a deleted or trashed folder is discarded and rewritten on initialization. If an incompatible future pointer prevents recovery, use an isolated test account/app registration rather than restoring old data. Do not delete unrelated hidden app data or empty the entire trash.

### Clear local state and verify

1. Clear site data for the app's exact origin in the browser (local development, dev deployment, or production as applicable). Include IndexedDB, local/session storage, Cache Storage, and the Service Worker registration. The snapshot database is `mazemaze-piggy-bank`. This also clears local provider/shared-workspace selections and sign-in state. Repeat for each browser/profile or installed PWA used for testing; a hard reload alone is insufficient.
2. Reopen the app online, sign in, select the intended provider, and open Personal. Complete empty-workspace creation if prompted. Confirm there are no old accounts, goals, or history entries. Owned shared workspaces should be gone; workspaces owned by someone else may still appear under `Shared with me` and are not part of this reset.
3. Create a small test account, position, and goal; save an allocation, reload, and check the values and history. If old data reappears, recheck the account, actual root IDs/duplicate folders, and other running sessions. Do not import an incompatible old backup to validate a clean reset.

The reset procedure is manual; no reset is performed by installing dependencies or running tests. The event index is derived from current-format event chunks and may be rebuilt after a failed save or a supported Import / Move; this is not migration of incompatible development data.

## 🔍 Quality Commands

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run check
```

## 🚀 Deployment

The current BYOS application is deployed via **GitHub Actions** using the Vercel CLI. These workflows do not provision the intended PostgreSQL backend or app-managed membership system.
To avoid double-deploys, Vercel's Git integration deployment should be disabled by `vercel.json`.

Both dev and production workflows run `vercel pull --environment=production`, followed by `vercel build --prod`. Configure application variables in each project's **Production** environment, including the dev project. The workflows retrieve those values; a local `.env.local` file does not configure Vercel. Rebuild and deploy after changing application environment variables.

### Dev environment

The dev environment is intended to be **non-public**. Do not share the dev URL outside collaborators.

#### Vercel Project (dev)

1. Create a dedicated Vercel project for dev.
2. Configure Environment Variables in the **Production** environment of the Vercel project (dev) for the providers you intend to use:
   - `NEXT_PUBLIC_MSAL_CLIENT_ID` (required for Microsoft sign-in)
   - `NEXT_PUBLIC_MSAL_REDIRECT_URI` (set to the dev base URL used by the project)
   - `NEXT_PUBLIC_MSAL_AUTHORITY` (optional; default: `https://login.microsoftonline.com/consumers`)
   - `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` (optional app root label; default: `/Apps/Mazemaze Piggy Bank/`)
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (required for Google sign-in)
   - `NEXT_PUBLIC_GOOGLE_DRIVE_APP_ROOT` (optional; default: `/My Drive/Apps/MazemazePiggyBank/`)

> Note: `NEXT_PUBLIC_MSAL_REDIRECT_URI` must be registered on the Microsoft Entra app as a Redirect URI.

> For Google sign-in, register the dev origin in the Google OAuth client's Authorized JavaScript origins.

#### GitHub Actions (dev)

##### Required GitHub Secrets

Set these secrets in the GitHub repository settings:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID_DEV`
- `VERCEL_PROJECT_ID_DEV`

##### Workflows

- **Auto deploy on main**: A push to `main` deploys to the dev Vercel project.
- **Manual deploy**: You can deploy any `ref` (branch/tag/SHA) to dev via `workflow_dispatch`.

### Production environment

Production is deployed to a separate Vercel project and is intended to be publicly accessible.

#### Vercel Project (prod)

1. Create a dedicated Vercel project for production.
2. (Optional) Configure a custom domain for production.
3. Configure Environment Variables in the **Production** environment of the Vercel project (prod) for the providers you intend to use:
   - `NEXT_PUBLIC_MSAL_CLIENT_ID` (required for Microsoft sign-in)
   - `NEXT_PUBLIC_MSAL_REDIRECT_URI` (set to the production base URL used by the project)
   - `NEXT_PUBLIC_MSAL_AUTHORITY` (optional; default: `https://login.microsoftonline.com/consumers`)
   - `NEXT_PUBLIC_ONEDRIVE_APP_ROOT` (optional app root label; default: `/Apps/Mazemaze Piggy Bank/`)
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (required for Google sign-in)
   - `NEXT_PUBLIC_GOOGLE_DRIVE_APP_ROOT` (optional; default: `/My Drive/Apps/MazemazePiggyBank/`)

> Note: You can use the same Entra app registration for dev and prod, but separate registrations are recommended for isolation.
> If you use a single registration, keep Redirect URIs minimal and do not register preview URLs.

> For Google sign-in, register the production origin in the Google OAuth client's Authorized JavaScript origins.

#### GitHub Actions (prod)

##### Required GitHub Secrets

Add these additional secrets for production:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID_PROD`
- `VERCEL_PROJECT_ID_PROD`

`VERCEL_TOKEN` is required for production deployments. Treat it as highly sensitive.

##### Workflows

- **Tag deploy**: A push of a tag matching `v*` (e.g. `v1.2.3`) deploys to production. This workflow has no manual `workflow_dispatch` trigger.

Example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 📌 Project Constraints

- UI text and code comments must be written in English only. Japanese is a future localization target defined in the product specification.
- Offline mode is view-only; editing is disabled.
- No telemetry or analytics are added by default.
