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

- **PWA** (mobile first), with a **thin stateless API** and **Managed PostgreSQL**.
- **PostgreSQL is the Canonical Source** for committed Workspace data.
- **IndexedDB holds a cache of Canonical data and an Unresolved Operation Journal** for input protection. Neither is an independent Canonical Source.
- Sharing uses **app-managed membership**. Authentication and current authorization are required at the Server boundary.
- Saves use **optimistic concurrency and stale-write rejection**, with **no automatic merge or automatic rebase**.
- **Offline is view-only**. The journal does not enable offline editing or general-purpose mutation synchronization.
- Domain History is recorded as **Activity**; persistence does not require rebuilding State from Activity.

---

### 1. Purpose

Manage multiple accounts and assets (cash / deposits / foreign currency / investment funds, etc.) through **manual input**, and track progress by allocating (reserving) them to multiple savings goals.
Goals may be drawn down. When an asset's market value (valuation) changes, recalculate allocations linked to that asset according to **the setting on each Position (allocationMode)**.
Sharing uses **shared pool accounts + shared goals**.

---

### 2. Scope and Policies

- No account integrations (scraping / APIs). Balances, market values, deposits / withdrawals, and valuation updates are entered manually.
- Store Canonical data in an app-hosted Managed PostgreSQL service and provide portability through versioned Export / Import.
- This accepts app-hosted storage as a Product trade-off. A downloadable backup provides portability; it does not give users direct ownership or control of the live storage service.
- Keep Personal data and each Shared Workspace separate. Multiple Shared Workspaces are supported.
- Preserve unresolved input when a save cannot be confirmed. Distinguish a rejected HTTP attempt from an unknown logical-operation outcome (§8.4).
- Do not automatically merge concurrent changes or rebase retained operations onto refreshed data.
- Offline viewing uses cached data with an explicit freshness limitation. Editing requires an online, verified Workspace context.
- Editing presence is not an MVP requirement and is not part of persistence correctness.

---

### 3. Technology Stack (Implementation Policy)

- Frontend: **Next.js / React / TypeScript**
- UI: Adopt **Fluent UI**, prioritizing a Microsoft-style tone (trustworthiness + approachability)
- Server: **Thin stateless API**, responsible for request validation, authorization, Domain validation, and persistence coordination
- Canonical persistence: **Managed PostgreSQL**; correctness must not depend on hosting-specific functionality
- Browser persistence: **IndexedDB**, with distinct responsibilities for Canonical cache and unresolved input protection
- State management libraries and concrete API / database representations remain implementation decisions within these contracts
- Authentication technology and identity lifecycle design are separate Production design decisions; this specification does not select an authentication service or protocol

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
  - Settings (Sign-in & access, Connection health, Workspace, Data & portability [Export / Import], destructive-operation guidance)

#### 4.x Scope Display and Switching (UI Policy)

- Use **scope switching** (Personal / Shared) for account / asset and goal lists, details, and editing
- Display Shared by selecting a Workspace (support multiple Shared Workspaces)
- Display non-writable shared data as view-only and disable editing UI
- **Restore the last-used scope / Workspace as the initial selection**, subject to current access verification; a remembered selection does not grant access
- Make dashboard **totals / breakdowns easy to read** (implementation discretion)
  - Examples: Combined totals plus a Personal / Shared breakdown, or switching among combined / Personal / Shared views

#### 4.y UI Guidance (Required Policy)

- As a rule, show a change summary when automatic adjustments occur.
- There are two kinds of guidance to editing:
  1. **Normal allocation editing (10.3)**: A screen for manually adjusting Position → Goal allocation amounts
  2. **Drawdown / adjustment UI (10.6)**: A dedicated interactive UI where users choose which allocations to reduce to resolve shortfalls, etc. (only when needed)
- For ratio mode, explain the fixed closed reservations and the active / unallocated ratio pool. Selecting the mode does not generate ratios; a new pool without an old ratio stays unallocated (including V_old=0; see §10.5).

---

### 5. Terminology

- **Workspace**: A context containing a dataset and defining the boundary for access, persistence versions, and replacement. Personal / Shared is a property of the Workspace, not of individual Domain entities. `workspaceId` identifies it independently of its name.
- **Account**: An asset container within a Workspace. This Domain concept is distinct from a user's sign-in account.
- **Position**: An asset unit within an Account (e.g., an ordinary JPY deposit, USD cash, investment fund A).
- **Goal**: A savings goal within a Workspace.
- **Allocation**: The amount reserved from a Position to a Goal in the same Workspace.
- **Canonical State**: The current committed Domain data held by the Server in PostgreSQL.
- **Activity / History**: User-facing records of Domain changes, including support for eligible Undo operations. Activity is not a technical request log or a required full event store.
- **Spend / Payment Record**: Long-lived Domain data describing a Spend, including its payment breakdown and the information needed to interpret it. The UI may call this a `Receipt`.
- **Operation Receipt**: Persistence bookkeeping for idempotency and committed-result lookup. It is distinct from Activity and Spend / Payment Records.
- **Canonical cache**: A rebuildable browser copy of Server data, with its Workspace and timeline identity and freshness information.
- **Unresolved Operation Journal**: Browser-retained logical operations and exact input whose outcomes still need resolution. It is distinct from both Canonical cache and unsubmitted editor input.
- **Domain adjustment**: A deterministic adjustment within a normal accepted Domain operation, such as reducing Allocations after a valuation decrease.
- **Canonical integrity problem**: A violation of the invariants required of Server Canonical State. Ordinary reads must not silently rewrite that State.
- **Client cache recovery**: Rebuilding non-canonical cached data from verified Server data, without silently deleting unresolved journal entries.
- **Unallocated (未割当)**: `Position.marketValue - ΣAllocation(for that Position)` (must not be negative).

The persistence identities `restoreEpoch`, `workspaceIncarnationId`, `baseVersion`, `operationId`, and `requestId` have separate meanings defined in §8.2.

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

These are Product-level data requirements, not a relational schema. Each Account, Position, Goal, and Allocation belongs to one Workspace context. Personal / Shared is determined by that Workspace; entities do not independently declare this property. A Position belongs to an Account in the same Workspace, and an Allocation references only a Position and Goal in that Workspace. Cross-Workspace references are prohibited. The physical representation of Workspace membership is not prescribed here.

#### 7.1 Account

- `id: string`
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
- Closed Goals may retain Allocations, but do not receive automatic increases.
- Regardless of `status`, spent Goals **must have no Allocations** and are excluded from automatic distribution.

#### 7.4 Allocation

- `id: string`
- `goalId: string`
- `positionId: string`
- `allocatedAmount: number` (integer yen, **0 or greater**)

**Constraints (Required)**

- **At most one `(positionId, goalId)` pair within the same Workspace (Allocations are unique)**
- For each `positionId`, `Σ allocatedAmount ≤ Position.marketValue` (exceeding it is prohibited)
- For each `goalId`, `Σ allocatedAmount ≤ Goal.targetAmount` (exceeding it is prohibited)
- **Physically delete** an Allocation when `allocatedAmount = 0` (do not retain zero-yen Allocations)
- The Position's Account and the Goal must belong to the same Workspace.
- Allocations must reference existing Positions and Goals; Positions must reference existing Accounts.
- A spent Goal must have no Allocations.
- All monetary values must satisfy §6 and be nonnegative. Allocation sums must satisfy both Position and Goal limits after every committed operation.
- `remainingToTarget = Goal.targetAmount - Σ current Allocations(for that Goal)` is the incremental amount that can still be added to the Goal. It is a display / incremental capacity value, not the upper bound on the Goal's total Allocations or an existing Allocation's new absolute value. Absolute editing follows §10.3.

#### 7.5 Activity and Spend / Payment Records

- Record the Domain changes needed for History, adjustment summaries, and eligible Undo. Keep their meaning traceable without requiring Activity to reconstruct all State.
- A Spend / Payment Record preserves the payment breakdown, time, and relevant Domain context for the Goal's Receipt view, independently of Operation Receipt retention.
- Spend Undo requires information about the Spend operation's preceding semantic state (§10.4.1). Neither an Operation Receipt nor a technical request log substitutes for that Domain information.
- Activity, Spend / Payment Records, and their display / interpretive context are part of the portable Domain dataset (§9). Temporary Undo eligibility is not portable; imported Spend records support History / Receipt display without restoring Undo capability. Imported Activity is not proof of a commit on the current Server.
- Per-Activity `restoreEpoch` or `workspaceIncarnationId` is not required. Full replacement removes the previous current History from the current dataset; DB-wide restore restores State and History together.

---

### 8. Persistence Architecture and Commit Contract

#### 8.1 Authority and Atomicity

- PostgreSQL is the Canonical Source. The API mediates reads and writes and enforces current authorization and Domain invariants.
- Browser data and previews are not authoritative, even when they match client-side types. Server-side Domain validation is required for Production.
- Commit State changes, necessary Activity, associated Domain records such as Spend / Payment Records, and the committed Operation Receipt atomically.
- A normal save cannot succeed for State while separately failing to persist its necessary History. Failure to load History after a commit is a read failure, not a partial save.
- The API is stateless between requests; correctness must not depend on a particular process retaining in-memory operation state. There are no server-side pending drafts.
- Concrete transaction implementation, schema, and API design must satisfy these properties without being prescribed here.

#### 8.2 Persistence Identities

| Identity | Meaning and requirements |
| --- | --- |
| `restoreEpoch` | Opaque identity of the database-wide Canonical timeline. It stays unchanged during normal operation. After actual point-in-time recovery (PITR), assign a fresh value while all mutations remain stopped. It fences old mutations and responses; it does not classify History or grant authorization. |
| `workspaceIncarnationId` | Opaque identity of the logical dataset incarnation of the same `workspaceId`, not a save version or a required monotonic counter. It stays unchanged during normal Domain commits. A Workspace full restore, full Import / overwrite, or same-ID reset / replacement assigns a fresh opaque value to reject stale mutation attempts and replay of pre-replacement journals. DB-wide PITR restores the value stored at the restore target; it does not itself issue a fresh incarnation ID (§8.5). It does not prevent authorized recovery queries from discovering the current incarnation. It is not a History category or authorization authority. |
| `baseVersion` | The optimistic concurrency version on which a mutation is based within a Workspace incarnation. Each normal commit advances the Canonical version. PITR may return that version to its restore-target value. Compare versions only within the same `workspaceId`, `restoreEpoch`, and `workspaceIncarnationId`. |
| `operationId` | Client-generated logical mutation identity. Replays use the same ID and payload binding. It supports idempotency and committed-result lookup, and is not an Entity ID, ordering key, or Workspace version. |
| `requestId` | Observability identity of one HTTP / API attempt. Each replay attempt has a different requestId. It is not a persistence identity. |

