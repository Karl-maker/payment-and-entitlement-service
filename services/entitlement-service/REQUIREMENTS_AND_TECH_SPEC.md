# Entitlement Service — Requirements and Technical Specification

This document states **intended behavior** (requirements), **observed implementation**, **edge cases**, and **known gaps or defects** for the entitlement service. It is derived from the TypeScript sources in this package as of the time of writing. For deployment topology and file map, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Product scope and goals

### 1.1 Business intent

- Translate **billing lifecycle events** (subscriptions and payments) into **durable user entitlement state** stored in DynamoDB (entitlements table managed by the access/product stacks).
- Keep entitlement **usage limits** aligned with **product definitions**, including **add-on** products and **one-time purchase** semantics delegated to `@libs/domain`.
- Emit **downstream notifications** on an SNS topic so other systems can react to entitlement changes.
- Integrate with the **dunning** model so access is not cut off prematurely during grace periods when revocation events arrive early.

### 1.2 Out of scope (by design)

- No HTTP API in this service.
- No handling of `payment.failed` / `payment.action_required` for entitlement mutation (delegated to dunning and other services).
- No global **billing `meta.eventId`** deduplication in application code (see section 8).

---

## 2. Non-functional requirements

| ID | Requirement | Implementation notes |
|-----|-------------|----------------------|
| NF-1 | Process SQS batches with **partial failure** reporting | Supported via `SQSBatchResponse` / `ReportBatchItemFailures`. |
| NF-2 | Survive **transient** downstream failures during entitlement **writes** | Dynamo failures bubble to handler → SQS retry. |
| NF-3 | **SNS publish** must not roll back successful entitlement writes | Publisher catches errors and does not rethrow. |
| NF-4 | Operate under Lambda **memory/time** with batched SQS (up to 10 records) | Each record processed sequentially. |
| NF-5 | Safe default when renewal detection errors | `isBillingCycleRenewal` returns `false` on error (avoids accidental usage reset). |

---

## 3. Transport and entrypoint

### 3.1 `src/handler/index.ts`

#### Intended behavior

- Invoke composition (`bootstrap()`), parse the full `SQSEvent` into billing events, process **each** record in order, return `batchItemFailures` for any record whose processing threw.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| **One** record has invalid JSON / parse error in `parseSqsEvent` | **Entire batch** marked failed (outer `catch`). All messages retried. |
| Record **N** throws during `execute` | Records `0..N-1` are **already committed**; only failed `messageId` is reported. On redelivery, **earlier events may run again** — see idempotency (section 8). |
| `billingEvents[i]` not aligned with `event.Records[i]` | Implementation assumes **one parsed event per record** in the same array order. If a future change parses selectively, alignment **must** be preserved. |
| Empty `Records` | Loops zero times; returns empty failures. |

#### Known issues

- **`bootstrap()` runs on every invocation**, constructing new AWS SDK clients and repositories each time (no module-level singleton). This increases cold/warm latency and log noise (`DynamoProductRepository` logs table name on construct).
- **No structured logging** (plain `console.log` / `console.error`); `meta.eventId` may be `undefined` in logs if producers omit it (no validation).

---

### 3.2 `src/handler/sqs/parse-event.ts`

#### Intended behavior

- Accept SQS bodies that are either:
  - **SNS notification** JSON: top-level `Type === "Notification"` and string `Message` containing the billing event JSON, or
  - **Direct** billing event JSON in the body.

- Enforce top-level presence of `type`, `payload`, and `meta` on the decoded billing object.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| SNS uses different casing or shape for `Type` | **Not** treated as SNS; body coerced as direct event — likely `Invalid billing event structure` or wrong shape. |
| `Message` is already an object (some bridges) | `JSON.parse(messageBody.Message)` **throws** → batch failure. |
| Valid structure but **wrong** `payload` for `type` | No schema validation here — failures occur later in the use case or in Dynamo. |
| Maliciously large payload | No size guard in this layer; Lambda/SQS limits apply. |

#### Known issues

- **Shallow validation only** — invalid/missing subscription fields may surface deep in the use case or as confusing Dynamo errors.

---

## 4. Composition — `src/bootstrap.ts`

#### Intended behavior

- Validate required env: `PRODUCTS_TABLE`, `ENTITLEMENTS_TABLE`, `PROCESSED_EVENTS_TABLE`.
- Construct `EntitlementEventPublisher` (requires `ENTITLEMENT_UPDATES_TOPIC_ARN` at construct time via publisher).
- Optionally attach `DynamoDunningRepository` when `DUNNING_TABLE` is set.
- Always pass `DynamoProcessedPaymentsRepository` to the use case (not optional at runtime from bootstrap, though the use case type allows optional).

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| `ENTITLEMENT_UPDATES_TOPIC_ARN` missing | **Throws** when creating `EntitlementEventPublisher` — **entire batch** fails until env fixed. |
| `DUNNING_TABLE` unset | Revocation **does not** consult dunning; all revocation branches apply without grace logic. |

