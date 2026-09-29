# Entitlements reference

This document describes the entitlement model, reset strategies, usage tracking, and how they interact with products and billing.

---

## Overview

An **entitlement** grants a user access to a capability identified by an **entitlement key** (e.g. `token`, `subject_access`, `api_calls`). Entitlements are stored per user and key. They can be:

- **Active** – user has access.
- **Revoked** – access was removed (e.g. subscription canceled, expired, or suspended after dunning).
- **Expired** – time-based expiration passed.

Entitlements are created and updated by the **entitlement-service** when it processes **billing events** (payments and subscription lifecycle). They can also be created by **trial-service** for trials. **access-service** exposes read/usage APIs; **token-service** and others consume usage (e.g. charge token).

---

## Entitlement entity

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Owner of the entitlement |
| `key` | string (EntitlementKey) | Capability identifier (e.g. `token`, `subject_access`) |
| `role` | string | Role (e.g. `learner`); used for future RBAC |
| `status` | `active` \| `revoked` \| `expired` | Current status |
| `grantedAt` | Date | When the entitlement was granted |
| `expiresAt` | Date? | When access ends (optional; absent = no expiry) |
| `usage` | EntitlementUsage? | Optional usage tracking (limit, used, reset strategy) |

**Active check:** Entitlement is considered active when `status === "active"` and (`expiresAt` is absent or `now < expiresAt`).

---

## Usage and limits

When an entitlement has a `usage` object, it is **usage-based**: the user can consume up to an **effective limit** (see below). Consumption is recorded in `used`.

### EntitlementUsage

| Field | Type | Description |
|-------|------|-------------|
| `limit` | number | Base limit (from subscription or product config) |
| `used` | number | Amount consumed in the current period |
| `resetAt` | Date? | When the current period ends (next reset time) |
| `resetStrategy` | ResetStrategy? | How and when usage resets |
| `permanentLimit` | number? | Extra capacity from one-time purchases; never removed on revoke |

**Effective limit** = `limit + (permanentLimit ?? 0)`.

- **limit** – Can be set/overwritten by subscriptions and add-ons; removed when subscription is revoked (unless one-time grants permanent limit).
- **permanentLimit** – Added by one-time payments; persists even after subscription cancel/expire. Only the subscription-derived `limit` is zeroed on revoke.

### Consuming usage

- **Increment usage:** `POST /access/usage/:key` with optional `amount` (default 1). The use case:
  - Ensures entitlement exists, is active, and is usage-based.
  - **Lazy reset:** If `usage.shouldReset(now)` is true, resets usage and recalculates `resetAt` from the reset strategy, then consumes.
  - If `used + amount` would exceed effective limit, usage is **capped at the limit** (no throw).
  - Returns `{ key, usage, limit, remaining }` and may publish **entitlement.availability_updated** with `currentAvailableUsage = limit - used`.

- **Token charge:** `POST /token/charge` (with `priceId`) consumes the token entitlement in a similar way (service-specific logic).

---

## Reset strategies

Reset strategies define **when** `used` is reset to 0 and when the next period starts (`resetAt`).