A mutation is bound to its Workspace, `restoreEpoch`, `workspaceIncarnationId`, `baseVersion`, and exact logical input. An operationId must not be reused to submit changed input or silently move an operation to another context.

These are conceptual names in this specification, not prescribed PostgreSQL column names, TypeScript properties, Value Object names, or API JSON fields. Production design must preserve the distinct concepts and consider naming alignment without fixing their physical representation here.

#### 8.3 Normal Save

Before sending HTTP, the browser must retain in its IndexedDB journal at least:

- Target Workspace and `operationId`
- `restoreEpoch`, `workspaceIncarnationId`, and `baseVersion`
- Exact input / payload needed to identify and recover that logical operation

If this retention cannot be completed, do not send the mutation. Retain the editor input where possible and explain the next recovery action.

The Server conceptually checks:

1. Authentication and request validation
2. Maintenance / access gate
3. Current authorization for the requested operation and Workspace
4. `restoreEpoch`
5. `workspaceIncarnationId`
6. `operationId` and payload identity, including an existing committed result
7. `baseVersion` for an operation not already confirmed as committed
8. Domain validation and the required deterministic adjustments
9. Atomic commit of State, necessary Activity / Domain records, and committed receipt, subject to any required pre-commit Major adjustment confirmation (§10.6)

These are correctness properties, not prescribed API endpoints or a database layout. Checks and commit must remain effective under concurrent requests, revocation, replacement, and maintenance transitions.

- Within the same restoreEpoch and Workspace incarnation, two distinct mutations based on the same Canonical version cannot both advance State from that version. A stale write is rejected.
- A matching mutation replay of an already committed operation must not apply the mutation again. The mutation acceptance checks above still apply to that replay. Recovery queries use current authorization under §8.4.1; stale client coordinates alone must not prevent result lookup.
- Bind operation identity to payload; reject reuse with a different payload.
- A browser must not bypass Server validation by submitting an entire replacement State as an ordinary save.

#### 8.4 Result Semantics and Recovery

| Result | Meaning | Required recovery behavior |
| --- | --- | --- |
| Explicit success | The commit is confirmed. | Resolve the matching journal entry and adopt eligible Canonical data under §13.3. Do not let an older response replace a newer State. |
| Explicit rejection | This HTTP attempt was not adopted. Another attempt of the same logical operation may already have committed. | Explain the rejection, retain input as needed, and resolve any uncertainty about other attempts before treating the logical operation as uncommitted. |
| Unknown | Timeout, response loss, or another interruption prevents confirmation. | Retain the operation and exact input; use receipt lookup, Canonical refresh, and safe same-operation replay when permitted. |

- Absence of a receipt is not proof of failure. PITR may have removed both a prior commit and its receipt from the current timeline.
- Epoch or incarnation rejection does not disprove a historical commit on an earlier timeline or incarnation.
- Canonical refresh establishes current State; by itself it does not always establish whether a particular logical operation committed.
- **Same-operation replay** preserves operationId, payload binding, and logical mutation. It is allowed only when current access and identity permit it; it must not automatically rebase a stale operation.
- **Applying intent again after refresh** is a new logical operation, explicitly initiated by the user against current data. Explain any unresolved earlier outcome before the user decides to proceed; never silently create a new operation to retry an unknown one.
- Receipt retention and lookup behavior must preserve honest result semantics. A missing or expired record must not be presented as definitive evidence of non-commit. Specific retention periods remain a Production design decision.

##### 8.4.1 Recovery Queries and Canonical Observation

- A recovery query is a read, not a state-changing operation. Client-held restoreEpoch, workspaceIncarnationId, and baseVersion are neither authorization tokens nor locks, and matching Server values is not a prerequisite for an authorized recovery read.
- Subject to current authentication, authorization, and applicable maintenance / access gates, a client with stale coordinates must be able to discover the current Canonical coordinates and refresh current State. Do not reject the query merely because its remembered epoch, incarnation, or version is old.
- The same conceptual recovery flow must support both:
  - **Current Canonical coordinates**: current restoreEpoch, workspaceIncarnationId, and Canonical version usable as baseVersion for a subsequent mutation.
  - **Requested operation status**: what the Server currently knows about the specified operationId, including a retained committed result and its resulting identity / version where available.
- One physical response or multiple coordinated reads may provide this observation. No endpoint, response shape, query service, or storage representation is prescribed.
- Keep current Canonical coordinates distinct from the coordinates at which an operation committed. A known historical result can resolve that operation without making its old resulting State current again.
- For an Import / reset that committed from incarnation I1 to I2 but lost its response, the authorized recovery flow must be able to report current I2 and the operation's known committed result while evidence is retained. This does not permit replaying an I1 mutation in I2.
- Replacing current State and Activity / History must not unconditionally discard the replacement operation's own committed-result evidence at the same time. Operation Receipts serve recovery independently of portable Domain History; no specific retention duration is defined here.
- A missing receipt, including after PITR rollback, may leave historical commit certainty unknown. The client can still adopt eligible current Canonical coordinates / State; uncertainty does not require remaining on the old timeline.

**Point-in-Time Observation and Concurrency**

- A Canonical fetch or recovery result describes the Server's observation at that time. It does not acquire a lock, reserve a version, or guarantee that a later mutation will succeed.
- For example, fetching version 42, another writer committing version 43, and a mutation based on 42 receiving stale rejection is normal optimistic concurrency. Refresh version 43 and follow the explicit review / retry rules; this loop is not an Architecture failure.
- A commit, Workspace replacement, PITR, or authorization change after observation is handled by Server validation at mutation time. Reject mutations that no longer satisfy the current gates and refresh / reconcile within current authorization. Do not automatically merge or rebase to bypass rejection.
- Browser adoption remains subject to §13.3, including rejection of delayed observations after a newer valid identity / version has been adopted.

##### 8.4.2 Recovery Decisions

The table assumes the recovery read itself is currently authorized and permitted by access gates. Identity comparisons refer to the operation's context versus the verified current Canonical observation.

| Observation | Required behavior |
| --- | --- |
| Same epoch / incarnation; committed result known | Confirm the operation's result and reconcile with current Canonical State / version. Do not replace newer State with the operation's older resulting State. |
| Same epoch / incarnation; result unresolved | Refresh Canonical State, protect retained input, and replay the same operation only where the mutation contract permits it. |
| Same epoch; incarnation changed; committed result known | Confirm the known result and adopt the current incarnation / State. Do not re-execute the old-incarnation mutation. |
| Same epoch; incarnation changed; result unknown or not found | Adopt the current incarnation / State while preserving honest uncertainty about the historical result. Retain input for user recovery where needed; do not automatically replay or rebase it. |
| Epoch changed | Adopt the current Canonical timeline / State when access permits. Retained operation evidence may be inspected, but receipt absence does not prove historical non-commit. Never automatically replay or rebase the old-timeline mutation. |

#### 8.5 Database-wide Restore

- A DB-wide PITR restores State, History, Domain records, and Operation Receipts to the same target. Data committed after the target may disappear; retained pre-target History remains current History.
- Stop all mutations across all writers for restore and timeline transition. After actual restore, assign a fresh opaque `restoreEpoch` before any mutations resume.
- Restore each `workspaceIncarnationId` as part of database State to its value at the restore target. Do not retain the pre-PITR current value or issue a fresh incarnation ID merely because PITR occurred. Canonical versions may also move backward to the target; the fresh `restoreEpoch` distinguishes that timeline even when the incarnation ID is the same as one previously observed.
- Example: At t1, a Workspace has incarnation I1 under epoch E1; a Full Import at t2 replaces I1 with I2. PITR to t1 restores I1 under a fresh epoch E2, not I2 or a newly issued I3. An old `(E1, I1)` mutation or response remains fenced from `(E2, I1)` by `restoreEpoch`.
- Old clients must refresh and reconcile access. Old journals must not be rebased or resent onto the new epoch automatically.
- Reconcile restored authorization under §12.2 before releasing access. A fresh epoch alone does not make restored authorization trustworthy.
- Production recovery must establish writer quiescence, access gating, safe session handling, and controlled release. Backup / RPO, monitoring, and operational procedures require separate Production design; this specification promises no numerical recovery target.

---

### 9. Workspace Lifecycle and Data Portability

#### 9.1 Workspace Initialization

- Identify each Workspace independently of its display name and Personal / Shared selection.
- Initialize a new Workspace with an empty, valid Domain dataset and a persistence identity under §8.
- Creating a Shared Workspace does not grant other people access and does not automatically change the user's selected Workspace.
- A missing cache is not an empty Workspace. Bootstrap existing committed data from the Server before offering creation based on an apparent absence of data.

#### 9.2 Versioned Export

- Export a selected Workspace as a **versioned ZIP containing JSON / JSONL** and metadata identifying the format version and dataset context.
- Include current State, current History, and Spend / Payment Records with the Domain information needed to interpret and display them. Export must represent a consistent committed dataset, not a mix of States and History from different commits.
- Empty History is valid. A portable backup must still represent its History unambiguously; it must not silently omit existing History.
- Unresolved journal entries and unsubmitted editor input are not committed data. Explain their exclusion when unresolved changes are present; an Export is not a backup of those inputs.
- Undo capability / reversal eligibility is not part of Export / Import. The format does not need temporary Undo eligibility or Operation Receipts; Operation Receipts are not portable History. Exported Domain data must not confer membership, identity, or access rights when imported.
- The format must be versioned to permit future evolution. Format migration is distinct from PostgreSQL internal schema migration; neither a universal compatibility policy nor a specific migration mechanism is prescribed.

#### 9.3 Import Validation and Preview