#### Known issues

- None specific beyond global “bootstrap per invoke” (see 3.1).

---

## 5. Billing event processing — `src/app/usecases/process.billing.event.usecase.ts`

### 5.1 Global rules (`execute`)

#### Intended behavior

- Ignore `payment.failed` and `payment.action_required` (no entitlement changes).
- Resolve **role** for entitlement rows (intended for future multi-role).
- Dispatch by `event.type` to private handlers; log and no-op for unknown types.

#### Edge cases and defects

| Topic | Detail |
|-------|--------|
| **Role** | `extractRole` **always** returns `"learner"` and calls **`console.log(event)`** on every event — **PII/cost risk** and not suitable for production as written. |
| **Dead code** | `if (!role)` warning in `execute` is **unreachable** because `extractRole` never returns a falsy value. |
| **Unhandled types** | Silent log-only path — producers may assume handling when nothing happens. |

---

### 5.2 `subscription.created`

#### Intended behavior

- Set entitlement period end from `currentPeriodEnd`.
- Ensure base product entitlements exist/active and sync limits (`isRenewal=false`, not one-time).
- Add-ons: prefer `payload.addonProductIds`; else use product `addonConfigs` / legacy `addons`.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| Missing/invalid `currentPeriodEnd` | `new Date(...)` may be **Invalid Date**; passed through to domain — **undefined behavior** downstream. |
| Add-on product missing in catalog | `processAddonProduct` **warns and skips** that add-on; base still applied. |
| Duplicate delivery of same `subscription.created` | **No event-level idempotency** — may repeat limit sync / writes depending on `@libs/domain` idempotency. |

---

### 5.3 `subscription.updated`

#### Intended behavior

- If `previousProductId` is set and differs from `productId`, **immediately** revoke entitlements for the **old** product (full revoke path), then apply the **new** product and add-ons.
- Detect **billing cycle renewal** to drive usage reset for `billing_cycle` strategy.
- Refresh base + add-ons and publish.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| **Product change + dunning** | `revokeEntitlements` for the **old** product can **return early** (no DB change) when user is in `ACTION_REQUIRED` / `GRACE_PERIOD` / `RESTRICTED`. New product entitlements are still created/updated — user may **retain old and new** entitlements simultaneously. **Gap vs typical “move subscription” expectation.** |
| `previousProductId` omitted on upgrade | No revoke of old product — relies on producer always sending `previousProductId` when needed. |
| Renewal false negative | If `expiresAt` missing on all base keys, **no** renewal resets for billing cycle (conservative). |
| Renewal false positive | If **any** base entitlement’s `expiresAt` is within **1s** before `currentPeriodStart`, renewal is **true** — could mis-fire if data is inconsistent. |

---

### 5.4 `subscription.canceled`

#### Intended behavior

- `cancelAtPeriodEnd`: schedule revoke by setting expiration to `currentPeriodEnd` (non-immediate path).
- Else: immediate revoke path.

#### Edge cases and **defects**

| Scenario | Behavior |
|----------|----------|
| **Dunning blocks revocation** | `revokeEntitlements` **returns without throwing** when dunning says “skip.” **Publishing still runs** (`publishEntitlementEvents` with reason `subscription.canceled`). That method publishes **`ENTITLEMENT_REVOKED`-style** messages for **every** entitlement on the user when reason contains `"canceled"` (see 6.2). **Defect: downstream SNS consumers can observe “revoked” notifications while DynamoDB state was not revoked.** Same pattern applies to **`subscription.expired`** after immediate revoke path. |
| Cancel at period end + dunning skip | DB may be unchanged; publish path still emits **revoked**-classified traffic for `"canceled"` in reason. |

**Mitigation direction (requirements, not implemented):** only publish after revoke success, or publish a **different** event type (“revocation_deferred”), or include **actual** post-revoke snapshot and per-key diff.

---

### 5.5 `subscription.expired`

#### Intended behavior

- Immediate revoke for product + configured add-on products (recursive).

#### Edge cases and defects

- Same **dunning skip vs publish** inconsistency as **5.4** (`publishEntitlementEvents` still runs with `"subscription.expired"` → reason matches **revoked** branch for **all** user entitlements in the loop).

---

### 5.6 `subscription.paused`

#### Intended behavior (comments vs code)