### ResetStrategy type

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"manual"` \| `"periodic"` \| `"rolling"` | How reset is triggered |
| `period` | See below | For periodic: hour, day, week, month, quarter, year, billing_cycle, custom |
| `dayOfMonth` | 1–31? | For monthly resets |
| `dayOfWeek` | 0–6? | 0 = Sunday; for weekly resets |
| `hour` | 0–23? | Hour of day for reset |
| `timezone` | string? | IANA timezone (e.g. `America/New_York`) |
| `customDays` | number? | For `period: "custom"`: e.g. every N days |

**Period values:** `hour` \| `day` \| `week` \| `month` \| `quarter` \| `year` \| `billing_cycle` \| `custom`.

### Reset types

1. **manual**
   - Reset only when explicitly triggered (e.g. admin or external process).
   - If `resetAt` is set, `shouldReset(now)` is true when `now >= resetAt`. After reset, `resetAt` is cleared (no auto next period).

2. **periodic**
   - Resets at fixed intervals. `shouldReset(now)` is true when `now >= resetAt`. After reset, **next** `resetAt` is computed from the strategy:
     - **hour** – next hour boundary.
     - **day** – next day at `hour` (default 0).
     - **week** – next `dayOfWeek` (e.g. Sunday) at `hour`.
     - **month** – next month, `dayOfMonth` at `hour`.
     - **quarter** – next quarter (e.g. +3 months), 1st at `hour`.
     - **year** – next year, Jan 1 at `hour`.
     - **billing_cycle** – not computed in isolation; **entitlement-service** sets `resetAt` from the subscription’s `currentPeriodEnd` on create/renew. Renewal is detected when `subscription.updated` has a new period start ≥ previous period end.
     - **custom** – `customDays` used to advance by N days.

3. **rolling**
   - No calendar-based reset in code; `shouldReset()` returns false. Used when consumption is evaluated over a rolling window elsewhere (e.g. “last 30 days”).

### Mapping from product UsageLimit to ResetStrategy

Products define **usage limits** with a **period**: `day` \| `week` \| `month` \| `year` \| `billing_cycle` \| `lifetime`. When entitlements are created/updated from a product (sync product limits), the period is mapped to a **ResetStrategy**:

- **day** → `{ type: "periodic", period: "day", hour: 0 }`
- **week** → `{ type: "periodic", period: "week", dayOfWeek: 0, hour: 0 }`
- **month** → `{ type: "periodic", period: "month", dayOfMonth: 1, hour: 0 }`
- **year** → `{ type: "periodic", period: "year", hour: 0 }`
- **billing_cycle** → `{ type: "periodic", period: "billing_cycle" }` (actual `resetAt` from subscription period end)
- **lifetime** → no reset strategy (no periodic reset)

---

## Product usage limits and sync

### Product UsageLimit (product entity)

| Field | Type | Description |
|-------|------|-------------|
| `metric` | string | Must match an entitlement key (e.g. `api_calls`, `ai_tokens`) |
| `limit` | number | Amount per period |
| `period` | UsagePeriod | `day` \| `week` \| `month` \| `year` \| `billing_cycle` \| `lifetime` |
| `window`? | string | `calendar` \| `rolling` \| `billing` \| `custom` |
| `startDate`? | Date | For custom windows |

Products can have multiple `usageLimits` (e.g. one for `token`, one for `api_calls`). Each metric should correspond to an **entitlement key** that the product grants in `entitlements`.

### Sync product limits to entitlements

After creating or updating entitlements from a billing event (subscription or one-time payment), **entitlement-service** runs **SyncProductLimitsToEntitlementsUseCase**:

- Loads the **product** and its `usageLimits`.
- For each usage limit whose `metric` matches an existing entitlement for the user:
  - **One-time payment:** Adds the limit to **permanentLimit** (and does not set/change reset strategy). Does not reset `used`.
  - **Subscription – add-on or “always increment” (e.g. lifetime):** **Adds** the limit to the existing `limit` (additive).
  - **Subscription – base product:** **Sets** the entitlement’s `limit` to the product’s limit (overwrite).
  - **Reset strategy:** For non–one-time, sets or updates `resetStrategy` from the product period (including `billing_cycle`). For `billing_cycle`, `resetAt` is set from the subscription’s `currentPeriodEnd` when the event is processed or on renewal.
  - If the entitlement already had usage and the new sync is for a new period (e.g. renewal), and the strategy is `billing_cycle`, usage is reset and `resetAt` set to the new period end.

So:

- **Subscription** → entitlement gets a **limit** and a **reset strategy** (including billing_cycle aligned to Stripe period).
- **One-time payment** → entitlement gets **permanentLimit** only; no reset; never reduced on revoke.
- **Add-ons** → limits are **added** to existing entitlements (same key); base product overwrites.

---

## Billing cycle renewal and resets

- **subscription.created** – New subscription: create entitlements, set limits and `resetAt` from `currentPeriodEnd` when period is `billing_cycle`.
- **subscription.updated** – If the new period start is at or after the previous period end, it’s treated as a **renewal**:
  - For entitlements with `resetStrategy.period === "billing_cycle"`, usage is reset and `resetAt` set to the new `currentPeriodEnd`.
  - Other periodic strategies still use `shouldReset()` and their own `resetAt` (e.g. daily/monthly).
- **subscription.canceled** (at period end) – Entitlements get `expiresAt = currentPeriodEnd`; no immediate revoke.
- **subscription.expired** / **subscription.deleted** – Entitlements are revoked. If the user has **permanentLimit** from one-time purchases, only the subscription `limit` is zeroed; entitlement stays active with `permanentLimit` only.

---

## Dunning and entitlement revocation

Dunning states: **action_required** → **grace_period** → **restricted** → **suspended** (and **ok** when no issue).

- **Entitlement-service** does **not** revoke on `payment.failed` or `payment.action_required`. It only revokes on subscription canceled/expired or when dunning has already moved to **suspended** (e.g. after 8+ days).
- Before revoking, it checks the **dunning** record (if configured). If state is **action_required**, **grace_period**, or **restricted**, revocation is **skipped** so access is kept during the grace window.
- When revoking (immediate or at period end):
  - If the entitlement has **permanentLimit** from one-time payments, only the subscription-derived `limit` is set to 0; **permanentLimit** is kept; entitlement remains **active** with no expiration.
  - If there is no permanentLimit, entitlement is set to **revoked** and usage/strategy cleared.

So one-time purchased capacity is never removed; only subscription-derived access and limit are.

---

## Entitlement events (entitlement-updates SNS)

When entitlements change, the service can publish to **entitlement-updates**:

- **entitlement.created** – New entitlement (e.g. after subscription or one-time payment). Payload includes userId, entitlementKey, role, status, expiresAt, usageLimit, productId, reason.
- **entitlement.updated** – Entitlement updated (e.g. renewal, limit change, resume). Same payload shape.
- **entitlement.revoked** – Entitlement revoked (cancel/expire/suspend). Same payload shape.
- **entitlement.availability_updated** – Fired when **remaining** usage changes (e.g. after increment usage or token charge). Payload: `userId`, `key`, `currentAvailableUsage` (number or null if not usage-based).

Downstream systems can subscribe to **entitlement-updates** to keep caches or feature flags in sync.

---

## Summary table

| Concept | Description |
|--------|-------------|
| **Entitlement key** | Identifier for a capability (e.g. `token`, `subject_access`). Product’s `entitlements` list keys it grants; product’s `usageLimits[].metric` should match a key for usage. |
| **limit** | Subscription/product-derived capacity; reset each period; removed on revoke. |
| **permanentLimit** | One-time-purchase capacity; never removed; additive. |
| **Effective limit** | `limit + permanentLimit`. |
| **Reset strategy** | When and how `used` resets; from product period (day/week/month/year/billing_cycle/lifetime). |
| **billing_cycle** | Reset at subscription period end; `resetAt` set from Stripe `currentPeriodEnd`; renewed on subscription.updated renewal. |
| **Lazy reset** | On increment, if `shouldReset(now)` then reset and then consume. |
| **Revocation** | Subscription cancel/expire/suspend clears `limit` and status (or sets expiresAt); permanentLimit and one-time–granted access remain. |

For API and event wiring, see **[API, events & architecture](./api-events-and-architecture.md)**.