- Accept supported versions of the portable ZIP format through **validation → preview → explicit apply**.
- Reject corrupt, unsupported, invalid, or inconsistent input before proceeding to preview / apply. Do not automatically repair imported data.
- Validate Domain invariants, required History / payment context, and dataset consistency. Preview is not a substitute for trusted validation at the apply boundary.
- Preview identifies the target Workspace and shows that **all current State and current History will be replaced**, including the impact on other members of a Shared Workspace.
- Strongly recommend exporting the current Workspace as a re-importable backup and provide a prominent action before applying Import. Backup creation is optional: Import must not require a successful Export.
- Require two-stage destructive confirmation of the replacement scope and the absence of ordinary Domain Undo. Explain that a pre-import backup can be re-imported to recover the previous dataset. If the user proceeds without creating that backup, clearly warn **No pre-import backup was created** at the final confirmation; do not assume another backup exists. Explicit confirmation still permits Import without a backup.
- Check current authorization and the target's current identity / version when applying. If the target changed after preview, reject the stale apply and require a refreshed preview and explicit confirmation.

#### 9.4 Full Import / Replacement

- Atomically replace **current State and current History together**, including the associated portable Domain records. After success, the previous current dataset is not part of the new current dataset.
- Keep the target `workspaceId` and assign a fresh opaque `workspaceIncarnationId` as part of successful replacement. Reject pre-replacement mutation attempts and journal replay as stale; do not automatically replay or rebase them. Authorized recovery queries remain available under §8.4.1.
- Do not import source persistence identities as the target's active identities. Workspace replacement does not rotate the global `restoreEpoch`.
- Imported Activity retains its role as Domain History. It does not prove that a logical operation committed on the current Server and must not be used as an Operation Receipt.
- Import does not restore sharing authority from the file. Target access remains governed by current app-managed authorization.
- Ordinary Domain Undo does not undo Import. Re-importing a backup is another full replacement, with validation, preview, confirmation, and a fresh `workspaceIncarnationId`.
- Keep commit-result recovery effective across replacement: retain the replacement operation’s own committed-result evidence rather than unconditionally discarding it with the replaced dataset. An authorized recovery query may confirm that operation and observe the new incarnation under §8.4.1, without replaying the old mutation or restoring the old dataset. Do not repeat Import as a new operation merely because confirmation was lost.
- Imported Spend records and Activity are Domain data for History / Receipt display only; **Import never restores Spend Undo eligibility**, even when an imported Spend is less than 24 hours old. Do not revive an Undo CTA from imported data. Re-importing the pre-import backup is the recovery path for replacement; that re-import likewise does not restore Undo capability.

#### 9.5 Reset and Deletion

Treat the following as distinct destructive operations; do not combine them under an ambiguous data-deletion action:

- **Reset Workspace contents**: Replace the selected Workspace's current Domain dataset, including History and Spend / Payment Records, with an empty valid dataset. Keep the same `workspaceId` and current access configuration; assign a fresh opaque `workspaceIncarnationId` atomically. Reset does not mean removing members.
- **Delete Workspace**: Remove the Workspace from normal use, including access to its dataset. For a Shared Workspace, explain that all members lose access, not just the person initiating deletion. Stale requests must not recreate it or restore access.
- **Account-wide / all-data deletion**: A separate account-lifecycle capability, outside the destructive scope defined here. Do not imply that resetting or deleting one Workspace performs it.

For Workspace destructive actions:

- Show the target Workspace, exact destructive scope, and consequences for other members.
- Preserve **two-stage confirmation**, including an explicit acknowledgement and typed confirmation in the Danger zone.
- Require current authorization for that destructive scope; ordinary editing capability is not itself a specification of management authority.
- Offer Export before discarding the current dataset. Refresh confirmation if the target changes before apply.
- Same-ID full replacement / reset must fence old mutations with a fresh `workspaceIncarnationId` while preserving recovery-query access to retained committed-result evidence under §8.4.1. Deletion must deny subsequent access and mutations even when a client retains old data or journals.
- Do not silently delete unresolved input as part of local cache cleanup. Mark it as belonging to a replaced or deleted context and prevent automatic submission.
- These operations affect only their stated target. Detailed permissions and account-lifecycle behavior, including the handling of deletion of a Personal Workspace, require separate Product / authorization design before being offered.

---

### 10. Operation Specification

All operations below are subject to the Server commit contract (§8). Validate the final result against §7 before committing. Domain adjustments within one accepted operation do not merge concurrent user mutations.

#### 10.1 Accounts and Assets

- Create Account in the selected Workspace
- Create Position in an Account of the selected Workspace (assetType / label / marketValue)
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
  - Updates within spending, Undo (10.4.1), and their required Domain adjustments (§10.6).
  - **Do not apply automatic recalculation in 10.5** (ensure consistency within the corresponding procedure).
  - Do not call 10.5 indiscriminately from a marketValue setter or similar implementation.

#### 10.2 Goals

- Create Goal in the selected Workspace (name / targetAmount / period / priority)
- Close Goal: `status = "closed"` (logical state only; do not physically delete)
  - Assign `closedAt` on closure
  - Closed Goals remain visible, and **Allocation editing remains possible**
  - Exclude closed Goals from **priority ordering** (only active Goals form that ordering)
  - On reopening (closed → active), assign **the last priority among active Goals** (e.g., current maximum priority + 1)
    - `closedAt` may be removed on reopening (retaining it as history is at implementation discretion, but reduction order must remain deterministic)
- Goal deletion follows 11.4

#### 10.3 Allocations (Reservations)

- Set `allocatedAmount` from Position → Goal within the selected Workspace (add / update / delete)
  - Because **(positionId, goalId) is unique**, treat allocations as **upserts (update if present; create otherwise)**
  - Treat `allocatedAmount = 0` as **Allocation deletion**
- Changes must satisfy the constraints (`Position: total allocations ≤ marketValue`, `Goal: total allocations ≤ targetAmount`)

**Absolute Allocation Editing (Required)**

- Edit `allocatedAmount` as a new absolute value, not an increment. Apply the same validation in Goal and Account / Position editors.
- Conceptually, calculate capacity by excluding the Allocation currently being edited from both sums:
  - `otherGoalAllocations = Σ Allocations(for the same Goal, excluding the edited Allocation)`
  - `goalCapacityForThisAllocation = Goal.targetAmount - otherGoalAllocations`
  - `otherPositionAllocations = Σ Allocations(for the same Position, excluding the edited Allocation)`
  - `positionCapacityForThisAllocation = Position.marketValue - otherPositionAllocations`
- Require a nonnegative integer input satisfying both `allocatedAmount ≤ goalCapacityForThisAllocation` and `allocatedAmount ≤ positionCapacityForThisAllocation`. For a new Allocation, no existing Allocation is excluded; the same definitions apply.
- The maximum absolute value is `min(goalCapacityForThisAllocation, positionCapacityForThisAllocation)`. `Remaining to target` means the Goal's incremental capacity (§7.4), not this maximum. In an Allocation editor, `Available` must identify the Position capacity for this Allocation, including its currently reserved amount; `Maximum`, if shown, means the combined absolute limit. Do not use current unallocated funds alone as the limit for editing an existing Allocation.
- Example: A Goal with target 100 has Allocations A=30 and B=30, so its remaining-to-target amount is 40. Editing A excludes A from the Goal sum, giving capacity `100 - 30 = 70`. Changing A from 30 to 50 is valid on the Goal side because `50 + 30 = 80 ≤ 100`, subject to Position capacity. Do not reject it because `50 > 40`.
- These capacities describe valid current data and aid input validation. The Server must validate the resulting totals under §7 and the current mutation contract (§8); an editor's capacity display is not a reservation or concurrency guarantee.

#### 10.4 Drawdown (Manual)

- For an operation to draw down X yen from a Goal, the user specifies the source Allocations to reduce (multiple selections allowed)
- Reduce those Allocations (not below 0)
- Do not automatically reduce Position.marketValue (the user reflects the actual balance separately through a valuation update)
- Allocation reductions through drawdown are independent of the automatic recalculation trigger in 10.5 (drawdown must not affect other Goals).

#### 10.4.1 Achievement → Withdrawal (Mark as Spent) (Required)

Provide an operation to mark a Goal as spent, reflecting actual use of the funds after achieving it.

- In the MVP, applies to closed Goals with no `spentAt`.
- Spending amount `X`: Total Allocations linked to this Goal.

**Procedure and Atomicity (Required)**

1. The user **selects Positions and specifies amounts** to pay `X`. Validate that the total equals `X` and each payment is within the Position's balance.
2. Reduce each specified Position's `marketValue` by its payment amount (total reduction: `X`).
3. **Delete all Allocations** linked to the Goal.
4. Record the Spend / Payment details and the preceding semantic state needed for eligible Undo.
5. Assign `spentAt` to the Goal (ISO8601).
6. If the resulting payment distribution causes a Position shortfall, apply the deterministic reductions and guidance in §10.6, preserving the final invariants.

Commit these effects, necessary Activity, and the Operation Receipt **atomically**, after Major adjustment confirmation if §10.6 requires it. A committed spent Goal has no Allocations.

Steps 1–5 express the requested Spend's direct effects. Deleting the target closed Goal's Allocations does not by itself make Spend Major. Classify any secondary automatic Allocation adjustments, such as reductions for other Goals in step 6, under §10.6.

These are **internal Domain adjustments** and must not trigger the valuation recalculation modes in §10.5. Required shortfall reductions may affect other Goals under §10.5.2 / §10.6; do not perform automatic redistribution to those Goals as though the payment were a valuation update.

**Editing Restrictions for Spent Goals (Required)**

- As a rule, Goals with `spentAt` cannot be edited, including their information and Allocations.
- Provide **Undo spend** for the **current Spend operation that established this Goal's current `spentAt`**, within **24 hours after that Spend committed**. This is the MVP grace period for accidental Spend.
- The Spend need not be the latest operation in the Workspace. Editing an unrelated Goal, navigation, closing a drawer, changing screens, or reloading the browser must not by itself remove eligibility.
- State that Undo applies only to the Goal’s current Spend within 24 hours in the UI. Determine eligibility from Domain information and current authorization, independently of Operation Receipt retention.
- Imported Spend has no Undo eligibility (§9.4), regardless of its recorded time; do not show its Undo CTA.

