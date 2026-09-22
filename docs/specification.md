# Mazemaze Piggy Bank Specification

This document is the Canonical Specification for the Product, Domain, Persistence, Storage, Sharing, UI / UX, and PWA aspects of "まぜまぜ貯金箱 / Mazemaze Piggy Bank."

Specification versions are managed through Git history rather than filenames or manually assigned version numbers.

## Related Canonical Documents

- [Brand Specification](./brand/README.md) — Brand expression, including Naming, Color, Icon, Logo / Wordmark, and Lockup
- [`README.md`](../README.md) — Project overview and entry point for development, Setup, and Deployment
- Code / Test — Current implementation and executable behavior

`docs/brand/README.md` is the Canonical Source for brand details. Where this document mentions brand colors, tone, or similar matters, the Brand Specification takes precedence in a conflict.

This document is not a Task Tracker. It describes the intended product specification rather than listing unimplemented differences or temporary work status as TODOs. Treat differences between specification and implementation as differences to examine during implementation checks and reviews.

---

## Part I. Product / Core Specification

### 0. Assumptions (Required)

- **PWA** (mobile first)
- Use **OneDrive / Google Drive** (selectable) for persistence
- **No proprietary accounts**: Microsoft / Google sign-in (**personal accounts only**; state this explicitly in the UI and guides)
- Data model: **Snapshot (latest state) + Event (event log)**
- Simultaneous editing is not a goal. Conflicts use **first write wins** (a generation mismatch on save causes failure and prompts a reload; **no automatic merge**)
- **Offline is view-only** (disable editing UI)
- **Editing-status display (Lease) is required for the UX**. However, **Lease failures must not affect operation** (display only)

---

### 1. Purpose

Manage multiple accounts and assets (cash / deposits / foreign currency / investment funds, etc.) through **manual input**, and track progress by allocating (reserving) them to multiple savings goals.
Goals may be drawn down. When an asset's market value (valuation) changes, recalculate allocations linked to that asset according to **the setting on each Position (allocationMode)**.
Sharing uses **shared pool accounts + shared goals**.

---

### 2. Scope and Policies

- No account integrations (scraping / APIs). Balances, market values, deposits / withdrawals, and valuation updates are entered manually.
- Persist data in OneDrive / Google Drive (selectable; ordinary user-visible storage areas are acceptable).
- Use OneDrive / Google Drive sharing capabilities (treat a shared folder or shared item as the root).
- Do not write to both providers simultaneously (select and use one provider).
- Conflicts use first write wins (detected through generation information such as ETags). A mismatch causes save failure and prompts a reload. No automatic merge.
- Offline is view-only. Disable editing UI.
- Show editing status through Lease on a best-effort basis (do not block saving).

---

### 3. Technology Stack (Implementation Policy)