- Comments say entitlements should become inactive; **implementation does not change DynamoDB** — **only logs**.

#### Gap

- **Documented as incomplete** in source. Paused users **keep active entitlements** in storage.

---

### 5.7 `subscription.resumed`

#### Intended behavior

- Re-activate base entitlements with `currentPeriodEnd`; **not** treated as renewal (`isRenewal=false`).

#### Edge cases and defects

| Issue | Detail |
|-------|--------|
| **Role inconsistency** | Uses **hardcoded** `"learner"` instead of `extractRole` / handler role — if roles were ever extended, resumed subscriptions would **ignore** intended role. |
| **No add-on replay** | Does not process `addonProductIds` or `processAddons` — if pause/resume should mirror subscription items, add-ons may be **out of sync** until the next `subscription.updated`. |

---

### 5.8 `payment.successful`

#### Intended behavior

- If no `productId`, skip (log).
- **One-time** detection: `billingType === "one_time"` **or** missing `subscriptionId`.
- One-time with `paymentIntentId`: skip if already recorded in `PROCESSED_EVENTS_TABLE` under `PAYMENT#…`.
- One-time: `createEntitlementsFromProduct` with `isOneTimePayment=true` (permanent limit path in domain sync).
- Subscription payment path: `createEntitlementsFromProduct` with `expiresAt` **undefined** and `isOneTimePayment=false` (see below).
- After success, mark payment processed for one-time + `paymentIntentId`.
- Publish entitlement events.

#### Edge cases and defects

| Scenario | Risk |
|----------|------|
| **`subscriptionId` omitted** on a **subscription** invoice | Classified as **one-time** — wrong limit/expiration semantics and wrong idempotency key usage. |
| **One-time without `paymentIntentId`** | **No idempotency** — duplicate SQS deliveries can **double-apply** limits/credits. |
| **Race**: two concurrent Lambdas same `paymentIntentId` | Both can pass `isPaymentProcessed` before either `markPaymentProcessed` — **double apply** unless domain layer is strictly idempotent. `PutCommand` has **no ConditionExpression**. |
| **Mark after apply** | If entitlement writes succeed but **mark** fails, retry will **re-enter** apply path — duplicate risk depends on `SyncProductLimitsToEntitlementsUseCase` behavior (not in this file). |
| **Subscription** `payment.successful` with `expiresAt` undefined | Existing subscription entitlements may **not** get `expiresAt` updated** in the `existing` branch when `expiresAt` arg is undefined (`else if (expiresAt)` skipped) — **period end might not refresh** from invoice-only events. Producers may need to rely on `subscription.updated` / `subscription.created` for dates. |
| Skip when no `productId` | **No SNS** publish — consumers cannot distinguish “ignored” vs “processed.” |

---

### 5.9 `createEntitlementsFromProduct` / add-ons / renewal / revoke

#### Add-ons (`processAddons` / `processAddonProduct`)

- **Intended:** additive limits via `syncProductLimitsUseCase` with `isAddon: true`.
- **Edge:** duplicate addon entries (config + legacy lists) could **process twice** if the same product appears in both `addonConfigs` and `addons`.

#### `isBillingCycleRenewal`

- **Intended:** infer renewal when new period start is at/after stored `expiresAt` (1s tolerance).
- **Edge:** relies on **stored** `expiresAt` matching last period end; clock skew across systems can affect the 1s window.

#### `revokeEntitlements` (including dunning)

- **Intended:** respect dunning; preserve `permanentLimit` on immediate revoke; recurse into add-on products.
- **Edge:** immediate revoke with permanent limit sets `usage.limit = 0`, clears reset strategy, keeps status **ACTIVE** — access is driven by **permanentLimit** semantics in consumers; document for API teams.
- **Defect:** early `return` when dunning blocks **does not** communicate to callers; combined with **5.4 / 5.5 / 6.2** causes **notification vs state** mismatch.

---

## 6. Outbound events

### 6.1 `src/infrastructure/event.publisher.ts`

#### Intended behavior

- Publish versioned `ENTITLEMENT_CREATED | UPDATED | REVOKED` envelopes with `MessageAttributes.eventType`.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| SNS throttling / network error | Logged, **swallowed** — callers think success path completed. |
| Large burst | Sequential `await` in caller loops — slow but simple. |

---

### 6.2 `publishEntitlementEvents` (in use case)

#### Intended behavior

- After a billing operation, notify subscribers with current entitlement rows for the **user**.

#### Edge cases and defects