**Undo Spend (Required)**

- Validate that the target is still the Spend establishing the Goal's current `spentAt`, is not an imported Spend, and is within 24 hours of its commit. Execute under current authorization, restoreEpoch, workspaceIncarnationId, baseVersion, and Domain invariants (§8), including revalidation at confirmation when a Major proposal is required.
- Treat Undo as one Domain operation reversing that Spend's effects using its preceding semantic state, validated against the current world rather than blindly replacing it:
  - Restore Position values reduced by the Spend.
  - Restore Allocations deleted by the Spend.
  - Clear `spentAt`.
  - Restore any other Goal state changed by the Spend to its meaning immediately before that operation.
- This is an internal adjustment; **do not invoke valuation recalculation in §10.5**.
- Evaluate the proposed restoration against the current Workspace. Intervening valuation updates, target changes, or Allocation edits may mean that the unadjusted restoration no longer satisfies current constraints.
- Use deterministic Domain adjustments and summary / guidance under §10.6 to satisfy current Position and Goal limits. Intermediate calculations may violate a limit; committed Canonical State must not.
- Commit the final Undo result and associated Domain records / Activity atomically under §8. If Major adjustment is required, preview the result and obtain explicit confirmation under §10.6 before committing any Undo effects; do not commit an invalid intermediate State.
- A stale baseVersion still rejects the operation. Domain adjustment during Undo does not authorize automatic conflict merge or rebase.
- Import itself is not a Domain Undo operation (§9.4).

#### 10.4.2 Allocation Adjustments When Updating Goal.targetAmount (Required)

When Goal.targetAmount changes from `T_old → T_new`, resolve any excess if the total Allocations linked to that Goal exceed `T_new`.

- **Default behavior (required): Deterministic proportional reduction**
  - Shrink Allocations linked to the Goal (across multiple Positions) while preserving their current distribution ratios.
  - Handle remainders and tie-breaking deterministically (e.g., allocatedAmount descending → positionId ascending).
  - Follow §10.6 for commit timing: Minor reductions commit with the target change before the summary; Major reductions require preview and confirmation before either is committed. Show which Position changes by how many yen and provide a route to normal allocation editing (10.3).
- Do not provide additional reduction options (such as priority-based reduction); limit this to proportional reduction plus manual editing when needed.

#### 10.5 Allocation Recalculation on Balance Updates (Required)

##### 10.5.0 Applicability (Required)

- Apply 10.5 when `marketValue` changes through a **valuation update (user input)** (10.1.1).
- Exclude **internal adjustments** such as spending / Undo and their constraint adjustments from the triggers for 10.5.

##### 10.5.1 Overview

When Position.marketValue changes from `V_old → V_new`, recalculate Allocations linked to that Position according to `Position.allocationMode`.
(Changing allocationMode alone does not recalculate. Only valuation updates trigger these modes; internal adjustments use their own Domain rules.)

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
- **As a rule, retain existing Allocations for closed Goals** (do not automatically zero them).
  - Include closed Goals in shortfall reductions only after all active allocations have reached 0.
  - Spent Goals have no Allocations and are never distribution or reduction recipients. An existing Allocation to a spent Goal is an integrity violation (§13.5).

##### 10.5.2 Shortfall Resolution (All Modes / Required)

If `ΣAllocation(for that Position) > V_new`, reduce allocations until the excess is eliminated (not below 0).

- Reduction order (deterministic):
  1. **Lowest-priority active Goals first** (priority descending), with goalId ascending for ties
  2. Include **closed Goals** only if excess remains after all active allocations reach 0
     - Reduction order: Newest `closedAt` first (descending) → `goalId` ascending
       (If `closedAt` is absent, use a deterministic rule such as `goalId` ascending)

##### fixed (Default)

- Principle: Do not change Allocations.
- Reduce only when a shortfall exists (10.5.2).
- Goal target reductions follow §10.4.2. A Canonical integrity problem follows §13.5; it must not be silently corrected by a read.

##### ratio

**Overview (Required)**

- Retain existing closed-Goal Allocations as fixed reservations whenever the updated Position value can cover them. Exclude them from both the ratio denominator and ratio recipients; never increase them automatically.
- Spent Goals have no Allocations and do not participate.
- Scale the old **active-Goal Allocations and unallocated funds** within the pool remaining after closed reservations.
- Do not generate initial ratios automatically. The UI must explain that closed reservations are retained, existing active / unallocated proportions define the ratio, and any new pool without an existing ratio remains unallocated.
- In particular, increasing a zero balance does not create Allocations automatically.

**Definitions (For One Position)**

- `C`: Sum of its existing closed-Goal Allocations.
- `A_old(goal)`: Its existing Allocation to each active Goal.
- `U_old = V_old - C - ΣA_old(active)`: Its old unallocated amount.
- `B = V_old - C = ΣA_old(active) + U_old`: The old ratio pool.
- These values assume valid starting Canonical data. Handle invalid data under §13.5 rather than silently correcting it.

**When `V_new >= C`**

1. Retain each closed-Goal Allocation unchanged.
2. Set the new ratio pool to `P = V_new - C`.
3. If `B > 0`, calculate:
   - `A_new(goal) = floor(A_old(goal) * P / B)` for each active Goal.
   - `U_new = floor(U_old * P / B)`.
   - Distribute the remaining `R = P - (ΣA_new(active) + U_new)` one yen at a time among recipients with positive old amounts, in descending order of those old amounts (`A_old`, `U_old`). Break active-Goal ties by priority ascending, then goalId ascending; unallocated comes last among equal amounts. Closed Goals never receive a remainder.
4. If `B = 0`, no active / unallocated ratio exists: keep active Allocations at 0 and put all of `P` into unallocated funds. This also covers `V_old = 0`.
5. Clamp each active Goal's result to its receiving capacity `remaining(goal)` (§10.5.1). Return every yen removed by clamping to unallocated funds; do not redistribute it to other Goals.

**When `V_new < C`**

- Set all active-Goal Allocations and unallocated funds to 0.
- Reduce closed-Goal Allocations by a total of `C - V_new` using the closed-Goal reduction order in §10.5.2, without going below 0. Delete zero-yen Allocations.
- Because a closed reservation must shrink, this is a **Major adjustment**: preview and obtain confirmation before committing the valuation change and reductions (§10.6).

In either case, delete zero-yen Allocations and ensure `ΣA_new(closed) + ΣA_new(active) + U_new = V_new`, with nonnegative integer amounts and all Goal limits satisfied. Classify the proposed secondary automatic adjustments under §10.6 before committing, including ratio changes when there is no simple Position shortfall.

**Example**

For `V_old = 100`, closed reservations of 30, an active Allocation of 30, and unallocated funds of 40, an increase to `V_new = 200` keeps closed reservations at 30. The remaining pool is 170, scaled in the old ratio 30:40. Flooring gives active 72 and unallocated 97; the remaining yen goes to unallocated because its old amount (40) is larger. Final amounts are **closed 30 + active 72 + unallocated 98 = 200**.

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

#### 10.6 Minor / Major Domain Adjustments and Confirmation (Required)

When a normal Domain operation (valuation or target update, Spend, or Undo) requires secondary automatic Allocation adjustments, calculate and validate its proposed resulting State before committing. These rules do not authorize silent correction of corrupt Canonical data or automatic merge of concurrent mutations.

**Classification Scope (Required)**

- Distinguish the user's **direct requested effects** from **secondary automatic adjustments**. Minor / Major classification applies to the latter, not to the direct effects alone.
- Direct effects include a Spend's selected Position balance reductions, deletion of its target Goal's Allocations, creation of its Spend / Payment Record, and assignment of `spentAt`. User-entered Allocation changes in an Allocation editor are also direct effects, not automatic adjustments. Their ordinary validation and confirmation requirements still apply.
- Secondary automatic adjustments are Allocation changes automatically calculated in addition to those direct effects to satisfy Domain invariants or the applicable recalculation rules. Examples include valuation-triggered reductions or ratio recalculation, proportional reductions after a Goal target change, adjustments to other Goals caused by Spend, and adjustments needed to make an Undo restoration satisfy current invariants.
- **Affected Goals** means the distinct Goals whose Allocations change through the relevant secondary automatic adjustment, whether by an increase or a reduction. Do not count a Goal merely because the original operation directly targets it; count it if its Allocations also undergo a secondary adjustment.
- **Automatic reduction amount** means the sum of Allocation reductions caused by that secondary adjustment. Conceptually, `automaticReductionAmount = Σ max(0, beforeAllocation - afterAllocation)` over the relevant Allocations, comparing amounts immediately before and after the secondary adjustment, after accounting for direct effects. Treat absence as 0 for this calculation. Increases do not offset reductions, and the user's directly entered amount is not the reduction amount. This definition prescribes no data structure or implementation method.
- A ratio-mode valuation update can change or reduce Allocations even when `Σ Allocations ≤ V_new` and the simple Position shortfall is 0. Those changes are secondary automatic adjustments and participate in classification; zero shortfall does not mean no adjustment.

**Major Classification (Required)**

The following **common conditions** apply to relevant secondary automatic adjustments regardless of operation type. A proposed adjustment is Major if:

1. A secondary automatic adjustment must reduce an Allocation for a closed Goal by even 1 yen. Direct deletion of the Spend target's Allocations does not meet this condition.
2. The number of affected Goals, as defined above, exceeds implementation-defined `N`.

For **Position valuation updates only**, also classify the adjustment as Major when `automaticReductionAmount` exceeds implementation-defined `x% of V_new`, where `V_new` is that Position's post-update `marketValue`. Use the secondary Allocation reductions, including ratio-mode reductions, rather than the entered valuation change or simple shortfall alone.

Do not apply the percentage condition to Goal target updates, Spend, or Spend Undo. Their common Major conditions still apply; this specification defines no additional amount-based threshold or substitute denominator for those operations. Any such extension belongs to later Production Architecture / Domain Design.

Exact values of `N` and `x` remain at implementation discretion. An adjustment is Minor when none of the conditions applicable to its operation type is met.

**Minor: Commit, Then Summarize**