- Frontend: **Next.js / React / TypeScript**
- UI: Adopt **Fluent UI**, prioritizing a Microsoft-style tone (trustworthiness + approachability)
- State management / data: At the implementer's discretion (established solutions are acceptable)
- Local cache: IndexedDB or similar (at the implementer's discretion)
- Microsoft Graph authentication: MSAL or similar (at the implementer's discretion; established solutions are acceptable)
- Google authentication: Google Identity Services / OAuth (at the implementer's discretion)

---

### 4. UI/UX Policy (Delegated Design with Mandatory Conditions)

The [Brand Specification](./brand/README.md) is authoritative for visual brand expression, including colors, Icon, Logo / Wordmark, and Lockup.

- **Mobile first** (intended for one-handed use)
- **Dark mode support**
- **Accessibility** (visible focus, sufficient contrast)
- UI details (navigation / wording / layout) are at the implementer's discretion within the constraints of this specification
- Screens (minimum)
  - Dashboard (total assets, goal progress, unallocated amount)
  - Accounts / assets (list → details → edit)
  - Goals (list → details → edit allocations)
  - Settings (Sign-in & storage, connection health, Workspace, Data & portability [Export / Import], reset guidance)

#### 4.x Scope Display and Switching (UI Policy)

- Use **scope switching** (Personal / Shared) for account / asset and goal lists, details, and editing
- Display Shared by selecting a shared root (support multiple shared roots)
- Display non-writable shared data as view-only and disable editing UI
- **Restore the last-used scope / shared root as the initial selection**
- Make dashboard **totals / breakdowns easy to read** (implementation discretion)
  - Examples: Combined totals plus a Personal / Shared breakdown, or switching among combined / Personal / Shared views

#### 4.y UI Guidance (Required Policy)

- As a rule, show a change summary when automatic adjustments occur.
- There are two kinds of guidance to editing:
  1. **Normal allocation editing (10.3)**: A screen for manually adjusting Position → Goal allocation amounts
  2. **Drawdown / repair UI (10.6)**: A dedicated interactive UI where users choose which allocations to reduce to resolve shortfalls, etc. (only when needed)
- For ratio mode, explicitly state that initial ratios are not generated automatically when selecting the mode and in the V_old=0 case (see 10.5 ratio for details).

---

### 5. Terminology

- **Account**: An account (personal / shared)
- **Position**: An asset unit within an account (e.g., an ordinary JPY deposit, USD cash, investment fund A)
- **Goal**: A goal (personal / shared)
- **Allocation**: The amount allocated (reserved) from a Position to a Goal
- **Snapshot**: A file containing the latest state (normalized data)
- **EventChunk**: Event logs (for auditing / recovery); a chunk file grouping multiple events
- **Lease**: A short-term, expiring lease file for editing-status display
- **Unallocated (未割当)**: `Position.marketValue - ΣAllocation(for that Position)` (must not be negative)

---

### 6. Monetary Amounts and Currency

- The app's display currency is **always fixed to JPY (yen)**
- For foreign currency, investment funds, etc., users also enter **integer yen amounts already converted to JPY**
- Handle all amounts as **integers (whole yen)**, without decimals

#### 6.1 Input Validation and Rounding (Required)

- Show a **real-time validation error** for decimal input and prevent submission.
- If such input is nevertheless submitted, **stop processing with an error**.
- Whenever calculations inside the system require rounding, **always round down (floor)**.

---

### 7. Data Model (Logical)

#### 7.1 Account

- `id: string`
- `scope: "personal" | "shared"`
- `name: string`

#### 7.2 Position

- `id: string`
- `accountId: string`
- `assetType: "cash" | "deposit" | "fx" | "securities" | "crypto" | "payout" | "stored" | "other"`
  - Example Japanese / English display names: 現金 (Cash), 預金 (Deposit), 外貨 (FX), 証券 (Securities), 暗号資産 (Crypto), 保険・年金 (Insurance/Pension), 電子マネー・ギフト・ポイント (Stored Value), その他 (Other)
- `label: string` (examples: ordinary deposit, USD, investment fund A)
- `marketValue: number` (integer yen, already converted to JPY, **0 or greater**)
- `allocationMode: "fixed" | "ratio" | "priority"` (default: `"fixed"`)
  - How allocations linked to this Position follow a **valuation update (user input)** (10.5)
- `updatedAt: string(ISO8601)`

#### 7.3 Goal

- `id: string`
- `scope: "personal" | "shared"`
- `name: string`
- `targetAmount: number` (integer yen, **0 or greater**)
- `startDate?: string(YYYY-MM-DD)`
- `endDate?: string(YYYY-MM-DD)`
- `priority: number` (for display order; **a smaller number means higher priority**, with 1 highest, followed by 2, 3, ...)
- `status: "active" | "closed"`
- `closedAt?: string(ISO8601)` (closure time; assigned when `status="closed"`)
- `spentAt?: string(ISO8601)` (spent; as a rule, editing is prohibited when present)

**Notes (Required)**

- A Goal with `spentAt` is called a spent Goal.
- Regardless of `status`, spent Goals are **excluded from automatic distribution** (equivalent to closed).

#### 7.4 Allocation

- `id: string`
- `goalId: string`
- `positionId: string`
- `allocatedAmount: number` (integer yen, **0 or greater**)

**Constraints (Required)**

- **At most one `(positionId, goalId)` pair within the same scope (Allocations are unique)**
- For each `positionId`, `Σ allocatedAmount ≤ Position.marketValue` (exceeding it is prohibited)
- For each `goalId`, `Σ allocatedAmount ≤ Goal.targetAmount` (exceeding it is prohibited)
- **Physically delete** an Allocation when `allocatedAmount = 0` (do not retain zero-yen Allocations)
- `Position.scope` and `Goal.scope` must match (both Personal, or both within the same Shared Root).

---

### 8. Cloud File Design (OneDrive / Google Drive)

#### 8.0 Storage Location (User-Visible)

- App root folder examples:
  - OneDrive: `/Apps/Mazemaze Piggy Bank/`
  - Google Drive: `/My Drive/Apps/MazemazePiggyBank/`
- Structure under app root:
  - `personal/` (Personal workspace root)
  - `shared/` (container for Shared workspaces)
  - `.mpb-root.json` (probe)
- Terminology:
  - `personalRoot = <appRoot>/personal/`
  - `sharedRoot = <shared workspace root>` (a folder under `<appRoot>/shared/`)
- Shared data: Use a shared folder (or shared item) as the root and create the same structure beneath it

> Note: Assume users can edit / delete these files in OneDrive / Google Drive. The app must provide UI warnings (described below).

#### 8.0.1 Pointer (SSoT)

- Use **folderId as the SSoT** for root identification (names are not identifiers)
- Google Drive permits folders with identical names, so do not identify a folder solely by a name match
- Store personal / shared root folderIds in a pointer file (JSON)
  - `schemaVersion`
  - `updatedAt`
  - `personalRootFolderId`
  - `sharedRootFolderId` (only when present)
  - `appRootFolderId` (internal use, optional)
- Storage location:
  - OneDrive: `<appRoot>/.mpb-pointer.json`
  - Google Drive: `appDataFolder/.mpb-pointer.json`
- Normally access folders through the pointer; restrict **name searches to recovery only**
- If the pointed-to folder is **deleted / in the trash**, treat it as invalid and enter recovery
  - Recovery: Search by name (select candidates) → create a new folder if none is found → update the pointer
  - The app root name depends on the provider (OneDrive: `Mazemaze Piggy Bank` / Google Drive: `MazemazePiggyBank`)

#### 8.0.2 Folder Rename Notice

- **Continue updates** even if the pointed-to folder has an unexpected name
- However, **show a notice in Settings** to prevent confusion about backups
  - Applies to: Personal root / Shared root (Shared by me only)
  - Guidance: Recommend `Data & portability > Export`

#### 8.1 Snapshot (Required)

- Example paths:
  - personal: `<personalRoot>/snapshot-personal.json`
  - shared: `<sharedRoot>/snapshot-shared.json`
- Contents:
  - `version: number` (+1 on every update)
  - `stateJson: { accounts, positions, goals, allocations }` (normalized data only)
  - `updatedAt: string(ISO8601)`
- Conflict detection:
  - Retain generation information such as `ETag` and use a matching condition when updating on save

#### 8.2 EventChunk (Required)

- Example paths:
  - personal: `<personalRoot>/events/event-<chunkId>.jsonl`
  - shared: `<sharedRoot>/events/event-<chunkId>.jsonl`
- `chunkId: number` (sequential)
- `fromVersion: number`
- `toVersion: number`
- `eventsJsonl: JSON Lines` (one event per line)
- `createdAt: string(ISO8601)`
- Chunking:
  - Split into N events per chunk (e.g., 500–2000) to avoid oversized files

#### 8.3 Lease (Required / UX Only; Failure Must Not Affect Operation)

- Example paths:
  - personal: `<personalRoot>/leases/lease.json`
  - shared: `<sharedRoot>/leases/lease.json`
- Contents:
  - `holderLabel: string` (display name or anonymous label)
  - `leaseUntil: string(ISO8601)` (e.g., current time + 90 seconds)
  - `updatedAt: string(ISO8601)`
- Behavior:
  - Update on a best-effort basis
  - Saving and editing can continue even on failure (display only)
  - Explicitly state in the UI that editing-status display is best-effort and may fail

#### 8.4 Definition of sharedId (Required)

- sharedId identifies a shared root.
  - OneDrive: A URL-safe string combining `driveId` + `itemId` (e.g., `driveId_itemId`)
  - Google Drive: `fileId` (driveId is supplementary information)
- The shared scope is rooted under a shared folder (or shared item).

#### 8.5 Export / Import (Data & portability)

- Export: Write Snapshot + EventChunk as a **zip**
  - `manifest.json` (schemaVersion / createdAt / scope / provider, etc.)
  - `snapshot.json`
  - `events.jsonl` (optional; only when events exist)
- Import: Accept only exported zip files; **validate format → preview → apply**
  - Reject invalid formats
  - Applying overwrites existing data (state this beforehand)

#### 8.6 Provider Switch (Open / Move)

- Storage providers are selectable; **do not write to both simultaneously**
- Keep the last-selected provider locally and restore it on reload (do not automatically switch to another provider even when signed out)
- Google Drive scopes are `drive.file` + `drive.appdata` (because the pointer is stored in appDataFolder)
- List candidates in the Switch dialog and show their states:
  - `Available` / `Empty` / `Not signed in`
- `Empty`: No root files (such as a snapshot) exist under the personal root
- `Open`: Open existing data
- `Create`: Show only for `Empty` (create an empty workspace)
- `Move`: Copy, then **delete source data** (require double confirmation and backup confirmation)
- Because `Move` **copies Snapshot and EventChunk sequentially**, many events may **increase API requests and make the operation sensitive to elapsed time or rate limits**
  - Show progress in the UI
  - If it fails partway through, **run Move again** (deletion occurs last)
  - If source data has already been deleted, **recover through backup / Import**
- If Google Drive returns a **403 due to insufficient scopes**, stop the affected cloud operation and offer an explicit sign-in action to renew consent. Do not open consent automatically or retry it recursively. An ordinary sharing-permission denial is not evidence of insufficient OAuth scopes.

#### 8.7 Remembered Connections and Reauthentication

- Keep the selected provider separate from a per-provider record of successful connection on this browser. A default or merely selected provider is not evidence of previous use.
- Record a successful explicit sign-in, or a successfully restored Microsoft connection with a usable token. The new preference stores provider flags only, not account names, email addresses, sharing links, or credentials; MSAL continues to manage its own authentication cache.
- On startup, never open an authentication popup automatically. Without a successful-connection record, show the normal storage choices rather than a reauthentication reminder.
- When online, offer a non-modal reminder only for the current workspace's provider if it was previously connected and now needs sign-in. Do not prompt for the other provider or automatically switch storage. Existing manual sign-in choices remain available.
- Preserve Microsoft's silent token acquisition and renewal. If user interaction is required, stop the affected cloud operation and wait for an explicit sign-in action; do not automatically fall back to a popup. A transient network failure alone must not be treated as a demand for reauthentication.
- Google token acquisition starts only from an explicit sign-in action. Page reload and token expiry may require another action; `prompt: none` is not a popup-free renewal mechanism. Do not add persistent Google token storage for this preference.
- Open authentication or renewed-consent popups only after the user activates a sign-in button. Handle popup blocking, cancellation, and authentication errors without leaving the UI indefinitely busy; allow retry and prevent simultaneous interactive requests for the same provider.
- Successful explicit sign-out clears that provider's reminder eligibility while preserving the selected storage provider. Do not immediately ask the user to reconnect. A later successful sign-in enables reminders again.
- While offline, hide reauthentication reminders and retain the existing view-only behavior. If local preferences are unavailable or invalid, sign-in must remain usable, but remembering the connection across reloads is not guaranteed.
- Legacy provider selection alone is not migrated into a successful-connection record. Connection records are local to this browser and do not grant access to cloud data.

---

### 9. Initialization (Data Reset)

- **Deleting the root folder = initialization (clean state)**
- Explicitly state in the app's UI guidance:
  - These folders / files are used by the app (editing is discouraged)
  - They may be copied for backup purposes
  - Leave them untouched if unsure
  - Deleting the root folder removes all data and returns the app to its initial state

---

### 10. Operation Specification

#### 10.1 Accounts and Assets

- Create Account (personal / shared)
- Create Position (assetType / label / marketValue)
- Update Position valuation: Overwrite `marketValue` with the new value (allocation recalculation follows 10.5)
- Change Position.allocationMode (fixed / ratio / priority):
  - **Changing the mode alone does not redistribute existing Allocations (retain them)**
  - If `marketValue` is updated at the same time, use **the new mode** for recalculation associated with that valuation update (10.5)

##### 10.1.1 Types of marketValue Updates (Required / Prevent Incorrect Implementation)

Classify `marketValue` changes into two types.

- **Valuation update (user input)**
  - An operation where the user enters an account balance or valuation to update it.
  - **Apply automatic recalculation in 10.5** (according to allocationMode).
- **Internal adjustment (inside the app)**
  - Updates associated with internal processing such as spending (10.4.1), Undo (10.4.1), and consistency repair (13.5 / 13.3).
  - **Do not apply automatic recalculation in 10.5** (ensure consistency within the corresponding procedure).
  - Do not call 10.5 indiscriminately from a marketValue setter or similar implementation.

#### 10.2 Goals

- Create Goal (name / targetAmount / period / priority)
- Close Goal: `status = "closed"` (logical state only; do not physically delete)
  - Assign `closedAt` on closure
  - Closed Goals remain visible, and **Allocation editing remains possible**
  - Exclude closed Goals from **priority ordering** (only active Goals form that ordering)
  - On reopening (closed → active), assign **the last priority among active Goals** (e.g., current maximum priority + 1)
    - `closedAt` may be removed on reopening (retaining it as history is at implementation discretion, but reduction order must remain deterministic)
- Goal deletion follows 11.4

#### 10.3 Allocations (Reservations)

- Set `allocatedAmount` from Position → Goal (add / update / delete)
  - Because **(positionId, goalId) is unique**, treat allocations as **upserts (update if present; create otherwise)**
  - Treat `allocatedAmount = 0` as **Allocation deletion**
- Changes must satisfy the constraints (`Position: total allocations ≤ marketValue`, `Goal: total allocations ≤ targetAmount`)

#### 10.4 Drawdown (Manual)

- For an operation to draw down X yen from a Goal, the user specifies the source Allocations to reduce (multiple selections allowed)
- Reduce those Allocations (not below 0)
- Do not automatically reduce Position.marketValue (the user reflects the actual balance separately through a valuation update)
- Allocation reductions through drawdown are independent of the automatic recalculation trigger in 10.5 (drawdown must not affect other Goals).

#### 10.4.1 Achievement → Withdrawal (Mark as Spent) (Required)

Provide an operation to mark a Goal as spent, reflecting actual use of the funds after achieving it.

- Applies primarily to closed Goals (allowing active Goals is at implementation discretion; closed only is recommended for the MVP)
- Spending amount `X`: Total Allocations linked to this Goal

**Procedure (Required)**

1. The user **selects multiple Positions and specifies amounts** to pay `X` (the UI ensures the total equals `X`)
2. Reduce each specified Position's `marketValue` (total reduction: `X`)
3. **Delete all Allocations** linked to this Goal
4. Assign `spentAt` to the Goal (ISO8601)
5. If consistency is affected (such as a Position shortfall), automatically adjust / provide guidance according to 10.6

**Atomicity and Bypassing 10.5 (Required)**

- Process step 2 (marketValue reduction) and step 3 (deleting all Allocations) **atomically**.
- These are **internal adjustments** and **must not trigger automatic recalculation in 10.5** (do not affect Goals other than the spending target).

**Editing Restrictions for Spent Goals (Required)**

- As a rule, Goals with `spentAt` **cannot be edited** (including goal information and allocations)
- However, provide **Undo** on the Goal detail screen:
  - Undo is available **only for the most recent operation** and **within 24 hours**
  - Undo reverses spending, restoring reduced Position values and deleted Allocations
  - Explicitly state the "most recent only / within 24 hours" restriction in the UI

**Undo and Bypassing 10.5 (Required)**

- Treat restoration of marketValue / Allocation through Undo as an **internal adjustment**; **do not trigger automatic recalculation in 10.5**.
- After Undo, perform consistency checks equivalent to 13.3; if problems exist, show a summary / guidance according to 10.6.

**Potential Constraint Violations after Undo (Required / Developer Note)**

- Undo prioritizes reversing the spending operation's changes to restore the preceding state, so **temporary constraint violations may occur after Undo** if any of the following occurred during the period covered by Undo:
  - `marketValue` changes through valuation updates (10.5)
  - Limit changes through Goal.targetAmount updates (10.4.2)
  - Other allocation edits (10.3), etc.
- Possible violations:
  - `Σ Allocation(position) > Position.marketValue` (Position over-allocation)
  - `Σ Allocation(goal) > Goal.targetAmount` (Goal over-allocation)
- In this case, follow **10.6**: automatic repair + summary (or guidance to the drawdown / repair UI).

#### 10.4.2 Allocation Adjustments When Updating Goal.targetAmount (Required)

When Goal.targetAmount changes from `T_old → T_new`, resolve any excess if the total Allocations linked to that Goal exceed `T_new`.

- **Default behavior (required): Immediate automatic proportional reduction**
  - Shrink Allocations linked to the Goal (across multiple Positions) while preserving their current distribution ratios.
  - Handle remainders and tie-breaking deterministically (e.g., allocatedAmount descending → positionId ascending).
  - After adjustment, show a **change summary** (which Position changed by how many yen) and provide a route to normal allocation editing (10.3).
- Do not provide additional reduction options (such as priority-based reduction); limit this to proportional reduction plus manual editing when needed.

#### 10.5 Allocation Recalculation on Balance Updates (Required)

##### 10.5.0 Applicability (Required)

- Apply 10.5 when `marketValue` changes through a **valuation update (user input)** (10.1.1).
- Exclude **internal adjustments** such as spending / Undo / repair from the triggers for 10.5.

##### 10.5.1 Overview

When Position.marketValue changes from `V_old → V_new`, recalculate Allocations linked to that Position according to `Position.allocationMode`.
(Note: Changing allocationMode alone does not recalculate. Recalculation occurs on marketValue updates or during repair.)

After recalculation, always satisfy:

- `Σ Allocation(for that Position) ≤ V_new`
- `Σ Allocation(for each Goal) ≤ Goal.targetAmount`

Supporting definitions:

- Unallocated: `unallocated = V_new - ΣAllocation(for that Position)` (nonnegative)
- Remaining goal capacity (accounting for Positions other than the one being updated):
  `remaining(goal) = max(0, Goal.targetAmount - ΣAllocation(with the same goalId where positionId != this Position))`

**Common Rules (Required)**

- All tie-breaking must be deterministic.
- Tie-breaking in calculation, distribution, and reduction **must not depend on allocationId**.
- Recommended tie-breaking examples:
  - Goals: `priority(ascending; active only)` → `goalId(ascending)`
  - Positions: `positionId(ascending)`
  - Unallocated comes last among ties
- Use `remaining(goal)` to make **only active Goals** eligible for automatic distribution.
  - **Do not increase** closed or spent Goals through automatic distribution (effectively a receiving capacity of 0).
- **As a rule, retain existing Allocations for closed / spent Goals** (do not automatically zero them).
  - However, when resolving `ΣAllocation(for that Position) > V_new`, include closed / spent Goals in reductions only if a shortfall remains after all active allocations have been reduced to 0 (shortfall resolution rule).

##### 10.5.2 Shortfall Resolution (All Modes / Required)

If `ΣAllocation(for that Position) > V_new`, reduce allocations until the excess is eliminated (not below 0).

- Reduction order (deterministic):
  1. **Lowest-priority active Goals first** (priority descending), with goalId ascending for ties
  2. Include **closed / spent Goals** only if excess remains after all active allocations reach 0
     - Reduction order: Newest `closedAt` first (descending) → `goalId` ascending
       (If `closedAt` is absent, use a deterministic rule such as `goalId` ascending)

##### fixed (Default)

- Principle: Do not change Allocations.
- Reduce only when a shortfall exists (10.5.2).
- If the data violates Goal limits, repair through 13.5 / 13.3 by shrinking, never increasing.

##### ratio

**Overview (Required)**

- ratio **scales the existing distribution ratios within the Position, including unallocated funds**, while preserving those ratios.
- **Do not automatically generate initial ratios**. Ratios are defined by the Allocations created through user allocation editing (10.3) and the unallocated amount.
- The UI must explicitly state:
  - "ratio preserves existing ratios. First create allocations (or leave funds unallocated) to define the ratios."
  - "When the balance increases from 0, allocations do not increase automatically because no ratio exists. Add allocations through allocation editing if needed."

**When `V_old > 0`**

- Original unallocated amount: `U_old = V_old - ΣA_old`
- Treat Allocations and unallocated funds as the same kind of distribution recipient, and first calculate:
  - `A_new = floor(A_old * V_new / V_old)`
  - `U_new = floor(U_old * V_new / V_old)`
- If a remainder `R = V_new - (ΣA_new + U_new)` exists, distribute it one yen at a time in **descending order of original amounts (A_old, U_old)**
  - Deterministic tie-breaking: For active Goals, `priority(ascending)` → `goalId(ascending)`; unallocated comes last among ties

**When `V_old = 0`**

- Principle: Do not perform proportional recalculation that increases allocations (retain existing allocations).
- If constraint violations exist, shrink (repair) until consistency is satisfied (repair by reducing, never increasing).

**Applying Goal Limits (Simplified / Required)**

- For active Goals, if `A_new(goal) > remaining(goal)`, clamp to `A_new(goal) = remaining(goal)`.
- Return **all amounts removed by clamping to unallocated funds** (do not automatically redistribute them to other Goals).

**Shortfall Resolution**

- Finally, apply shortfall resolution in 10.5.2 (only if needed).

##### priority

- Purpose: Allocate according to active Goal priority in response to increases / decreases caused by marketValue updates.
- This mode also **retains existing Allocations as a rule** (do not suddenly redistribute when switching modes or updating).
- Consider `Δ = V_new - V_old`:
  - If `Δ > 0` (increase):
    - Allocate the increase `Δ` sequentially by traversing active Goals in `priority(ascending)` order, within each Goal's receiving capacity `remaining(goal)`.
    - Leave any remainder unallocated.
  - If `Δ < 0` (decrease):
    - If the decrease creates a shortfall, reduce allocations through 10.5.2 (shortfall resolution).
- Do not automatically increase allocations to closed / spent Goals.

#### 10.6 Hybrid Policy: Automatic Adjustment and Guidance to the Drawdown UI (Required)

When allocations must shrink because of balance updates (10.5), consistency repair, etc., default to automatic adjustment + summary, but guide the user to the drawdown / repair UI under certain conditions.

**Default Behavior (Required)**

- Automatic adjustment (reduction) → change summary → **route to normal allocation editing (10.3)**

**Immediately guide the user to the drawdown / repair UI if any of the following applies (required)**

1. **An Allocation for a closed or spent Goal must be reduced by even 1 yen**
2. The number of affected Goals **exceeds N**
3. The shortfall / repair amount **exceeds x% of V_new**

- Exact values of `N` and `x` are at implementation discretion (may change during the MVP).

**Explicitly State That Reductions Are Not Restored (Required)**

- Allocations reduced or deleted for closed / spent Goals **are not automatically restored** by later balance increases or Position additions.
- In the drawdown / repair UI, explicitly state that restoration requires manually re-adding them through normal allocation editing (10.3).

**Default Proposal in the Drawdown / Repair UI (Required)**

- Show the deterministic calculation result from 10.5.2 (shortfall resolution) as the initial **default proposal (suggested values)**.
- Users can edit, confirm, and apply the suggested values (confirming them unchanged is also allowed).
- The UI may briefly explain which rules produced the proposal (e.g., lower-priority active Goals → newest closedAt first), at implementation discretion.
- If user edits to suggested values leave constraint violations, detect them before saving and prompt further editing.
  (The app must not automatically shift allocations to another Goal to resolve these violations.)

**Context-Specific Wording (Required)**

- Use different guidance wording when navigating from a change summary to normal allocation editing (10.3) and when navigating directly to the drawdown / repair UI because a threshold was exceeded.

---

### 11. Deletion Policy (Required for Consistency)

#### 11.1 Position Deletion

- Show **two stages of warning dialogs**
- **Delete all Allocations** linked to the Position when deleting it
  - Interpretation: That asset can no longer be treated as savings

#### 11.2 Account Deletion

- Show **two stages of warning dialogs**
- **Delete all Positions** under the Account
- **Delete all Allocations** linked to those Positions

#### 11.3 Allocation Deletion (Physical Deletion)

- **Support physical deletion** of Allocations (not logical deletion)
- The UI may present this as releasing (deleting) an allocation
- Deletion must not automatically change Position.marketValue

#### 11.4 Goal Deletion (Physical Deletion)

- **Support physical deletion** separately from closing through `status=closed`
- On physical deletion:
  - **Delete all Allocations** linked to the Goal (preserve consistency)
- Recommended UI:
  - Normally make Close the primary, safer action
  - Place Delete in Settings or a menu to reduce accidental use (implementation discretion)

---

### 12. Sharing (Shared Pool Accounts + Shared Goals)

- The unit of sharing is Snapshot + Events + Lease under a shared root (shared folder / shared item)
- Join through OneDrive / Google Drive sharing (sharing links / joining a share)
- Within shared, allow creation and updates of shared-scope Account / Position / Goal / Allocation
- Delegate permissions to each provider's sharing system (owner / member-level treatment is sufficient for the MVP)
- **Permission Differences (Required)**
  - **Display shares without write permission as view-only and disable editing UI**
- **Listing on the Sharing User's Side (Required)**
- Limit shared listings to items under `<appRoot>/shared/`
- Shared roots must be immediate child folders of `<appRoot>/shared/`
  - Display two sections: "Shared with me" and "Shared by me"
  - "Shared by me" shows only folders whose permissions include `read` / `write`
- Sharing may be **included within Settings** as sharing settings (joining, listings, permission display, links to providers, etc.)

---

### 13. Synchronization and Conflicts (First Write Wins)

#### 13.1 Startup / Resume

- Fetch Snapshot and cache it locally (IndexedDB, etc.), retaining ETags and similar metadata
- Offline: View the cached Snapshot only (disable editing UI)

#### 13.2 Editing

- Editing is online-only (disable input offline, or provide a route to retry the operation after reconnecting)
- Update Lease as best-effort editing-status display (editing can continue if it fails)

#### 13.3 Saving (Required)

1. Retain generation information (ETag, etc.) from Snapshot retrieval
2. Apply changes locally to generate new `stateJson` (also generate / append EventChunk)
3. Immediately before saving, perform **pre-save consistency checks / repair** (equivalent to 13.5; shrink only, never increase)
4. Update Snapshot conditional on matching generation information (a mismatch fails the save)

#### 13.4 Save Failure (Required)

- Fetch the latest Snapshot again
- **Discard** local edits
- Notify the user, for example: "Could not save because the data was updated elsewhere. The latest data has been reloaded."

#### 13.5 Consistency Checks on Load (Required)

When loading a Snapshot, validate:

- Uniqueness of `(positionId, goalId)`
- `Σ Allocation(position) ≤ marketValue`
- `Σ Allocation(goal) ≤ targetAmount`
- Broken references (Allocations pointing to nonexistent positionId / goalId)
- **No Allocations for spent Goals (with spentAt)**
- `marketValue >= 0`, `targetAmount >= 0`, `allocatedAmount >= 0`

**Response (Required)**

- Delete Allocations with broken references and show a warning.
- Delete any Allocations linked to spent Goals and show a warning.
- Correct negative amounts to 0 and show a warning (or prevent saving and provide guidance; implementation discretion, but behavior must be deterministic).
- For constraint violations, default to **automatic repair (shrink, never increase) + summary + route to normal allocation editing (10.3)**.
- If the conditions in 10.6 apply (closed / spent reductions, number affected, proportion), **guide the user to the drawdown / repair UI**.

---

### 14. Quotas / Abuse Prevention (Design Policy)

- Back off and retry on OneDrive / Google Drive API throttling such as 429, and inform the user
- Impose app-side limits (indicative examples):
  - Maximum 100 Goals
  - Maximum 200 Positions
  - Maximum 1000 events per day
- Chunk Events and minimize Snapshots to avoid oversized files

---

### 15. Outside MVP Scope (Unsupported)

- Real-time collaborative editing and automatic conflict merging
- Sharing personal assets with others (sharing outside shared scope)
- Automatic exchange-rate or asset-price retrieval (conversion is manual)
- Strict accounting journal entries (complete separation of deposits / gains and losses / withdrawals)
- Anonymous editing without sign-in

---

### 16. Explicitly Delegated Implementation Decisions

- UI / navigation / wording / layout details
- Local caching approach (IndexedDB, state management library, synchronization timing)
- Internal Event format (provided event types and their meaning remain traceable)
- UX for joining a share (pasting a sharing link, selecting from a shared list, etc.)
- Graph API call design, retry, and error-display optimization
- Exact values of thresholds `N` and `x` in 10.6 (may change during the MVP)
- Handling `closedAt` on Goal reopening (remove / retain). However, **reduction order must be deterministic**.

**Priorities When Unsure**

1. Least privilege and privacy
2. Avoid data loss (however, this specification's requirement to discard local edits on save failure takes precedence)
3. Reduce the number of actions (mobile UX)

---

## Part II. UI / UX / PWA Specification

Also refer to the [Brand Specification](./brand/README.md) for UI visual expression, Brand Color, Icon, Wordmark, and Lockup.

This document brings together UI specifications centered on the Dashboard / Home screen and implementation policies covering the PWA (installation, icons, manifest, and language detection).

---

### Assumptions (Language / i18n Policy)

- Proceed with **English only (the default language)** at the current implementation stage.
- Future multilingual support will **add Japanese (ja) only**.
- When Japanese is added, determine the locale on first access using `Accept-Language` or similar information, and also allow users to switch the **app language option (Japanese / all others = English)**.
- Do not separate URLs by language (use the same URLs). Do not pin the language through query parameters either.

---

## PWA / Multilingual Specification (Including Future Support)

### 1. Basic PWA Policy

- Assume `display: standalone` and prioritize an app-like experience on mobile.
- Because the appearance at installation (Add to Home Screen), including icon and name, depends strongly on **the manifest at installation time**, accept that the home-screen app name may not follow in-app language changes (prioritize switching the in-app UI).

### 2. Icon Policy (Use any Only)

Refer to the [Brand Specification](./brand/README.md) for icon shape, color, mask tolerance, and other brand requirements. This section defines usage policy in the PWA manifest.

- Use icons with **`purpose: "any"` only** (do not provide separate `purpose: "maskable"` icons).
- Reasons:
  - The current icon **already meets safe-margin and composition requirements** for masks on Android and similar platforms (rounded corners, circles, etc.), effectively using a maskable-equivalent design.
  - Additional `-maskable` files increase asset management, export, and diff-management costs.
- Expected behavior:
  - Even when the OS / launcher applies its own mask, key elements (pig silhouette, eye, tail, and dot centers) remain intact and recognizable.
- Notes:
  - Audits such as Lighthouse may warn that no maskable icon exists, but **this app accepts that warning** and does not require adding `purpose: "maskable"`.
  - If the warning becomes a quality-gate issue, consider reusing the existing image with `purpose: "any maskable"` on the same file as a second option (one image serving both purposes).
- Do not introduce `purpose: "monochrome"` (for monochrome themed icons) now because **its benefit relative to cost is uncertain**; consider it separately if needed.

#### Recommended Files

- `public/icons/icon-192.png` / `icon-512.png` (any)
- `public/favicon.ico` (transparency allowed)
- `public/icons/icon-180.png` (Apple Touch Icon / iOS)
- `public/icons/icon-32.png` (optional: add if needed for browser UI / tab compatibility)

### 3. Manifest Usage (Current and Future)

#### Current (English Only)

- Provide only `public/manifest.webmanifest`.
- `<link rel="manifest">` always points to `/manifest.webmanifest`.

#### Future (Adding Japanese)

- Keep English as the default without renaming its file.
  - English (default): `/manifest.webmanifest`
  - Japanese: `/manifest-ja.webmanifest`
- Keep the same URLs and **switch `<link rel="manifest">` based on a cookie**.
- Since `start_url` / `scope` are not separated by language, normally use `/` for both (prioritize consistency with unified URLs).

### 4. Language Selection Logic (Future: When Japanese Is Added)

#### Priority

1. **Persistent user choice**: `lang` cookie (required) + localStorage (optional but recommended)
2. Initial detection: `Accept-Language` (to the extent accessible on server / client)
3. Default: `en`

#### Behavior

- On first access without a cookie, use `Accept-Language` to set the `lang` cookie; thereafter, prioritize the cookie.
- When the user switches language in the UI, overwrite the cookie; that language then takes highest priority.
- The language at PWA installation is consequently selected through **the current `<link rel="manifest">` (based on the cookie)**.

#### Cookie Specification

- key: `lang`
- value: `en` / `ja`
- path: `/`
- Expiration: Approximately one year (renewable)
- SameSite: `Lax`

### 5. Language-Switching UI (Future: When Japanese Is Added)

- Place language switching in Settings (while English-only, hide it or disable it with "Coming later").
- On switching:
  - Update the `lang` cookie
  - Save the same value in localStorage if used
  - **Reload** after switching to ensure `<link rel="manifest">` and the SSR display language match

---

## Mazemaze Piggy Bank: Shared Notification and Status Display Specification

This chapter defines notifications (success / caution / error) shared across all screens, and status displays for saving, synchronization, offline operation, and similar states.

### 1. Notification UI Types (Consistent)

- **Toast (brief display)**
  - Purpose: Lightweight feedback (save completion, minor adjustment notifications, state changes).
  - Position: Bottom center (prioritize a consistent appearance on desktop / mobile).
  - Auto-dismiss: A few seconds; slightly longer is acceptable when an action is included.
  - Actions: At most one (e.g., `Review` / `Retry`).
- **Dialog (blocking)**
  - Purpose: Significant events requiring user action (changes lost after save failure, conflicts, insufficient permissions, etc.).
  - Principle: Present a short summary + next action (`Reload` / `Try again` / `Open Settings`).
- **Inline display (within the screen)**
  - Purpose: Problems to correct in place, such as input errors and constraint violations in an editor.
  - Examples: Error text below a field, explanations of disabled states.

Note: Do not adopt persistent MessageBar-style banners in the MVP.

### 2. Synchronization Status Signal (Shared)

- Always show the overall screen synchronization status in the following locations:
  - **Desktop: Bottom of the left sidebar**
  - **Mobile: Right end of the header**
- Standardize on **a circular dot + short English wording**.
  - Change only the dot color, not the text color.
  - Do not add icons.
- Clicking the status area navigates to `Settings > Connection health` (`/settings#connection-health`).

#### Example Display Values

- Online (green dot / `Online`)
- Saving… (yellow dot / `Saving…`)
- Sign-in required (yellow dot / `Sign-in required`)
- Retry needed (red dot / `Retry needed`)
- Offline (red dot / `Offline`)
- View-only (yellow dot / `View-only`)
- Show `Retry needed` only when partial failure leaves items in the retry queue.

#### Dot Colors (R/Y/G)

- Green: Online
- Yellow: Saving… / View-only / Sign-in required
- Red: Offline / Retry needed

### 3. Offline and View-Only Handling

- When offline or when a share is View-only:
  - Disable editing UI (inputs / buttons).
  - Briefly explain why editing is unavailable in an accessible location (consolidate details in Settings; short supplementary text may appear near primary editing controls).
- On transition to offline, **notify the state change once through a Toast**.
  - Example: `Offline: changes won’t be saved.` (optional action: `Open Settings`)
- While offline, avoid a persistent banner; prioritize communicating the state through the status area (desktop sidebar / mobile header signal).

### 4. Save Failure and Conflict Experience

- Use a **Dialog** for save failures that may lose changes (conflicts, insufficient permissions, etc.).
  - Contents: What happened (one line) + potentially lost scope (short summary) + next action (`Reload` recommended; `Open Settings` if needed).
- A Toast with `Retry` is acceptable for temporary, retryable failures (but prioritize a Dialog for lost-change situations).
- Explicitly treat **partial failure (Snapshot saved successfully / History event save failed)** as failure.
  - Notification wording must include partial failure and the requirement to retry.
  - Keep the retry queue **only within the session** (no need to carry it across reloads).
  - Explain in the UI that history may remain incomplete until retry finishes.
- Do not automatically merge conflicts. Make reloading the latest data the primary user action.

---

## Mazemaze Piggy Bank: Autosave Specification (UI Requirements)

### 1. Policy

- As a rule, editing operations **autosave per operation** (do not require an explicit "Save snapshot").
- Present status (Online / Saving… / Sign-in required / Retry needed / Offline / View-only) according to the shared specification so users know when saving occurs.

### 2. Save Triggers (UI Perspective)

- Goal:
  - Create / update / close / reopen a Goal
  - Change Goal priority
  - Increase / decrease allocations (Allocation changes confirmed through absolute-value input)
  - Execute "Remove all allocations" (explicit action)
  - Confirm Spend (`Mark as spent...`)
  - Confirm Undo spend
- Position:
  - Create / update / delete a Position
  - Update valuation (when inline editing is confirmed through Enter / Save, etc.)
  - Change Recalc Mode
- Account:
  - Create / update / delete an Account
- Sharing settings:
  - Switch scope or shared folder (only where necessary, according to state-persistence policy)

Note: Do not continuously save while typing (save per confirmed operation).
For example, save a Goals Allocation input when confirmed through Enter / Blur.

### 3. UI Feedback

- Save starts: Briefly transition the status to `Saving…`
- Save succeeds: Return status to `Online`; allow the applied time to be checked through `Last sync`.
  - Success Toasts may be suppressed for frequent operations to avoid noise.
- Save fails:
  - Changes may be lost: Dialog
  - Temporary, retryable failure: Toast (Retry) + status area set to `Retry needed`

---

## Mazemaze Piggy Bank: History / Activity Specification (UI Requirements)

This chapter defines the UI for reviewing what happened and when for Goals and assets.

### 1. Purpose

- Allow per-Goal history such as allocation additions and drawdowns (allocation reductions / releases).
- Allow per-Position history such as valuation updates and allocation increases / decreases (including the affected Goals).
- Satisfy the requirement to discover changes later through the History UI; a persistent warning flag equivalent to reductionNotice is not mandatory in the UI specification.

### 2. Information Detail (UI Display)

- Recommended fields for each Activity item:
  - Timestamp (local display)
  - Event type (e.g., Allocated, Deallocated, Value updated, Goal closed/opened)
  - Origin (`User` / `System` badge)
  - Target (Goal name / Position name / Account name)
  - Amount delta (+/- amount, preferably a difference display)
  - Summary (one short line)
  - Details (expand when needed: related IDs, before / after values, notes, etc.)
- Default to newest first.
- Explicitly identify the display source in the History view (e.g., `Source: cloud event log.`),
  and show explanatory status text during loading / failure as well.
- Standardize Recent activity templates in English, for example:
  - `Account created: <name>`
  - `Position added: <position> -> <account>`
  - `Value updated: <position> -> ¥<value>`

### 3. Entry Points

- Goal details: Through the `History` tab (show recent history within the tab on desktop)
- Position details: Through a `History` tab / button / section
- Settings (optional): May provide an entry point to app-wide Activity (Recent); not required for the MVP
- Dashboard / Home: Show only `Last 5` under `Recent activity`, without `View all` (full history is available through each `History` view).

### 4. Display Method (Desktop / Mobile)

- Desktop:
  - For Goals, display within the right detail pane's `History` tab (an in-tab list).
  - Keep the right detail header + tabs sticky; scroll only the history list's body area.
- Mobile:
  - Use a full-screen sheet / overlay (list → detail navigation uses the same container).

### 5. Performance

- Do not load all history at once.
- Initially show the most recent N items (e.g., 20–50), then fetch more through `Load more` (explicit pagination).
- When switching to another entity's history, clear the previous entity's history and
  show a loading state to prevent confusion.
- Consider filtering / searching in the future (may be omitted from the MVP).

---

## Mazemaze Piggy Bank: Automatic Adjustment (Minor / Major) Notifications and Navigation (UI Requirements)

This chapter defines the UI when allocations are automatically adjusted because of balance changes or similar events.

### 1. Terminology

- **Minor**: Below the core specification thresholds (10.6), without requiring an immediate user decision about repair.
- **Major**: Meets the core specification thresholds (10.6), requiring a user decision (repair / drawdown).

### 2. Minor Adjustments (Below Threshold)

- Show a **Toast** when automatic adjustment occurs.
  - Icon: ⚠️ (caution)
  - Wording: Short summary (e.g., `Allocations adjusted automatically.`)
  - Action: `Review`
- `Review` opens a **change Summary**.
  - Desktop: Modal or drawer (a consistent container across the app)
  - Mobile: Full-screen sheet / overlay
- Summary contents:
  - What changed (affected Goals / Positions, summary of differences)
  - A tone that communicates action is not immediately mandatory
- Two actions from the summary:
  1. **OK/Close** (acknowledge and close)
  2. **Open repair** (navigate to the drawdown / repair UI)
- Show Summary / Repair **only when the event occurs**; do not provide a persistent entry point to reopen it later.
- Support later discovery through History / Activity.

### 3. Major Adjustments (At or Above Threshold)

- When an automatic adjustment is major, **go directly to the drawdown / repair UI** because a user decision is required.
  - Even on direct navigation, place a brief explanation (what happened / why the user is here) at the top.
- A Toast before navigation is optional (it can be noisy, so direct navigation alone is acceptable initially).

---

## Mazemaze Piggy Bank: Dashboard / Home Screen Specification

### 1. Design Principles & Theme

- **Concept**: Warm Precision (warmth combined with precision). Build on trustworthy Fluent UI and add approachability through butter-colored accents.
- **Color palette (brand-compliant / fixed)**:
  - Butter yellow (Accent / Base): `#F6E58D` (use only this yellow in the UI)
  - White (Base): `#F5F5F2`
  - Soft gray (Base): `#626258`
- **Color usage rules (required)**:
  - Do not use Butter yellow for body text (preserve readability and avoid a cheap appearance).
  - Prioritize Butter yellow as **filled areas**; do not rely on thin lines / small areas alone (supplement with shadow / borders / area when needed).
  - Add emphasis through **shape (size / spacing / shadow / thickness)** rather than more colors (MVP policy).
- **Typography**:
  - Use fonts with a monospaced feel (Inter / Segoe UI Variable) for amounts and numbers, prioritizing digit alignment.
- **Wording (current)**:
  - Implement on-screen text in English only.
  - Add i18n when Japanese (ja) is introduced in the future (switchable in Settings).

### 2. Shared Components & Logic

- **Global Progress**:
  - Formula: `(total allocations across all Goals / total target amounts across all Goals) * 100`
  - Display: A thick Butter yellow bar (fill) in the header.
- **Lease Banner**:
  - When another device is editing (holding a Lease), show a thin Butter yellow strip at the very top with English wording such as "Someone is editing...".
- **Scope switching**:
  - Switch between `Personal` / `Shared`. When Shared is selected, show a dropdown directly below for the shared context name (family, team, etc.).
  - When Personal is selected, disable the shared workspace dropdown and
    show `Switch to Shared to choose a workspace` to prevent mistakes (do not show the selected value).
  - When Shared is selected, append access status to the selected workspace name (e.g., `Family budget (Editable)` / `Family budget (Read-only)`).
  - Do not show duplicate shared metadata (Shared space / Shared ID) at the top of Shared screens.
- **Currency display**:
  - Internal currency is fixed to JPY (converted to yen, integer).
  - Even in the English UI, use `¥` and `,` separators consistently.

---

### 3. Desktop: Dashboard Specification

#### Layout Structure

- **Fixed sidebar (left: 280px)**:
  - Top: Scope switching & shared context selection.
  - Middle: Navigation (Dashboard, Accounts, Goals, Settings).
  - Bottom: Cloud synchronization status (Online / Saving… / Sign-in required / Retry needed / Offline / View-only).
- **Main view (right: flexible)**:
  - **Whole-view scrolling**: Keep the sidebar fixed; the entire main view scrolls vertically.
  - **Sticky Header**: Keep the Global Progress section fixed at the top while scrolling.
  - **Header wording**: Display the title only, without supporting copy.

#### Main Content

1. **Goal list (left column / 60% width)**:
   - Show the **Top 5** active Goals (priority ascending).
   - Each card: Goal name, progress percentage, amount (Allocated / Target), Butter yellow progress bar (fill).
   - Clicking navigates to `/goals?goalId=<ID>` and opens that Goal selected (briefly highlighted).
   - Place `Open goals` at the end.
2. **Recent position updates (lower left column)**:
   - Show the **Last 5** recently updated Positions (`updatedAt` descending).
   - Clicking a row navigates to `/accounts?accountId=<A>&drawer=position&positionId=<P>` and opens that Position drawer.
   - Place `Open accounts` at the end.
3. **Asset / account summary (right column / 40% width)**:
   - Place a `Pivot` (By Account | By Asset) switch at the top right.
   - **By Account**:
     - Show the **Top 5** accounts (Total balance descending).
     - Do not collapse zero-balance accounts (include them within the Top 5).
     - Each row shows account name, balance, and an understated Unallocated amount.
     - Clicking a row navigates to `/accounts?accountId=<A>`.
     - Place `Open accounts` at the end.
   - **By Asset**:
     - Show a donut chart and legend list by asset category.
     - If there are many categories, consolidate into the top categories + Other.
4. **Recent activity (lower right column)**:
   - Show only the **Last 5** activities.
   - Do not provide `View all`.
   - When empty, show `No recent activity yet.` together with the `Last 5` scope label.
   - Show an Origin (`User` / `System`) badge.

- Near each card heading, show a small `Top / Last` scope label matching the display limit.

---

### 4. Mobile: Home Specification

#### Layout Structure

- **Whole-page scrolling**: Fix the bottom navigation bar; the entire page scrolls.
- **Bottom navigation**: Four tabs: Home, Accounts, Goals, Settings (do not use the `Dashboard` label on mobile).
- **Header**:
  - Place a shared header at the top of the screen.
  - Place synchronization status (circular dot + short wording) at the right end; tapping opens synchronization details in Settings.

#### Content Structure

1. **Compact header (within content)**:
   - Scope switch at the top right. In Shared, tapping expands the context-selection UI.
   - A slim Global Progress bar.
   - Consolidate KPIs into **one Summary card**, with `Total assets` above and `Allocated ... · Unallocated ...` on one line below.
2. **Goal swipe area (Goals)**:
   - Display Goal cards in a horizontal swipe carousel to save vertical space.
3. **Assets overview**:
   - Use an accordion (initially closed). Show a one-line summary in the title row.
     - Example: `Total ¥1,200,000 · Top: Cash 42%`
   - When expanded, hide the summary line and show the Top / Last label at the upper left of the items (same location as desktop).
   - When expanded, show `By account / By asset` details.
   - Persist expansion state as a user preference (localStorage, etc.).
4. **Recent position updates**:
   - **Always show only 3 items** (one `Most recent` + the next two). Do not provide `Show all`.
   - Retain the **Last 5** scope label.
   - Layout:
     - Show the latest item in a `Most recent update` card (Position name / Account name / relative Updated time / amount).
     - Show the next two in **two-column small cards** (second and third most recent).
   - Show `Showing 3 of last 5` in small text in the footer to explain the display limit.
   - Tapping navigates to `Position detail`.
   - Place `Open accounts` once at the end.
5. **Recent activity**:
   - Use an accordion (initially closed). Show a one-line summary in the title row.
     - Example: `Last: Value updated: Cash · 2 hours ago`
   - When expanded, hide the summary line and show the `Last 5` label at the upper left of the items.
   - When expanded, show only the `Last 5` activities (no `View all`).
   - Persist expansion state as a user preference (localStorage, etc.).

- **Do not place a FAB on Home**. Follow the existing add-action policy of each tab (Accounts / Goals, etc.).

---

### 5. Implementation Notes (for AI / Developer)

- **Unallocated handling**: Standardize UI wording to `Unallocated` throughout Dashboard / Accounts / Positions (do not use `Free`). Always frame it positively as available headroom. Avoid overemphasis; display it in Soft gray tones as part of the breakdown.
- **Scope labels**: Dashboard `Top / Last` labels must match the display limit N.
- **English UI**: System wording (Last / Top / Updated, etc.) must be English only. User-entered names (Goal / Account / Position names) may use any language.
- **Shared-scope navigation**: When Shared is selected, navigate using query parameters as the SSoT, based on `/shared/<provider:sharedId>/goals` / `/shared/<provider:sharedId>/accounts`.
- **Scrolling**:
  - Avoid nested scrolling within the desktop main view (such as scrolling only within the Accounts list); always use whole-page scrolling.
- **Cloud conflicts**:
  - Do not automatically merge on save failure. Notify through a Dialog / Toast and provide a reload action.
- **PWA (future: when Japanese is added)**:
  - Prioritize the `lang` cookie; initially set `lang` from Accept-Language.
  - Use `/manifest.webmanifest` for default English and `/manifest-ja.webmanifest` for Japanese; switch `<link rel="manifest">` according to the cookie.
  - Keep unified URLs; do not pin language through query parameters.
  - Use icons with **`purpose: "any"` only** (no `-maskable` files). However, retain composition and margins that work when masked.

---

## Mazemaze Piggy Bank: Accounts & Assets Screen Specification

### 1. Basic Design Principles

- **Concept**: Warm Precision.
- **Colors (brand-compliant / fixed)**:
  - Butter yellow (Accent / Base): `#F6E58D` (use only this yellow)
  - White (Base): `#F5F5F2`
  - Soft gray (Base): `#626258`
- **Tone**: A modern, refined, professional tool.
- **Accessibility**: Integer yen only, automatic comma separators, sufficient contrast and font size.
- **Wording (current)**: English only. Add i18n when Japanese (ja) is introduced in the future.

### 2. Shared / Foundational Specification

- **Data structure**: Account > Position (asset).
- **Display order**:
  - Accounts list: Creation time ascending (fixed)
  - Positions list (mobile Account detail): Creation time descending (newest first)
- **Currency**: Fixed to JPY (yen). Foreign currency / points also require manual entry as integers already converted to yen.
- **Recalculation mode**: Default to Fixed.
- **Desktop information architecture**:
  - Left: Accounts list (select by clicking a row; no `View` button)
  - Right: Positions table (primarily for viewing) + right drawer (add / edit / details)
  - Always show `Positions in <AccountName>` as the heading to clarify the relationship.
- **Form placement**:
  - Do not provide permanently visible `Account details` / `Position details` forms.
  - Consolidate `Add account` / `Add position` / `Position details` in the right drawer.
- **Notifications (Toast)**: Display at bottom center.
  - **Success**: Feedback such as save completion (may be suppressed for frequent operations).
  - **Celebration**: When a Goal is achieved (🎉 icon). Supplement decoration through shape (icons / shadows / borders / spacing) rather than more colors.
  - **Caution**: Automatic allocation adjustment caused by balance reduction (⚠️ icon + `Review`).
- **Supporting UI**: Provide explanations and examples for recalculation modes and asset categories through tooltips (desktop) or popovers (mobile).
- **History entry point**:
  - Provide `History` in Position details (follow this document's History chapter).

---

### 3. Desktop: UI/UX Specification

#### Layout: Two-Pane Master–Detail

- **Left pane (320px)**: Account list.
  - Fully synchronized with sidebar scope selection (Personal / Shared).
  - Select by clicking a row; highlight the selected row (background / left border / bold text, etc.).
  - Place `Add account` in the heading row.
- **Right pane (flexible)**: Positions in the selected Account.
  - Account summary bar at the top (Account name, Total / Allocated / Unallocated).
  - Display `Label / Value / Recalc mode / Last updated` in a table (Grid).
  - Integrate `Allocated / Unallocated` into the second line of the Value cell; do not create separate columns.
    - Example: `Allocated ¥400,000 · Unallocated ¥600,000`
  - Show `Recalc mode` as a chip with a supplementary Tooltip.
    - Tooltip: `How allocations follow when the value changes.`
  - Always show `Last updated` as relative time; show absolute time in a Tooltip.

#### Operation Flow

- **Add (Account / Position)**:
  - Enter data in a drawer sliding in from the right.
  - When adding an asset, default the destination Account to the currently selected Account.
  - On confirming `Add account` / `Add position`, close the drawer and save in the background.
- **Update (valuation)**:
  - Use inline editing by clicking directly on the valuation cell.
  - Confirm with `Enter`; cancel with `Esc`.
  - Show the hint only the first time: `Enter to save · Esc to cancel`
  - Consolidate instructions in the ⓘ beside the heading: `Enter to save · Esc to cancel` / `JPY integer only.`
  - Autosave on `Enter` confirmation.

#### Position Editing from Goals (Deep Link)

- When navigating from `Edit position` in Goals, Accounts restores the target drawer state from the query.
  - Example: `drawer=position&positionId=...&accountId=...&returnGoalId=...&returnTab=allocations`
- If `returnGoalId` is present, show `Back to goal` in the Position detail drawer.
- If `returnGoalId` is present, Close actions (Close button / overlay / Esc) return to Goals.
- Keep the `Save position` label unchanged as `Save position`.
  - On save success, close the drawer and return to Goals through the same Close handler.
  - On save failure, keep the drawer open and allow correction in place.
- If there is in-progress input when using `Back to goal` or Close, show a discard-confirmation dialog (`Discard changes and go back` / `Stay`).

#### Routing & State Restoration (URL SSoT)

- Use URL query parameters as the SSoT for Accounts selection state.
  - Always represent `accountId` in the query (if absent, supply the default Account through `replace`).
  - Include `drawer=position` and `positionId` only while the Position detail drawer is open.
- Use `replace` for state changes within the same page (`accountId` / `drawer` / `positionId`).
- Use `push` for route navigation (Goals ⇄ Accounts, etc.).
- Use query restoration to derive destination state; do not maintain duplicate local selection state.
- Do not reapply stale selections after asynchronous updates (apply only targets matching the latest query).

#### Empty State

- **No Accounts**:
  - Title: `No accounts yet`
  - Body: `Add an account to start tracking your positions.`
  - CTA: `Add account`
- **Accounts exist, but no Positions**:
  - Title: `No positions in this account`
  - Body: `Add your first position (e.g., Deposit, Cash, FX).`
  - CTA: `Add position`
- **No Allocations** is not an Empty state.
  - Show a summary note only if needed: `No allocations yet. Set goals to start allocating.`

#### Save Triggers (Confirmation Actions)

- In desktop Accounts, always attempt to save on the following confirmations (changes must survive reload):
  - `Add account` / `Save account` / `Delete account`
  - `Add position` / `Save position` / `Delete position`
  - `Enter` in Value inline editing

#### Save Failure / Conflicts / Disabled States

- **Success**:
  - For inline editing, return the cell from `Saving…` to its normal display.
  - Update the shared synchronization status (`Saving…` / `Online` / `Retry needed`).
  - Do not flood the UI with success Toasts.
- **General failure**:
  - Show a failure Toast (with `Retry` if needed).
  - Discard the latest edit and return to the pre-save state (rollback).
- **Conflict failure**:
  - Do not automatically merge.
  - Recover through fetching the latest data → discarding local edits → Dialog notification.
- **Offline / View-only**:
  - Disable `Add / Edit / Delete / Inline edit`.
  - Briefly explain why they are disabled.

#### Button Placement (Desktop)

- `Add account`: Accounts heading row
- `Add position`: Only one, in the Account summary bar
- Do not place `Add position` at the top right of the Positions heading (only ⓘ help is allowed)

---

### 4. Mobile: UI/UX Specification

#### Screen Hierarchy (IA)

- Standardize on three levels: `Accounts` → `Account detail` → `Position detail`.
- In `Account detail`, always show a heading clarifying the relationship equivalent to `Positions in <AccountName>`.
- Display `Position detail` full-screen, switching between `Details / Allocations / History` for viewing and editing.

#### Layout and Display

- **Accounts**: Single-column Account list.
- **Account detail**: Display Positions as cards / two-line list items.
  - First line: `Label` (primary) + `Value` (emphasized)
  - Second line: `Allocated / Unallocated` (supplementary)
- Do not show `Last updated` in the list; show it in `Position detail`.
- Display newly added Positions first in `Account detail` and briefly highlight them.

#### Consistent FAB (Add Action)

- Always show the same `+` FAB at the bottom right.
- The FAB menu has two fixed items:
  - `🏦 Account` (Add account)
  - `💰 Position` (Add position)
- Every item must show both icon and label (icon-only is prohibited).
- Disable actions unavailable in the current context and show an English explanation in the same menu.
- As a rule, do not provide add buttons outside the FAB. The only exception is an Empty state CTA.

#### Empty State (Mobile)

- **No Accounts (Accounts)**:
  - Title: `No accounts yet`
  - Body: `Add an account to start tracking your positions.`
  - CTA: `Add account` (shown only in Empty state)
- **Accounts exist, but no Positions (Account detail)**:
  - Title: `No positions in this account`
  - Body: `Add your first position (e.g., Deposit, Cash, FX).`
  - CTA: `Add position` (shown only in Empty state)
- **No Allocations** is not an Empty state (only a note if needed).

#### Destination after Adding (Prevent Disorientation)

- After successful `Add account`, always open the created Account's `Account detail`.
- After successful `Add position`, return to `Account detail`.
- Attempt to save additions on confirmation; they must survive reload (follow this document's Autosave and Synchronization / Conflicts chapters).

#### Editing Entry Points and Save Feedback

- Tapping a Position card opens `Position detail`.
- Perform edits such as valuation updates and recalculation-mode changes in `Position detail`.
- Follow shared save-feedback requirements:
  - Success: Update `Saving… / Online` (suppress success Toasts for frequent operations)
  - General failure: Failure Toast (with `Retry` as needed) + rollback
  - Conflict: Fetch latest + discard local edits + Dialog notification (no automatic merge)
- Disable editing UI in `Offline / View-only` and show a short English explanation.

---

### 5. Input Guardrails

- **Numeric input**: Decimal input is prohibited. Show thousands separators in real time while typing.
- **Validation**: If a decimal is entered, **show a real-time error** and disable submission.
- **Submission guard**: If such input is nevertheless submitted, **stop processing with an error**.
- **Currency constraint**: Explicitly state `JPY integer only`; do not save non-integer-yen values.
- **Placeholder**: Show `0 (JPY integer only)`.
- **Note**: Place `Enter the JPY-converted integer value for FX/points as well.` directly below the field.

---

## Mazemaze Piggy Bank: Goal Screen Specification

### 1. Basic Concept

- **Warm Precision**: Combine trustworthiness and approachability through Fluent UI with Butter yellow (`#F6E58D`) accents.
- **Unified state / actions / saving**: Handle Goal states (Active / Closed / Spent) and actions (Edit / Allocate / History / Spend) within one mental model.
- **Wording (current)**: English only. Add i18n when Japanese (ja) is introduced in the future.

### 2. Data Model (Goal)

- `id`: string
- `scope`: "personal" | "shared"
- `name`: string (Goal name)
- `targetAmount`: number (JPY integer)
- `priority`: number (Order; integer starting at 1)
- `status`: "active" | "closed"
- `spentAt?: string(ISO8601)` (used to determine whether the Goal is spent)
- UI: Make history accessible through `History` (persistent-flag warnings are not mandatory).

### 3. Business Logic & Constraints

- **Allocation limit**: Always maintain `sum(AllocatedAmount) <= Goal.targetAmount`.
- **State determination (two axes)**:
  - Active: `status=active` and no `spentAt`
  - Closed: `status=closed` and no `spentAt`
  - Spent: `spentAt` present (takes precedence over status)
- **Achieved**:
  - Display as the calculated result of `allocated / target >= 100%`, not a persisted state.
  - Do not automatically change to `closed` at 100% (no automatic transition).
- **Priority**:
  - Display the list in priority order. Use manual insertion logic (moving D to second yields A, D, B, C, ...).
  - On reopening (Closed -> Active), automatically assign the last priority.
- **Recalculation on balance updates**:
  - When asset valuation decreases and allocations are automatically adjusted, follow the Toast / navigation requirements in this document's Automatic Adjustment chapter.
  - Support later discovery through the History UI.

### 4. UI/UX Specification

#### 4.1 Desktop (Master–Detail)

- **Layout**: Three panes (App sidebar / Goal list / Goal detail).
- **Left pane (Goal list)**:
  - Default to Active only.
  - Show `Active / Closed / Spent` filter chips and counts.
  - Do not continuously show an `active` badge in the Active filter (omit it because it conveys no distinction).
  - `Closed` / `Spent` badges may be shown to make state visible in the list.
  - Spent cards show no progress bar; show a `Spent` badge and `Spent on YYYY-MM-DD`.
  - Place `Add goal` in the heading row; create through a drawer (no permanent Create form).
- **Right pane (Goal detail)**:
  - Keep the header (title, state, primary actions) and tabs (`Details / Allocations / History / Receipt`) sticky.
  - Scroll only the body (tab contents) within the right pane.
  - Always show state (`Active / Closed / Spent`) in Goal detail.
- **Primary actions (header)**:
  - Show `Mark as spent...` only when Closed and no spentAt is present.
  - Show `Undo spend` when spentAt is present.
  - Do not show `Mark as spent...` in the `Active` state for the MVP.
- **Tabs**:
  - `Details`: Edit basic Goal information.
  - `Allocations`: Show only Positions with allocations (allocated > 0); edit through absolute-value input.
  - `History`: Show recent history within the tab (`Load more`).
  - `Receipt`: View-only tab shown only when spentAt is present.

#### 4.2 Mobile (PWA)

- **Layout**: Full-screen overlay. Do not adopt swipe actions.
- **Information hierarchy**: Two levels (`Goals list -> Goal detail`); do not display list and detail simultaneously.
  - No `goalId` selected: List only
  - `goalId` selected: Detail only (Back returns to list)
- **FAB (add actions)**:
  - Consolidate add actions in the FAB menu (icon + label).
  - Always show `🎯 Goal` (Add goal).
  - Enable `➕ Allocation` (Add allocation) only in the Goal detail `Allocations` tab.
  - Outside that context, disable it and show a short explanation in the same menu (e.g., `Open a goal to add allocations.`).
- **Input method**: Use the standard system keyboard through `inputmode="numeric"`.
- **Mode switching**: Use in-place editing, replacing display text with editable fields through buttons in the detail screen.
- **History**: Access `History` from Goal details (full-screen sheet / overlay).
- **Tap targets**: Give chips / small buttons / menu items sufficient padding to reduce mistaps.

#### 4.3 Scope and Sharing Display

- **Asset labels**: Within shared scope, display `[CreatorName] AssetName` so the contributor can be identified.
- **Shared Goals**: Scope selection already filters them, so a sharing marker is generally unnecessary on individual screens. Do not adopt mixed-scope displays.

### 5. Primary Interactions and Navigation

#### 5.1 Adjusting Allocations (Absolute-Value Input)

- The Allocations tab lists only Positions with **allocated > 0** (avoid listing many unallocated Positions).
- Add primarily through `➕ Allocation` in the FAB (no permanent form).
- On desktop, a single `+ Add allocation` may appear at the upper right of the Allocations tab.
- When there are no allocations, an `Add allocation` CTA may appear in the Allocations tab's Empty state.
- On mobile, do not duplicate `+ Add allocation` outside Empty state.
- Each allocation row shows:
  - `Available ¥X`
  - `Allocation (JPY)` input (current value)
  - `After change: Unallocated ¥Y` (only while editing)
- Each row shows `✏️ Edit` (small / secondary), invoking the Goals → Accounts deep link.
- Constraints:
  - Allocation <= Available
  - Total Allocations across the Goal <= Remaining to target
  - Integer JPY only
- Saving:
  - Confirm with Enter / Blur and autosave.
  - Do not provide a `Save allocation` button.
  - Do not adopt `Apply reductions`.
- After a successful addition:
  - Display the added allocation first in the list.
  - Briefly highlight the new row for visibility (recommended).
- Place `Remove all allocations` as a contextual action.
  - Desktop: Upper right of the Allocations tab, next to `+ Add allocation`
  - Mobile: Upper right of the Allocations tab (not in the FAB)
- `Remove all allocations` requires a confirmation dialog.
- Disable it when there are no allocations.
  - Title: `Remove all allocations?`
  - Body: `This will set all allocations for this goal to ¥0.`
  - Buttons: `Cancel` / `Remove`

#### 5.2 Spend / Undo (Spending Flow)

- Perform Spend through a dedicated drawer opened from `Mark as spent...` in the right-pane header, not through a tab.
- In the Spend drawer, enter payment distribution per Position and validate the matching total and upper limits.
- Place `Undo spend` in the same header location for Goals with spentAt.
- Explicitly state Undo conditions (most recent only / within 24 hours) in Receipt or details.

#### 5.3 History / Receipt

- `History` shows the most recent N items within the tab and fetches more through `Load more`.
- Do not adopt a two-step `Open history` flow (tab → button → separate container).
- Show `Receipt` only for Goals with spentAt, presenting payment breakdown and date / time as view-only.

#### 5.4 Feedback (Toast / State)

- Suppress success Toasts for frequent operations (prioritize `Saving…/Online` status).
- Automatic adjustment notifications may navigate to the Allocations tab through `Review`.

#### 5.5 Goals → Accounts Deep Link (Position Editing)

- `Edit position` reuses the existing Accounts `Position detail` drawer (`Details / Allocations / History`).
- Pass return information through the query when navigating:
  - `drawer=position`
  - `positionId`
  - `accountId`
  - `returnGoalId`
  - `returnTab=allocations`
- When `returnGoalId` is present on Accounts:
  - Show `Back to goal`.
  - Close actions (Close button / overlay / Esc) return to Goals.
  - After successful `Save position`, close the drawer and return to Goals through that Close handler.
  - On save failure, neither close the drawer nor return to Goals.
- Treat `Back to goal` as cancellation; show a discard-confirmation dialog if input is in progress.

#### 5.6 Routing & State Restoration (URL SSoT / push-replace)

- Use URL query parameters as the SSoT for Goals selection state.
  - Always represent `goalId` in the query (if absent, supply the default Goal through `replace`).
  - Represent `tab` in the query as `details / allocations / history / receipt`.
- Use `replace` for selection changes within the same page (`goalId` / `tab`).
- Use `push` for page navigation (Goals → Accounts, Accounts → Goals).
- Query synchronization is derivation-only; do not roll back selection through delayed query → local-state synchronization.

#### 5.7 Stale-While-Revalidate (Avoid Delays When Returning)

- Default Goals / Accounts to immediate display of local state + background revalidation.
- Do not clear the detail pane when returning; refresh with non-blocking feedback (e.g., `Refreshing...`).
- While editing (input in progress), do not immediately apply revalidation results; prioritize the user's operation.
- Preserve return navigation through `returnGoalId` / `returnTab` without delaying the return after saving.

---

## Mazemaze Piggy Bank: Settings Screen Specification

### 1. Overview and Design Concept

- **Role**: The foundational infrastructure screen for managing OneDrive / Google Drive connections, shared scopes, and data consistency.
- **Design**: Warm Precision. Based on Fluent UI, with Butter yellow (`#F6E58D`) accents.
- **UI structure**:
  - Desktop: Single-column card layout limited to 800px wide.
  - Mobile: Two-line list items by category. Tapping opens a full-screen Overlay (Sheet / Modal) with details, synchronized with the URL hash.
  - The mobile list summarizes state through title + subtext; do not show lengthy errors in full in the list.
  - Avoid redundancy: Do not provide a dedicated card containing only the `Settings` title and description.
- **Information architecture (top to bottom)**:
  1. `Sign-in & storage`
  2. `Connection health`
  3. `Workspace`
  4. `Data & portability`
  5. `Appearance`
  6. `Advanced / Diagnostics`
  7. `Danger zone`

### 2. Sign-in & storage

- **Signed out**
  - Heading: `Choose where to save`
  - Show vertically stacked OneDrive / Google Drive cards
  - Descriptions:
    - `Save to your Microsoft account.`
    - `Save to your Google account.`
  - CTA: **Official sign-in buttons** (logos only inside the buttons)
  - Do not show `Switch…`
- **Signed in**
  - Display:
    - `Connected to: OneDrive / Google Drive`
    - `Signed in as: <name/email>`
    - `Workspace: Personal / Shared (view-only/can edit)`
  - Buttons:
    - `Sign out`
    - `Switch…` (**also includes Switch account**)
- Restore the last-selected provider on reload (do not automatically switch providers even when signed out)
- Apply §8.7 for remembered connections: show a reminder for the current provider only when previously connected, online, and in need of sign-in. Use the official sign-in button; keep the normal choices available for first-time use and deliberate switching. An authenticated inactive provider must not be displayed as the current connection.
- **Switch… dialog**
  - List candidates across OneDrive / Google Drive
  - States: `Available` / `Empty` / `Not signed in`
  - Show `Create` only for `Empty`
  - Make `Open` the primary action for `Available`
- `Move data…` requires double confirmation + backup confirmation
  - Show **progress (phase + item count)** while Move runs
  - **Do not allow cancellation** during Move (avoid corruption)
  - On failure, **run Move again** (deletion occurs last)
- For signed-out candidates, show only the official sign-in button (no Open / Move)
- Do not continuously display provider logos in Settings (use them only within sign-in buttons).

### 3. Connection health

- Show `Status: <state>` at the top (using the six shared states).
- Show `Last sync` as relative time, with absolute time as supplementary information (title / details).
- Consolidate recovery actions into:
  - `Retry now` (enabled only for `Retry needed`)
  - `Clear cache & reload`
  - `Reload from cloud`
- Show `Sign-in required` when online but signed out / expired.
- On Google Drive insufficient scopes (403 / insufficient scopes), show a permission-renewal message and let the user explicitly activate sign-in with consent. Do not open a popup from background loading or recovery (§8.7).
- Google Drive scopes are `drive.file` + `drive.appdata` (the pointer is stored in appDataFolder).
- When `Retry now` is disabled, **always show** short helper text directly below the button (do not rely on hover).
  - Examples: `No queued retries.` / `You're offline.` / `Read-only mode.`
- Place `Retry queue` / `Snapshot version` inside `Show details`.
- Prioritize key information and recovery actions rather than redundant information.
- Folder rename notice:
  - Applies to: App / Personal / Shared (Shared by me only)
  - Wording: `Notice: A folder name was changed. Sync will continue, but for backups use Export in Data & portability.`
  - Include a route to `Data & portability` (`#data-portability`).

### 4. Workspace

- **Discovery logic**: Use the shared root's **folderId** as the SSoT and retrieve its immediate child folders (name searches only during recovery).
- Consolidate shared workspace selection states and warnings in this section.
- Display `No shared workspace selected` only within Workspace.
- Organize details into three blocks:
  - `Shared workspace`
  - `Share link`
  - `Note` (only when needed)
- Provide creation within the app:
  - `Create shared workspace…` → name-entry dialog → create → update the list
  - Silently create `<appRoot>/shared` if absent
  - Do not automatically switch the selected context after creation (retain Personal / the existing Shared context)
  - Notice: `Creating a workspace doesn’t share it automatically.`
- Provide sharing-link creation for the selected workspace:
  - One `Access type` (`View` / `Edit`) switch + one `Create link` button
  - Show the generated link as readonly and allow copying with `Copy`
  - Disable when nothing is selected and briefly explain why (e.g., `Select a shared workspace first.`)
  - On failure, show a short summary; isolate details in `Show details` if needed
  - Offer `Open in Drive` as an alternative (provide fallback wording if it cannot be obtained)
  - Notice: `Creating a link doesn’t share it automatically - only people you send the link to can access it.`
- Truncate long `Location` paths and provide `Copy path` when possible
- Clearly show `Access` as `Can edit / View-only` through chips or similar UI (avoid adding too many colors)

### 5. Data & portability

- Consolidate Export / Import in this section.
- Export:
  - Two buttons: `Export personal data` / `Export shared data`
  - Include `snapshot.json` and `events.jsonl` in the zip
- Import:
  - Accept only previously exported zip files; proceed through **validation → preview → apply**
  - Reject corrupt / invalid formats
  - Explicitly state that applying overwrites existing data
  - Provide a file-selection flow that works on mobile (iOS / Android)

### 6. Appearance

- Provide `Light / Dark / System`.
- Keep it concise in one section because it is not a frequent operation.

### 7. Advanced / Diagnostics

- A collapsible display is recommended.
- Group infrequent diagnostic operations (such as Storage checks).
- Do not place `Review allocations` in Settings.

### 8. Danger zone

- Consolidate dangerous operations and require two-stage confirmation.
- In the mobile list, use restrained emphasis such as a pale red background / left border.
- Operation: `Delete cloud data` (do not use the word `Uninstall`)
  - Step 1: Warning + `I understand` checkbox
  - Step 2: Enter `DELETE`
- After execution, stay signed in, clear only **the active provider's local cache**, and reload.

### 9. Required Implementation Logic

- Standardize status navigation to `/settings#connection-health`.
- On mobile, interpret `#connection-health` as opening the corresponding Overlay. Anchor scrolling is acceptable on desktop.
- If possible, handle other section hashes such as `#sign-in-storage` / `#workspace` / `#data-portability`
  the same way (open the Overlay directly).
- UI wording must be English only.
- Display both OneDrive / Google Drive providers (without persistent logos).
- Use **folderId as the SSoT** for root identification; name searches are for recovery only.

---