| Issue | Detail |
|-------|--------|
| **Fan-out scope** | Loads **`findByUser(userId)`** and publishes **one SNS message per entitlement row**, not only keys touched by `productId`. High volume and **unrelated** keys included. |
| **`productId` in payload** | Every published message carries the **billing event’s** `productId`, even for entitlement keys **not** from that product — **misleading** for consumers that treat `productId` as “source of change.” |
| **Reason string routing** | Uses `reason.includes("created")`, `"successful"`, `"updated"`, `"resumed"`, `"canceled"`, `"expired"`, `"revoked"`. Fragile if new reasons overlap substrings (e.g. hypothetical `"unrevoked"`). |
| **Status mapping** | Only `ACTIVE` maps to `"active"`; other statuses map to `"inactive"` — fine-grained states (e.g. `REVOKED`) may be **collapsed** for SNS consumers. |
| **Revoked classification on cancel/expire** | For cancel/expire reasons, **every** entitlement row gets **revoked-type** publishes — not scoped to keys affected by the product — **amplifies** the dunning mismatch in **5.4**. |

---

## 7. Idempotency — `src/infrastructure/processed-payments.repository.ts`

#### Intended behavior

- Store `eventId = PAYMENT#{paymentIntentId}` with TTL **90 days**.

#### Edge cases

| Scenario | Behavior |
|----------|----------|
| TTL expiry | Record disappears — **same** `paymentIntentId` could theoretically be processed again after 90 days (edge for replays/archives). |
| Same table as generic “processed billing events” | Table name suggests broader use; **only** `PAYMENT#` keys are written by this repo. |

#### Known gaps

- **No** `meta.eventId` storage for subscription lifecycle events in this service.
- **README** in this folder may still describe generic event idempotency — **treat as documentation drift** unless another component writes other keys.

---

## 8. Idempotency and delivery semantics (cross-cutting)

| Concern | Status in this codebase |
|---------|-------------------------|
| SQS **at-least-once** delivery | Handled partially: one-off + `paymentIntentId` only. |
| **Subscription** duplicate messages | **Not** deduped by `eventId` in app code. |
| Partial batch + retry | Earlier messages in batch **not** replayed on single-record failure; **later** failed message retries — **ordering** across retries is **not** guaranteed by SQS. |

---

## 9. Environment contract (summary)

| Variable | Required | Consumer |
|----------|----------|----------|
| `PRODUCTS_TABLE` | Yes | `DynamoProductRepository` |
| `ENTITLEMENTS_TABLE` | Yes | `DynamoEntitlementRepository` |
| `PROCESSED_EVENTS_TABLE` | Yes | `DynamoProcessedPaymentsRepository` |
| `ENTITLEMENT_UPDATES_TOPIC_ARN` | Yes | `EntitlementEventPublisher` |
| `DUNNING_TABLE` | No | `DynamoDunningRepository` |

---

## 10. Traceability matrix (billing events → main effects)

| Billing `type` | Entitlements Dynamo | Notes |
|----------------|---------------------|-------|
| `subscription.created` | Create/update base + add-ons | No `eventId` idempotency. |
| `subscription.updated` | Old product revoke (if `previousProductId`), base + add-ons refresh, renewal resets | Dunning can block old revoke only. |
| `subscription.canceled` | Revoke immediate or defer to `expiresAt` | **Publish vs dunning skip** defect. |
| `subscription.expired` | Immediate revoke path | **Publish vs dunning skip** defect. |
| `subscription.paused` | **No-op** in persistence | Incomplete vs comment. |
| `subscription.resumed` | Base product refresh only | Hardcoded learner; no add-on list. |
| `payment.successful` | Depends on one-time vs subscription path | Idempotency only one-time + `paymentIntentId`. |
| `payment.failed` / `payment.action_required` | No-op | By design. |
| Other | Log “Unhandled” | No error to SQS. |

---

## 11. Recommended backlog (from this review)

1. Fix **publish after skipped revoke** (dunning): gate `publishEntitlementEvents`, or publish **deferred** / **accurate diff** events.
2. Remove **`console.log(event)`** from `extractRole`; use structured logging with redaction.
3. Align **`subscription.resumed`** with add-on handling and shared role resolution.
4. Implement **`paymentIntentId` conditional write** (or transaction) to close **race** on one-off idempotency.
5. Tighten **`payment.successful`** classification so missing `subscriptionId` does not mis-route real subscription charges without an explicit `billingType`.
6. Scope SNS payloads to **affected keys** or document **full snapshot** contract for consumers.
7. Align **README** idempotency story with code (or implement generic `eventId` dedupe).

---

## 12. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — structure, AWS diagram, file map.
- [README.md](./README.md) — operator setup (verify against sections 7–8 here for idempotency).

This specification should be updated whenever billing handlers, publish behavior, or idempotency strategy change.