- Commit the original user mutation and its required deterministic secondary adjustment in **one atomic commit**, with the required Domain records, Activity, and Operation Receipt.
- After confirmed commit, show a change summary and provide a route to normal allocation editing (§10.3). Further user changes are new explicit operations.

**Major: Preview and Confirm Before Commit**

- **Do not commit the original mutation or its adjustments before user confirmation.** A preview is not a save or a partial commit.
- Calculate the proposed result from current Canonical State and user input, validate it, and open the drawdown / adjustment UI with an explanation of the required changes.
- Show the applicable deterministic result as the default proposal, including §10.5.2 for Position shortfalls, the ratio rules for ratio updates, and §10.4.2 for Goal target reductions.
- Let the user review / edit the proposal and explicitly confirm the resulting operation. Detect remaining invariant violations and request correction; do not automatically move Allocations to another Goal to make the proposal valid.
- On confirmation, journal the exact confirmed operation before submission and recheck current authorization, restoreEpoch, workspaceIncarnationId, baseVersion, and Domain invariants under §8. Operation identity and payload binding must reflect the confirmed input; changed input is not a replay of an earlier operation.
- Only then commit the **original requested change + confirmed adjustment atomically**, together with the required Domain records, Activity, and Operation Receipt.
- If the proposal became stale before confirmation, reject its application. Refresh current Canonical data and generate a new proposal for renewed user review / confirmation; **do not automatically rebase or commit a stale proposal**.
- Cancelling before submission leaves Canonical State unchanged. After submission, closing the UI does not cancel the operation; unknown-result recovery follows §8.4.
- This flow requires **no server-side pending draft**. A proposal can be recalculated from Canonical State and user input. Concrete API shapes and proposal representation are not prescribed.

**Explicitly State That Reductions Are Not Restored**

- Allocations reduced or deleted for closed Goals are not automatically restored by later balance increases or Position additions. Explain that manual allocation editing (§10.3) is required to re-add them.
- Spent Goals remain without Allocations unless an eligible Undo first reverses the Spend; do not offer re-allocation while a Goal remains spent.

**Context-Specific Guidance**

- Distinguish the summary of an already committed Minor adjustment from a Major proposal awaiting confirmation. Never apply reductions twice when reviewing a committed result.
- Explain the applicable calculation rules in the proposal where useful, such as lower-priority active Goals followed by closed Goals in deterministic order.

---

### 11. Deletion Policy (Required for Consistency)

These are Entity deletions within a Workspace, distinct from Workspace reset or deletion (§9.5). Commit each deletion and its required dependent changes atomically under §8. References to physical deletion describe removal from current Domain State, not a database schema or a policy for historical record retention.

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

### 12. Workspaces, Membership and Sharing

#### 12.1 Personal and Shared Access

- Personal data is private to its authorized user. Sharing applies to Shared Workspaces containing shared pool Accounts, Positions, Goals, and Allocations.
- Support multiple Shared Workspaces and app-managed membership. Use `workspaceId` to identify a context; names, local selections, URLs, and cached role labels do not grant access.
- Display `Can edit` or `View-only` for the selected Workspace. View-only permits authorized viewing but disables mutations, including Import and reset.
- Check current authorization on the Server for every operation, including State / History reads, receipt lookup, Export, and management actions. Sharing and destructive management authority must be defined separately from ordinary edit capability.
- Provide Workspace creation, selection, and membership-management entry points in Settings. Distinguish Workspaces shared by the user from those shared with the user where that relationship is known.
- Creating a Workspace does not automatically share it. Joining or inviting must establish app-authorized membership; possession of an arbitrary URL is not permission.
- When access is revoked, the Server must deny subsequent unauthorized operations. On learning of revocation, the browser must stop presenting that Workspace as accessible, disable edits, and prevent late responses from restoring it. Retained input is not authority to resend.
- A cached offline view cannot prove that access is still current. Network disconnection alone cannot ensure immediate remote erasure of copies already held by a browser; recheck access when reconnecting.
- Availability, retention, invalidation, and removal of Shared cached data across explicit sign-out, account switch, authentication expiry, and confirmed authorization loss must align with Production Auth / Identity / Privacy design. This specification does not guarantee continued offline display after sign-out or choose a cache lifecycle or encryption mechanism.
- Authentication, identity linking, invitation mechanisms, role-management details, and account lifecycle are separate design decisions. No particular login service, invitation token format, or account-linking workflow is required here.

#### 12.2 Authorization after Restore

- PITR may revive revoked membership, old roles, invitations, deleted Workspaces, deleted accounts, or obsolete account links. Do not resume production-authoritative access from those restored records without reconciliation.
- **Shared access must remain fail-closed after restore** until a trusted Owner identity is re-established and sharing is reconciled with appropriate operator confirmation. A restored Owner record alone is insufficient evidence.
- A newly authenticated user who obtains the new restoreEpoch must not thereby regain access through revived authorization records.
- Hold affected access and mutations behind the restore gate. Establish safe session invalidation / reconciliation so old or newly created sessions cannot bypass that gate.
- Reconstruct sharing from trustworthy confirmation before releasing a Workspace. Release must be specific to the reconciled Workspace; it must not implicitly release unrelated Workspaces.
- Concrete Owner verification, session handling, and authorization-reconciliation procedures remain Production design responsibilities. This requirement does not mandate an independent authorization ledger.

---

### 13. Browser Cache, Synchronization and Recovery

#### 13.1 Startup, Resume, and Workspace Switching

- On browser restart, treat cached State and access information as **unverified**. Verify current access, restoreEpoch, workspaceIncarnationId, and Canonical State with the Server before enabling editing.
- On resume or reconnect, refresh the selected Workspace and reconcile unresolved operations before allowing stale context to be used for new mutations.
- Offline, allow view-only use of available cached data with a freshness limitation, subject to the identity / access lifecycle policy in §12.1. When no valid cache is available, explain that an online connection is needed to load data.
- Remembered Workspace selection is a preference. If it is no longer accessible, explain that state and offer another authorized selection without treating it as an empty Workspace.
- Keep cache, journal entries, and editor input associated with their originating Workspace and identity. Switching Workspace must not move or submit an operation in the new context.
- Responses for a previously selected Workspace must not overwrite the active screen. Any retained data for another Workspace remains subject to its own identity and authorization checks.

#### 13.2 Editing and Journal Protection

- Editing is online-only and requires current edit access. Disable inputs and mutation controls while offline, view-only, or blocked by maintenance / integrity / access verification.
- Confirmed user actions create logical operations. Retain each operation under §8.3 before HTTP transmission; do not continuously send while typing.
- Preserve unsubmitted input where possible when connectivity or access changes. Distinguish it from a submitted operation whose outcome is unknown.
- The journal survives ordinary reloads when browser storage remains available. It is not an offline collaborative editing queue and must not collect offline mutations for automatic synchronization.
- Never silently discard unresolved operation identity or exact input merely because a response was lost, a refresh occurred, the Workspace changed, or cache recovery ran.
- Once a result is resolved, journal bookkeeping may be retired. If input is no longer applicable, present it as retained input for review, copying, or explicit discard rather than current Canonical data.
- No server-side pending draft is created to implement this protection.

#### 13.3 Canonical Adoption and Timeline Fences

- Adopt restoreEpoch or workspaceIncarnationId only through a verified Server response for the relevant context. Identities are opaque; do not order them lexically or infer a transition from local preferences.
- After adopting a new identity, **do not adopt delayed old-identity GET / State, History, Operation Receipt, or mutation responses into cache or UI**, including responses from requests issued before the transition.
- This fence concerns the response’s Canonical observation context. It does not prohibit a currently authorized recovery query about an operation from an old epoch / incarnation. A verified current observation may report that operation’s retained historical result separately from current State (§8.4.1); historical lookup must not restore an old Canonical identity / version or authorize mutation replay.
- A late response must not restore an older identity. Freshness / request-context verification must distinguish a verified transition from a delayed response; merely receiving an authenticated response is not enough.
- Within the same Workspace, epoch, and incarnation, never replace adopted Canonical State with an older version. A response confirming an earlier commit does not justify rolling back the displayed State.
- Apply these rules across open browser contexts / tabs as they learn of a transition. Browser restart requires Server verification rather than trust in stored identity alone.
- On an identity transition, stop displaying the old dataset as current and invalidate old History and result views. Reconcile access before exposing replacement data.
- Editor input may be retained separately for user recovery, but editing in progress cannot postpone the timeline fence. Never automatically rebase or resend old journals or drafts onto the new timeline.
- Access revocation, Workspace deletion, and restore quarantine must also prevent late responses from re-enabling access, regardless of version ordering.

#### 13.4 Conflicts and Unresolved Outcomes

- Use §8.4 to distinguish success, rejection, and unknown. Timeouts must not automatically roll back Canonical State or declare the logical operation failed.
- On stale-write rejection, refresh Canonical data, preserve the user's input separately, and explain the conflict. Do not automatically merge or submit the input against the new version.
- If another attempt may have committed, use the authorized recovery flow to observe current Canonical coordinates and retained operation results (§8.4.1–§8.4.2). Stale client coordinates do not block that read. Replay remains subject to mutation acceptance; do not claim non-commit from receipt absence or refreshed State alone.
- Explicit user review may lead to a new operation against the latest State. Preserve the distinction from replaying the original logical operation.
- Old epoch / incarnation journals remain stale even if their operationIds are known. Retaining input does not grant permission to submit it again.
- Mutation retry and backoff must preserve logical-operation identity and respect access, version, and timeline gates. Recovery reads respect current access without requiring the client’s old coordinates to match.

#### 13.5 Integrity and Cache Recovery

- **Domain adjustment**: Apply the deterministic rules of §10 as part of an accepted operation and validate its final State. This is normal Domain behavior, not corruption recovery.
- **Canonical integrity problem**: If Server Canonical data violates §7, detect and explain the problem, prevent unsafe normal mutations, and direct the user toward explicit recovery. Do not silently alter Canonical data during reads, remove broken references, or clamp invalid values merely to make a read succeed. Specific recovery tooling is not prescribed.
- **Client cache recovery**: Invalid or corrupt cached data may be discarded and rebuilt from verified Server Canonical data without an extra confirmation. Clearing this cache must not silently clear the Unresolved Operation Journal or editor input.
- **Invalid Import**: Reject it under §9.3 before preview / apply; do not silently adjust the file into a valid dataset.
- Following loss of all browser storage, authorized users must be able to bootstrap committed Canonical data from the Server. Recovery of uncommitted input and lost operationIds is best effort and cannot be guaranteed.
- Ordinary cache refresh is not a data reset and must not create an empty Workspace or initiate Canonical writes.

---

### 14. Quotas / Abuse Prevention (Design Policy)

- Protect service availability with appropriate limits on Workspace count, Entity count, Activity volume, mutation / lookup traffic, and Import / Export size and resource use.
- Set concrete thresholds through Production design and measurement; this specification assigns no numerical quota.
- Enforce limits at trusted boundaries, including concurrent create / delete operations and bulk Import. Rejection must not leave a partially applied dataset.
- Explain quota or throttling failures and the next useful action. Temporary retries must use bounded backoff and respect the same-operation and unknown-outcome rules.
- Paginate History and bound resource consumption without discarding required History or conflating Activity retention with Operation Receipt retention.

---

### 15. Outside MVP Scope (Unsupported)

- Real-time collaborative editing, CRDTs, and automatic conflict merging or rebase
- Offline editing and general-purpose offline mutation synchronization
- Full Event Sourcing as a persistence contract
- Server-side pending drafts and mandatory editing-presence UI
- Sharing personal assets with others (sharing outside Shared Workspaces)
- Automatic exchange-rate or asset-price retrieval (conversion is manual)
- Strict accounting journal entries (complete separation of deposits / gains and losses / withdrawals)
- Anonymous editing without sign-in

---

### 16. Explicitly Delegated Design and Implementation Decisions

- UI / navigation / wording / layout details within the shared interaction contracts
- State management, scheduling, and browser storage representation within the required IndexedDB cache / journal and timeline behavior
- Domain object / aggregate boundaries, command design, and transaction implementation that preserve the Product invariants and atomicity requirements
- Logical relational model, schema, constraints, indexing, physical naming, and API design
- Activity and Spend / Payment Record representation, keeping their responsibilities separate from Operation Receipts
- Production authentication, identity / account lifecycle, invitations, Owner verification, session invalidation, and authorization reconciliation, subject to §12
- Receipt retention, backup / RPO, restore procedures, monitoring, and performance design, subject to honest outcome reporting and the restore gates
- Format evolution and internal schema migration as separate concerns
- Exact values of thresholds `N` and `x` in §10.6
- Handling `closedAt` on Goal reopening (remove / retain), with deterministic reduction ordering

Delegation does not permit weakening atomicity, Server validation, current authorization, input protection, or timeline rejection. Production platform validation remains necessary; the requirements here are not a claim that every browser, network failure, or recovery procedure has already been verified.

**Priorities When Unsure**

1. Least privilege and privacy
2. Avoid data loss and preserve unresolved input without misrepresenting commit certainty
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

This chapter defines notifications and status displays shared across all screens. Saving and recovery must use Part I §8 and §13; individual screens must not redefine commit certainty.

### 1. Notification UI Types (Consistent)

- **Toast (brief display)**
  - Lightweight feedback for confirmed saves, minor adjustments, and connectivity changes.
  - Position: Bottom center, consistently across desktop / mobile.
  - Auto-dismiss after a few seconds; allow longer when an action is included.
  - At most one action (e.g., `Review` / `Check status`).
- **Dialog (blocking)**
  - For conflicts, access changes, destructive actions, or recovery requiring a user decision.
  - Present what is known, the affected Workspace / input, and a useful next action.
  - Do not claim changes were lost or never saved unless that conclusion is supported.
- **Inline display**
  - Validation errors, explanations of disabled controls, and retained-input review.

Do not adopt persistent MessageBar-style banners in the MVP. Important unresolved outcomes must remain discoverable through status and Connection health after a Toast is dismissed.

### 2. Connection and Save Status Signal (Shared)

- Always show the selected context's status:
  - **Desktop: Bottom of the left sidebar**
  - **Mobile: Right end of the header**
- Use **a circular dot + short English wording**. Change the dot color, not the text color; do not add icons.
- Activate the status area to open `Settings > Connection health` (`/settings#connection-health`).
- Distinguish connectivity, current access, verification / maintenance, and operation outcome. One status label must not imply that every operation has succeeded.

Suggested wording and color mapping:

| Wording | Meaning | Dot |
| --- | --- | --- |
| `Online` | Connected with a verified, usable context; not proof of an individual save | Green |
| `Checking…` | Verifying data or access | Yellow |
| `Saving…` | A confirmed user operation is being submitted / resolved | Yellow |
| `Sign-in required` | Authentication action is needed | Yellow |
| `View-only` | Current access permits viewing, not editing | Yellow |
| `Offline` | Server verification / saving is unavailable | Red |
| `Outcome unknown` | A submitted operation has no confirmed outcome | Yellow |
| `Review needed` | A conflict, rejected input, or integrity problem needs attention | Red |
| `Access unavailable` | Access was revoked or the Workspace is unavailable | Red |
| `Recovery in progress` | A maintenance / restore gate prevents normal use | Yellow |

- Prioritize the condition restricting the current action, while showing unresolved operations separately in Connection health. Offline or revoked access must not hide their existence.
- A Workspace switch changes the status context; retained input for another Workspace stays associated with that Workspace.
- `Last verified` describes the latest successful Canonical verification. A last-confirmed-save time, if shown, must be labelled separately. Neither claims that an unresolved operation failed.

### 3. Offline and View-Only Handling

- Disable editing controls when offline or View-only. Explain the reason near the controls or through an accessible status description.
- Show a one-time Toast on transition to offline, for example `Offline: viewing cached data. Editing is unavailable.`
- Retain in-progress input where possible; an operation submitted before the transition may still have an unknown outcome.
- Cached content must be identifiable as cached / unverified when applicable. No cache means data cannot be shown until an authorized online load succeeds.
- When access is revoked or restore quarantine applies, do not present it as ordinary View-only access. Follow §12 and §13 before showing the Workspace again.

### 4. Save Results, Conflicts, and Recovery

- **Confirmed success**: Show completion only after a verified commit result. Resolve the matching input / journal without replacing newer Canonical State with an older response.
- **Explicit rejection**: Explain the rejected attempt and retain correctable input. If another attempt may have committed, show that uncertainty and provide result checking.
- **Unknown outcome**: Say that saving could not be confirmed. Provide `Check status` and retained-input review; do not label it automatically as failed or start a new logical operation as a retry.
- **Conflict**: Refresh Canonical data, show a Dialog explaining the stale write, and preserve input separately. A user may review and explicitly apply intent as a new operation; there is no automatic merge / rebase.
- **Safe retry**: An action replaying the same operation uses its original identity and payload. Disable it when access, epoch, incarnation, or other safety conditions no longer permit replay, with a visible explanation.
- Retained input must remain reachable even if an editor closed when submission started. Label it as unconfirmed / unapplied as appropriate; do not display it as committed State.
- A History read failure after a confirmed save must offer History reload without submitting the mutation again.
- Normal refresh / cache recovery must preserve unresolved journals. Explicitly discarding retained input does not cancel or undo a potentially committed Server operation.

---

## Mazemaze Piggy Bank: Autosave Specification (UI Requirements)

### 1. Policy

- As a rule, editing operations **autosave per confirmed operation**. When Domain validation requires a Major adjustment, defer committing the original change until the user confirms its proposed result (§10.6); initial input confirmation alone is insufficient.
- Do not continuously save while typing. Confirmation may be Enter, Blur, or an explicit action according to the screen requirements.
- Journal the operation before HTTP (§8.3). Local optimistic presentation, if used, must remain distinguishable from confirmed Canonical data.
- Follow the shared status and result contract; network connectivity is not save confirmation.

### 2. Save Triggers (UI Perspective)

- Goal: Create / update / close / reopen, change priority, confirm Allocation changes, remove all Allocations, confirm Spend, confirm Undo spend.
- Position: Create / update / delete, confirm valuation, change Recalc Mode.
- Account: Create / update / delete.
- Workspace management actions use their own explicit confirmation and authorization requirements. Scope / Workspace selection is a navigation preference, not an asset mutation.

### 3. UI Feedback

- Save starts: Show `Saving…`.
- Confirmed success: Indicate completion and update the relevant verified data / timestamps. Frequent success Toasts may be suppressed.
- Rejection or conflict: Explain the cause and preserve input for review under the shared contract.
- Unknown: Expose the unresolved outcome and recovery actions; do not silently discard input, claim failure, or hide it behind `Online`.
- Operations confirmed as committed must survive browser reload by reloading Canonical data from the Server, subject to explicit later deletion / replacement and the database restore policy.

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
- History displays the selected Workspace's current Domain Activity. Explain loading, failure, and cached / unverified display where applicable; technical storage details are not required in the UI.
- Apply the same access and timeline fences as State (§13.3), including late History responses and pagination. After replacement, do not combine previously loaded History with the replacement History.
- Activity and the Goal Receipt view are Domain information. Neither is the Operation Receipt lookup used to resolve a submitted mutation.
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

This chapter defines feedback for Minor adjustments already committed and Major adjustment proposals awaiting confirmation, following Part I §10.6.

Classify secondary automatic Allocation adjustments under §10.6, not the original operation's direct requested effects. Count distinct Goals changed by those adjustments; a normal Spend's direct deletion of its target closed Goal's Allocations alone does not require a Major proposal.

### 1. Terminology

- **Minor**: Meets none of the applicable Major conditions in §10.6; the original mutation and deterministic adjustment commit atomically before the summary.
- **Major**: Meets a Major condition in §10.6; neither the original mutation nor the adjustment commits until the user explicitly confirms the proposal.

### 2. Minor Adjustments (No Applicable Major Condition)

- After confirmed atomic commit, show a **Toast**:
  - Icon: ⚠️ (caution)
  - Wording: A short summary, e.g., `Allocations adjusted automatically.`
  - Action: `Review`
- `Review` opens a **change Summary**:
  - Desktop: Modal or drawer, consistently across the app.
  - Mobile: Full-screen sheet / overlay.
- Show the affected Goals / Positions and committed differences. Make clear that no immediate action is mandatory.
- Provide **OK/Close** and **Open adjustments** (the drawdown / adjustment UI). Any subsequent edits are new operations; reviewing the result must not reapply its reductions.
- Show this summary guidance when the Domain change occurs, without a persistent entry point to reopen the summary. History / Activity supports later discovery.

### 3. Major Adjustments (Applicable Major Condition Met)

- Open the drawdown / adjustment UI **before committing any part of the requested change**. Explain why confirmation is required and label the displayed result as a proposal, not saved data.
- Show the original requested change together with its suggested adjustments. Let the user review / edit, cancel, or explicitly confirm the complete result.
- Do not display a save-success Toast or show proposed effects as committed Canonical State before confirmation and successful commit.
- Confirmation applies the normal journal, authorization, identity, version, and invariant checks (§8 / §10.6), then atomically commits the original change and confirmed adjustments.
- On stale confirmation, retain input separately and offer a refreshed proposal for renewed confirmation. Do not automatically rebase or apply it.
- No server-side pending draft is required. Cancelling before submission leaves Canonical State unchanged; unresolved submitted operations use the shared recovery UI.

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
- **Scope switching**:
  - Switch between `Personal` / `Shared`. When Shared is selected, show a dropdown directly below for the shared context name (family, team, etc.).
  - When Personal is selected, disable the shared workspace dropdown and
    show `Switch to Shared to choose a workspace` to prevent mistakes (do not show the selected value).
  - When Shared is selected, append access status to the selected workspace name (e.g., `Family budget (Can edit)` / `Family budget (View-only)`).
  - Do not repeat the Workspace name / identifier at the top of Shared screens when the scope selector already establishes the context.
- **Currency display**:
  - Internal currency is fixed to JPY (converted to yen, integer).
  - Even in the English UI, use `¥` and `,` separators consistently.

---

### 3. Desktop: Dashboard Specification

#### Layout Structure

- **Fixed sidebar (left: 280px)**:
  - Top: Scope switching & shared context selection.
  - Middle: Navigation (Dashboard, Accounts, Goals, Settings).
  - Bottom: Connection and save status, following the shared status contract.
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
  - Place connection and save status (circular dot + short wording) at the right end; tapping opens Connection health in Settings.

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
- **Workspace navigation**: Preserve the selected Workspace context in Goals / Accounts navigation and deep links using app-managed Workspace identity. Keep selection parameters as the URL SSoT. A URL does not grant access; validate the destination context and avoid applying responses from a previously selected Workspace.
- **Scrolling**:
  - Avoid nested scrolling within the desktop main view (such as scrolling only within the Accounts list); always use whole-page scrolling.
- **Conflicts and unresolved saves**:
  - Follow the shared result contract: refresh Canonical data, preserve input separately, and require explicit review before applying it as a new operation. Do not automatically merge or infer failure from a timeout.
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
- **Allocation validation**: Account / Position Allocation editors use the absolute-value capacities in Part I §10.3, excluding the edited Allocation from both the Position and Goal sums. Use the same `Available`, `Remaining to target`, and `Maximum` meanings as the Goal editor; enforce both resulting totals under §7.4.
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
  - **Caution**: After a committed Minor allocation adjustment, show ⚠️ with `Review`. A Major adjustment opens its proposal before commit under §10.6.
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
  - On confirming `Add account` / `Add position`, retain the operation in the journal before submission. The drawer may close while saving, provided status and retained-input recovery remain available if the outcome is unresolved.
- **Update (valuation)**:
  - Use inline editing by clicking directly on the valuation cell.
  - Confirm with `Enter`; cancel with `Esc`.
  - Show the hint only the first time: `Enter to save · Esc to cancel`
  - Consolidate instructions in the ⓘ beside the heading: `Enter to save · Esc to cancel` / `JPY integer only.`
  - Start autosave on `Enter` confirmation, subject to §10.6: a required Major adjustment pauses before commit for proposal review and explicit confirmation.

#### Position Editing from Goals (Deep Link)

- When navigating from `Edit position` in Goals, Accounts restores the target drawer state from the query.
  - Example: `drawer=position&positionId=...&accountId=...&returnGoalId=...&returnTab=allocations`
- If `returnGoalId` is present, show `Back to goal` in the Position detail drawer.
- If `returnGoalId` is present, Close actions (Close button / overlay / Esc) return to Goals.
- Keep the `Save position` label unchanged as `Save position`.
  - On save success, close the drawer and return to Goals through the same Close handler.
  - On rejection or unknown outcome, keep the drawer open with retained input and the appropriate correction / result-checking action. An unknown outcome is not an instruction to resubmit changed input.
- For unsubmitted input, show a discard-confirmation dialog when using `Back to goal` or Close (`Discard changes and go back` / `Stay`). Leaving the editor must not silently remove a submitted unresolved journal entry or imply that its Server operation was cancelled.

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

- In desktop Accounts, submit the following confirmations under the journal and access contract (confirmed commits must survive reload under the restore policy):
  - `Add account` / `Save account` / `Delete account`
  - `Add position` / `Save position` / `Delete position`
  - `Enter` in Value inline editing

#### Save Results / Conflicts / Disabled States

- **Confirmed success**:
  - Return the inline cell from `Saving…` to its normal display using eligible Canonical data.
  - Update the shared status without flooding the UI with success Toasts.
- **Rejection**:
  - Explain the cause, retain input for correction, and check any uncertainty about another attempt before presenting the operation as uncommitted.
- **Unknown**:
  - Preserve the operation / input and offer result checking. Do not automatically roll back or retry as a new operation.
- **Conflict**:
  - Fetch eligible latest data, keep the local input separately, and show a Dialog. No automatic merge or rebase.
- **Offline / View-only / unavailable access**:
  - Disable `Add / Edit / Delete / Inline edit` and explain the condition under the shared status contract.

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
- Attempt to save additions on confirmation; confirmed commits must survive reload under the restore policy (follow Autosave and Part I §8 / §13).

#### Editing Entry Points and Save Feedback

- Tapping a Position card opens `Position detail`.
- Perform edits such as valuation updates and recalculation-mode changes in `Position detail`.
- Follow shared save-feedback requirements:
  - Confirmed success: Update data and status (suppress success Toasts for frequent operations)
  - Rejection / unknown: Explain the result, retain input, and offer correction or result checking as appropriate.
  - Conflict: Fetch eligible latest data + preserve input separately + Dialog notification; no automatic merge / rebase.
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

A Goal belongs to the selected Workspace; Personal / Shared comes from that Workspace (§7).

- `id`: string
- `name`: string (Goal name)
- `targetAmount`: number (JPY integer)
- `priority`: number (Order; integer starting at 1)
- `status`: "active" | "closed"
- `spentAt?: string(ISO8601)` (used to determine whether the Goal is spent)
- UI: Make history accessible through `History` (persistent-flag warnings are not mandatory).

### 3. Business Logic & Constraints

- **Allocation limit**: Always maintain `sum(AllocatedAmount) <= Goal.targetAmount`.
- **Closed / Spent Allocations**: Closed Goals may retain Allocations. Spent Goals must have none; disable allocation editing and add-allocation actions until an eligible Undo reverses the Spend.
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
  - When asset valuation decreases and Allocations need adjustment, show a summary after a Minor commit or a proposal before a Major commit, following §10.6 and the Automatic Adjustment UI chapter.
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
  - For a non-imported current Spend, show `Undo spend`; enable it only within 24 hours of that Spend commit and with current access / Domain eligibility. Explain unavailability. Do not show an Undo CTA for imported Spend.
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
  - Enable `➕ Allocation` (Add allocation) only in the Goal detail `Allocations` tab for an editable, unspent Goal with online edit access.
  - Outside that context, disable it and show a short explanation in the same menu (e.g., `Open a goal to add allocations.`).
- **Input method**: Use the standard system keyboard through `inputmode="numeric"`.
- **Mode switching**: Use in-place editing, replacing display text with editable fields through buttons in the detail screen.
- **History**: Access `History` from Goal details (full-screen sheet / overlay).
- **Tap targets**: Give chips / small buttons / menu items sufficient padding to reduce mistaps.

#### 4.3 Scope and Sharing Display

- **Asset labels**: Within Shared scope, identify the contributor using a Domain attribution label such as `[CreatorName] AssetName`. This label is not membership evidence or authority; identity representation is delegated to Production design.
- **Shared Goals**: Scope selection already filters them, so a sharing marker is generally unnecessary on individual screens. Do not adopt mixed-scope displays.

### 5. Primary Interactions and Navigation

#### 5.1 Adjusting Allocations (Absolute-Value Input)

- The Allocations tab lists only Positions with **allocated > 0** (avoid listing many unallocated Positions).
- Add primarily through `➕ Allocation` in the FAB (no permanent form).
- On desktop, a single `+ Add allocation` may appear at the upper right of the Allocations tab.
- When there are no allocations, an `Add allocation` CTA may appear in the Allocations tab's Empty state for an editable, unspent Goal. Access and offline restrictions still apply.
- On mobile, do not duplicate `+ Add allocation` outside Empty state.
- Each allocation row shows:
  - `Available ¥X`: the Position capacity for this Allocation (`positionCapacityForThisAllocation` in Part I §10.3), including this Allocation's current amount.
  - `Allocation (JPY)` input (the new absolute value, initially the current value).
  - `After change: Unallocated ¥Y` (only while editing), where `Y = positionCapacityForThisAllocation - entered absolute value` for valid input.
- If shown, `Remaining to target` is the Goal's current incremental capacity, while `Maximum` is `min(goalCapacityForThisAllocation, positionCapacityForThisAllocation)`. Do not use the remaining-to-target amount as the upper bound for an existing Allocation's absolute value.
- Each row shows `✏️ Edit` (small / secondary), invoking the Goals → Accounts deep link.
- Constraints:
  - Exclude the edited Allocation's current amount from both capacity sums under Part I §10.3; for a new Allocation, there is no existing amount to exclude.
  - `0 ≤ allocatedAmount ≤ positionCapacityForThisAllocation` (`Available`).
  - `allocatedAmount ≤ goalCapacityForThisAllocation`.
  - After the change, total Allocations for the Goal must be `≤ Goal.targetAmount`, and total Allocations for the Position must be `≤ Position.marketValue`.
  - Integer JPY only.
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
- Place `Undo spend` in the same header location for a Goal’s non-imported current Spend. Imported Spend has no Undo CTA.
- Explain in Receipt or details that Undo targets the Spend establishing this Goal’s current `spentAt`, within 24 hours after its commit. Unrelated operations, navigation, drawer close, screen changes, or browser reload do not remove eligibility. Revalidate current access, persistence identity / version, and Domain constraints when executing Undo; follow §10.6 if Major confirmation is needed.

#### 5.3 History / Receipt

- `History` shows the most recent N items within the tab and fetches more through `Load more`.
- Do not adopt a two-step `Open history` flow (tab → button → separate container).
- Show `Receipt` only for Goals with spentAt, presenting the Spend / Payment Record breakdown and date / time as view-only. This long-lived Domain view is independent of idempotency / committed-result Operation Receipts. Imported Spend records remain displayable here without Undo capability.

#### 5.4 Feedback (Toast / State)

- Suppress success Toasts for frequent operations; use the shared connection and save status contract, including unresolved outcomes.
- After a committed Minor adjustment, `Review` may navigate to its summary / Allocations tab. Major adjustments open the proposal UI before commit and require explicit confirmation (§10.6).

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
  - On rejection or unknown outcome, neither close the drawer nor return to Goals automatically; keep input and the appropriate recovery action available.
- Treat `Back to goal` as leaving the editor; confirm discarding unsubmitted input. It does not cancel or undo a submitted operation, and unresolved journals must remain available through recovery UI.

#### 5.6 Routing & State Restoration (URL SSoT / push-replace)

- Use URL query parameters as the SSoT for Goals selection state.
  - Always represent `goalId` in the query (if absent, supply the default Goal through `replace`).
  - Represent `tab` in the query as `details / allocations / history / receipt`.
- Use `replace` for selection changes within the same page (`goalId` / `tab`).
- Use `push` for page navigation (Goals → Accounts, Accounts → Goals).
- Query synchronization is derivation-only; do not roll back selection through delayed query → local-state synchronization.

#### 5.7 Stale-While-Revalidate (Avoid Delays When Returning)

- Default Goals / Accounts to immediate display of eligible local data plus background revalidation, with cached / unverified status when applicable.
- Within a valid context, avoid clearing detail panes unnecessarily when returning; use non-blocking feedback such as `Refreshing...`.
- Preserve editor input separately from Canonical data. Within the same identity, refreshed data must not overwrite the user's draft; a later submission must still satisfy concurrency checks.
- Editing in progress must not delay adopting a verified new restoreEpoch / workspaceIncarnationId or acknowledging revoked access. Stop treating old data as current, invalidate old History / Receipt views, and apply §13.3.
- Never roll back to an older Canonical version within the same identity. Do not automatically rebase or submit retained input after revalidation.
- Preserve return navigation through `returnGoalId` / `returnTab` when the destination remains valid and accessible; otherwise explain why it is unavailable.

---

## Mazemaze Piggy Bank: Settings Screen Specification

### 1. Overview and Design Concept

- **Role**: Manage sign-in / access, Workspaces, connection and save recovery, and data portability.
- **Design**: Warm Precision. Based on Fluent UI, with Butter yellow (`#F6E58D`) accents.
- **UI structure**:
  - Desktop: Single-column card layout limited to 800px wide.
  - Mobile: Two-line category items opening a full-screen Overlay (Sheet / Modal), synchronized with the URL hash.
  - Summarize state through title + subtext; keep lengthy errors inside details.
  - Do not provide a redundant card containing only the Settings title / description.
- **Information architecture (top to bottom)**:
  1. `Sign-in & access`
  2. `Connection health`
  3. `Workspace`
  4. `Data & portability`
  5. `Appearance`
  6. `Advanced / Diagnostics`
  7. `Danger zone`

### 2. Sign-in & access

- When signed out, explain that signing in is required to load authorized Server data and edit. State that data is stored by the app and can be exported.
- When signed in, show the current user identity and selected Workspace access without implying that login alone grants Workspace membership.
- Provide explicit sign-in / sign-out actions appropriate to the eventual authentication design. Do not fix a login service, account-linking flow, or invitation mechanism here.
- Do not launch interactive authentication automatically from startup, background refresh, or error recovery. Handle cancellation and errors without leaving the UI indefinitely busy.
- Distinguish a transient network failure from a need to sign in; avoid sign-in prompts while offline or immediately after deliberate sign-out.
- Sign-out must stop authenticated use of the current context. It must not be presented as deleting Server data, undoing a submitted operation, or confirming its outcome.
- Retained input and browser-cache visibility across sign-out / account changes require an explicit privacy and identity-lifecycle policy in Production design; do not silently transfer them to another identity.

### 3. Connection health

- Show current connectivity, verification / access restrictions, and unresolved save status under the shared status contract.
- Show `Last verified` as relative time with absolute time available in details. Distinguish it from any last-confirmed-save timestamp.
- Provide appropriate recovery actions:
  - `Refresh data`: Recheck authorized Canonical data; preserve journal entries and input.
  - `Rebuild cache`: Discard rebuildable cached data and reload from the Server; preserve the unresolved journal and input. Disable online rebuild when the Server is unavailable and explain why.
  - `Check operation status`: Use the authorized recovery flow to observe current Canonical coordinates and the unresolved operation’s known result, even when its original epoch / incarnation is stale (§8.4.1). This does not resubmit the mutation.
  - `Retry operation`: Offer only for safe same-operation replay, with the original identity / payload.
  - `Review retained input`: Show its originating Workspace and known outcome without claiming it is current State.
- When an action is disabled, show short helper text directly below it, without requiring hover.
- Put technical identity / version information and diagnostic details inside `Show details`. Do not require users to understand persistence identifiers to choose a recovery action.
- Explain maintenance / restore quarantine as restricted access pending recovery. Sign-in or cache clearing must not appear to bypass the restriction.
- Keep retained operations for other Workspaces discoverable without mixing their results into the selected Workspace's status or granting access to unavailable Server data.

### 4. Workspace

- List authorized Shared Workspaces and support selection alongside Personal scope. Restore the last selection subject to current verification.
- Display `No shared workspace selected` only within this section.
- Show the selected Workspace's name and `Can edit / View-only` status. Names are labels, not identifiers or authorization evidence.
- Provide `Create shared workspace…` through a name-entry dialog; update the list after confirmed success without automatically switching the selected context.
- Explain `Creating a workspace doesn’t share it automatically.`
- Provide management entry points for inviting / managing access subject to current authority. Explain the effect of granting, changing, or revoking access; do not prescribe invitation-link mechanics.
- Do not imply that ordinary edit capability grants permission to manage members, reset contents, or delete the Workspace.
- Explain unavailable, revoked, or restore-quarantined access and offer an authorized alternative context where available.

### 5. Data & portability

- Follow Part I §9 for format, validation, preview, and full replacement semantics.
- Offer `Export personal data` and `Export shared data`, clearly identifying the target Workspace and respecting current authorization.
- Export a consistent current State + History dataset, including Spend / Payment Records, in the versioned ZIP format. Explain that unresolved input is excluded.
- Import through a mobile-compatible file-selection flow (iOS / Android), then validation → preview → explicit apply.
- Reject invalid / inconsistent data without automatic correction. Display the target and scope of replacement before apply.
- Provide a prominent `Export backup before import` action and strongly recommend it. Backup creation is optional; a skipped or unsuccessful Export must not prevent Import when the user explicitly confirms proceeding without a backup.
- Require acknowledgement that current State + History will be fully replaced, Import has no ordinary Undo, and a pre-import backup can be re-imported for recovery. Imported Spend does not regain Undo capability.
- Apply two-stage destructive confirmation with clear target, replacement scope, and backup status. At the final confirmation, prominently warn `No pre-import backup was created` when proceeding without a backup; do not infer that one exists. Permit explicit confirmation without a backup. If the Workspace changes after preview, refresh the preview and confirmation rather than applying against stale data.
- On an unknown outcome, offer result checking and preserve the operation context; do not automatically apply Import again as a new operation.

### 6. Appearance

- Provide `Light / Dark / System`.
- Keep it concise in one section because it is not a frequent operation.

### 7. Advanced / Diagnostics

- A collapsible display is recommended.
- Group infrequent connection, browser-storage, and persistence diagnostics.
- Keep technical request / operation identifiers in details; do not expose credentials, sensitive payloads, or unnecessary personal information in logs or diagnostic output.
- Diagnostic operations must not bypass access / maintenance gates or silently clear unresolved input.
- Do not place allocation-adjustment review in Settings; use the Domain UI.

### 8. Danger zone

- Distinguish `Reset workspace contents` from `Delete workspace` under Part I §9.5. Do not expose an operation until its authorization and lifecycle policy is defined.
- Identify the target Workspace, affected data, and Shared-member consequences before confirmation. Reset keeps the Workspace and its current access configuration; deletion removes access to that Workspace for all members.
- Preserve two-stage confirmation:
  1. Warning with exact destructive scope + `I understand` checkbox; offer Export first.
  2. Typed confirmation, for example `RESET` or `DELETE`, matching the specific action.
- Use restrained emphasis in the mobile list, such as a pale red background / left border.
- After confirmed reset, refresh the new incarnation and its empty dataset. After confirmed deletion, stop showing the removed Workspace as accessible and offer another authorized context.
- Retained old input remains separate and cannot be automatically submitted. Ordinary local cleanup must not silently erase unresolved journals.
- Unknown outcomes follow the shared result contract; dismissing the dialog or refreshing is not proof of failure.
- Account-wide / all-data deletion is a distinct future lifecycle capability, not an implied effect of either action.

### 9. Required Implementation Logic

- Standardize status navigation to `/settings#connection-health`.
- On mobile, interpret the hash as opening the corresponding Overlay; anchor scrolling is acceptable on desktop.
- Support direct entry to sections such as `#sign-in-access`, `#workspace`, and `#data-portability` using the same pattern where possible.
- UI wording must be English only.
- Apply shared save-result, current-access, and timeline rules to all Settings actions, including Export / Import and destructive operations.

---
