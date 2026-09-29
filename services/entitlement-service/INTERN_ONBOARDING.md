# Entitlement Service — Intern Onboarding Guide

This guide is for someone at **internship level**: you may be new to AWS serverless patterns, event-driven systems, or this repository. It explains **what the service is for**, **how it fits together**, **how to read the code**, **what can go wrong**, and **how to start writing tests**. Take it in order, or jump using the table of contents.

**Companion docs (more formal / dense):**

- [README.md](./README.md) — setup, env vars, high-level features.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — diagrams, AWS resources, file map, `@libs/domain` dependency.
- [REQUIREMENTS_AND_TECH_SPEC.md](./REQUIREMENTS_AND_TECH_SPEC.md) — requirements, edge cases, known defects (use when you need precision or QA scenarios).

---

## Table of contents

1. [What you should know first](#1-what-you-should-know-first)
2. [Plain-English: what is an “entitlement”?](#2-plain-english-what-is-an-entitlement)
3. [What this service is *for* (purpose and requirements)](#3-what-this-service-is-for-purpose-and-requirements)
4. [The story of one event (mental model)](#4-the-story-of-one-event-mental-model)
5. [Architecture in simple layers](#5-architecture-in-simple-layers)
6. [How to read the codebase (suggested order)](#6-how-to-read-the-codebase-suggested-order)
7. [Each part of the code: role, shortcomings, tests](#7-each-part-of-the-code-role-shortcomings-tests)
8. [When you do not understand something](#8-when-you-do-not-understand-something)
9. [How to approach testing (philosophy + concrete tactics)](#9-how-to-approach-testing-philosophy--concrete-tactics)
10. [First-week checklist](#10-first-week-checklist)
11. [Reading material and links](#11-reading-material-and-links)

---

## 1. What you should know first

You do **not** need to be an expert in everything below on day one. When a section mentions a concept, use [§11](#11-reading-material-and-links) or search the official docs.

| Concept | Why it matters here |
|--------|---------------------|
| **JSON** | Events are JSON objects with `type`, `payload`, `meta`. |
| **TypeScript basics** | The service is written in TS; you will see `async`/`await`, interfaces, `private` methods. |
| **AWS Lambda** | Your code runs as a function triggered by SQS. |
| **SQS** | A **queue** of messages; at-least-once delivery; retries and DLQ. |
| **SNS** | A **pub/sub** topic; billing events often go SNS → SQS → Lambda. |
| **DynamoDB** | Key-value / document store for products, entitlements, idempotency rows, dunning. |
| **Idempotency** | Processing the same logical event twice should not double-charge or double-grant (ideally). |

**Monorepo note:** Business types and Dynamo repositories mostly live in **`@libs/domain`** (`libs/domain` in the payment repo). This service is a **thin orchestration layer** on top of that library.

---

## 2. Plain-English: what is an “entitlement”?

Think of an entitlement as **a rule stored per user** such as:

- “This user may use feature X”
- “This user has N tokens per billing period”
- “This access expires on date Y”

**Products** (in the products table) define *what* a purchase or subscription should grant. **Entitlements** (in the entitlements table) are the *per-user* copy of that grant, including usage counters and expiration.

This service’s job is: **when billing says something happened** (paid, renewed, canceled, …), **update those per-user rows** and **tell the rest of the company** via SNS.

---

## 3. What this service is *for* (purpose and requirements)

### 3.1 Primary purpose

1. **Listen** for standardized **billing domain events** (messages on SQS, often forwarded from SNS).
2. **Decide** what should change in **user entitlements** based on the event type (`subscription.created`, `payment.successful`, etc.).
3. **Load product definitions** from DynamoDB so you know which entitlement keys and limits apply.
4. **Create, update, or revoke** entitlement records via shared domain use cases.
5. **Optionally respect dunning** (failed payment grace period) so you do not revoke access too early.
6. **Publish notifications** to the **entitlement-updates** SNS topic so other services can refresh caches, send email, etc.

### 3.2 What it is *not* supposed to do

- It is **not** a REST API for the frontend.
- It does **not** replace the **dunning** service; it **skips** certain payment failure events on purpose.
- It does **not** own the full billing domain model alone — types and repositories are shared with **`@libs/domain`**.

### 3.3 “Done correctly” checklist (product expectations)

When you reason about correctness, ask:

- Did the **right user** get the **right keys** and **limits** for the **right product**?
- Is **expiration** consistent with subscription period end where applicable?
- On **renewal**, should **usage** reset for metered features? (The code has special logic for `billing_cycle`.)
- On **cancel / expire**, should access end **immediately** or **at period end**?
- On **one-off purchase**, should limits be **permanent** and survive later subscription cancel?
- Are **downstream** systems getting **accurate** SNS messages relative to DynamoDB? (See shortcomings — not always true today.)

---

## 4. The story of one event (mental model)

Imagine: **Alice subscribes to a course product.**

1. Stripe (or an internal billing adapter) finishes checkout and emits **`subscription.created`**.
2. That event is published to the **billing-events** SNS topic.
3. SNS pushes a wrapped message to **entitlement-queue** SQS.
4. Lambda runs `handler` with one SQS record.
5. `parse-event` unwraps SNS and gets JSON: `{ type, payload, meta }`.
6. `ProcessBillingEventUseCase` runs the **`subscription.created`** branch:
   - Loads the **product** → knows entitlement keys (e.g. `course_access`, `ai_tokens`).
   - For each key, creates or activates an entitlement for Alice until `currentPeriodEnd`.
   - Processes **add-ons** from the event or from the product config.
   - Syncs **usage limits** from product to entitlements (domain logic).
7. It then **publishes** SNS messages describing Alice’s entitlements (snapshot-style).

If something throws (e.g. product missing), the handler marks that SQS message **failed** so it can **retry**; after too many failures it may land in a **DLQ** for humans to inspect.

Walk through this story in code: `handler/index.ts` → `parse-event.ts` → `process.billing.event.usecase.ts`.

---

## 5. Architecture in simple layers

Think of **three rings**:

```text
   Outer:  AWS Lambda + SQS/SNS  ("how messages arrive and leave")
   Middle: This repo's code       ("which billing event does what")
   Inner:  @libs/domain           ("what an entitlement is, how Dynamo works")
```

| Layer | Files | Responsibility |
|-------|--------|------------------|
| **Transport** | `src/handler/*` | Lambda contract, parse SQS, batch failures. |
| **Composition** | `src/bootstrap.ts` | Wire env vars → concrete clients → use case. |
| **Application** | `src/app/usecases/process.billing.event.usecase.ts` | Billing → entitlement **policy**. |
| **Infrastructure** | `src/infrastructure/*` | SNS publish, idempotency table adapter. |
| **Shared domain** | `@libs/domain` | Entities, repos, `CreateEntitlementUseCase`, `SyncProductLimitsToEntitlementsUseCase`, billing event types. |

**Why layers matter for you:** When you fix a bug, first decide **which layer** owns it. Example: “wrong Dynamo key schema” is probably **`@libs/domain`**, not the handler. “Wrong event interpreted after cancel” might be the **use case** in this service.

See the diagram in [ARCHITECTURE.md](./ARCHITECTURE.md) for AWS resource names (topics, queues, tables).

---

## 6. How to read the codebase (suggested order)

1. **`package.json`** — scripts (`build`, `package`), dependencies (`aws-lambda`, `@aws-sdk/*`, `@libs/domain`).
2. **`src/handler/index.ts`** — smallest file; see how failures map to SQS retries.
3. **`src/handler/sqs/parse-event.ts`** — see how SNS wrapping is detected.
4. **`src/bootstrap.ts`** — see what gets constructed and which env vars are mandatory.
5. **`src/app/usecases/process.billing.event.usecase.ts`** — read `execute` and the `switch (event.type)` first; then drill into one handler (e.g. `handleSubscriptionCreated`).
6. **`src/infrastructure/event.publisher.ts`** and **`processed-payments.repository.ts`**.
7. **Jump into `@libs/domain`** when you hit `syncProductLimitsUseCase` or repositories — use your IDE “Go to definition.”

Keep a notebook of **event types** and **which private method** handles them; the file is long, so a small table you write yourself helps.

---

## 7. Each part of the code: role, shortcomings, tests

Below, **“shortcomings”** includes intentional gaps, sharp edges, and known bugs called out in [REQUIREMENTS_AND_TECH_SPEC.md](./REQUIREMENTS_AND_TECH_SPEC.md).

### 7.1 `src/handler/index.ts`

**What it does**

- Exports `handler(event: SQSEvent)` for Lambda.
- Calls `bootstrap()` to get `processBillingEventUseCase`.
- Parses **all** records, then loops with index `i` so `billingEvents[i]` matches `event.Records[i]`.
- On success for a record: logs success.
- On error for a record: pushes `messageId` into `batchItemFailures` so **only that message** retries (partial batch response).
- If anything outside the inner loop throws (e.g. parse): **every** record is marked failed.

**Shortcomings / things to watch**

- `bootstrap()` on **every** invocation — extra latency and repeated client construction.
- If message 1 succeeds and message 2 fails, message 1 is **not** retried with message 2; ordering across failures is **not** guaranteed globally by SQS.

**How to test**

- **Unit tests:** Pass a fake `SQSEvent` with 2–3 `Records`. Mock `bootstrap` to return a use case whose `execute` throws on the second call. Assert `batchItemFailures` length and `itemIdentifier`s.
- **Contract tests:** Assert handler return type matches `SQSBatchResponse` (TypeScript + a small runtime check if you want).
- **Integration tests (later):** Deploy to dev/stage and send real SQS messages (or use LocalStack); harder, but validates IAM and wiring.

**Concrete assertions**

- “Parse throws → all messageIds in failures.”
- “Second execute throws → only second messageId failed.”
- “All succeed → empty failures.”

---

### 7.2 `src/handler/sqs/parse-event.ts`

**What it does**

- `JSON.parse` SQS `body`.
- If it looks like **SNS** (`Type === "Notification"` and `Message`), parse `Message` again as the billing event.
- Otherwise treat the body as the billing event directly.
- Require `type`, `payload`, `meta` keys to exist (truthy check).

**Shortcomings**

- **Shallow validation** — does not validate payload fields per `type`.
- If `Message` is not a JSON string (some tools send objects), parsing **fails**.
- Strict string match on `"Notification"` — case-sensitive.

**How to test**

- Table-driven tests: fixtures for (1) raw billing JSON in body, (2) SNS envelope with string `Message`, (3) invalid JSON, (4) missing `meta`.
- Assert thrown error messages are helpful (optional).

**Research if stuck**

- AWS docs: **SNS → SQS subscription** message format (`Type`, `Message`, etc.).

---

### 7.3 `src/bootstrap.ts`

**What it does**

- Reads env vars; throws early if required tables missing.
- Builds repositories and `ProcessBillingEventUseCase`.

**Shortcomings**

- **Side effects at import/runtime**: constructing `DynamoProductRepository` may **log** on every cold start.
- `EntitlementEventPublisher` requires `ENTITLEMENT_UPDATES_TOPIC_ARN`; missing ARN fails **whole** bootstrap (batch failure).

**How to test**

- Usually **not** unit-tested heavily; instead integration tests or smoke tests in a deployed env.
- If you do unit test: **mock `process.env`**, call `bootstrap()`, assert thrown errors for missing vars (restore env after).

**Research if stuck**

- Node `process.env`, Lambda environment configuration, Terraform passing env vars (see `infra/services/entitlement-service` in payment repo).

---

### 7.4 `src/app/usecases/process.billing.event.usecase.ts`

**What it does**

- Central **policy**: maps each billing `type` to entitlement operations.
- Coordinates **create**, **sync limits**, **add-ons**, **renewal detection**, **revoke** with dunning checks, **one-off idempotency**, and **publishing**.

**Shortcomings (high value for interns to know)**

- **`extractRole`** always returns `"learner"` and currently **`console.log(event)`** — noisy and may log PII; also makes the `if (!role)` branch in `execute` **unreachable**.
- **No global dedupe** by `meta.eventId` for subscription events — duplicate SQS delivery can repeat work; whether that is safe depends on `@libs/domain`.
- **`subscription.paused`**: comment says inactive entitlements; **code does not update DB** (no-op aside from log).
- **`subscription.resumed`**: hardcodes `"learner"` and **does not** reprocess add-ons from the event.
- **`payment.successful`**: treats as one-time when `billingType === "one_time"` **or** `subscriptionId` is missing — misclassification risk.
- **One-off idempotency**: only if `paymentIntentId` present; **race** possible between two parallel Lambdas (no conditional write).
- **Dunning + publish**: if `revokeEntitlements` **returns early** (skips DB revoke), **`publishEntitlementEvents` still runs** for cancel/expire — downstream may see “revoked” style notifications that do not match DB. See detailed write-up in REQUIREMENTS doc.
- **`publishEntitlementEvents`**: publishes for **all** entitlements returned by `findByUser`, attaches the **billing** `productId` to every message, classifies created/updated/revoked by **substring checks** on `reason` — easy to break when adding new reasons.

**How to test**

This file is large — **do not** try to cover every branch in one test file on day one.

**Recommended approach**

1. **Extract pure helpers** (if the team agrees) for things like `isBillingCycleRenewal` logic into small functions → **easy unit tests** without Dynamo.
2. Until then: **mock every constructor dependency** of `ProcessBillingEventUseCase`:
   - `createEntitlementUseCase.execute`
   - `syncProductLimitsUseCase.execute`
   - `eventPublisher.publishCreated|Updated|Revoked`
   - `entitlementRepo.findByUser`, `findByUserAndKey`, `update`
   - `productRepo.findById`
   - `dunningRepo.findByUserId` (optional)
   - `processedPaymentsRepo` (optional)

3. For each **public** behavior, one **describe** block:
   - `execute` skips `payment.failed`
   - `subscription.created` calls create + add-ons + publish
   - `revokeEntitlements` returns early on dunning → **assert whether publish should run** (today it still runs — your test documents the bug or drives a fix)

**Assertions style**

- Prefer: “`syncProductLimitsUseCase.execute` called with `{ productId, userId, isAddon: false, isOneTimePayment: true }` for one-off payment path.”
- Avoid: asserting on internal private method names unless you refactor to testable units.

**Research if stuck**

- **Testing async code** (Jest/Vitest), **mocking modules**, **test doubles** (stub vs mock vs spy).
- Read **`SyncProductLimitsToEntitlementsUseCase`** in `libs/domain` to know what “sync” really does.

---

### 7.5 `src/infrastructure/event.publisher.ts`

**What it does**

- Sends JSON to SNS with `MessageAttributes.eventType`.

**Shortcomings**

- Swallows errors — **silent data loss** from the point of view of subscribers; tradeoff so entitlement writes still succeed.

**How to test**

- Mock `SNSClient.prototype.send` or inject a client (would require a small refactor for dependency injection).
- Assert `PublishCommand` input: `TopicArn`, `Message` JSON shape, attributes.

---

### 7.6 `src/infrastructure/processed-payments.repository.ts`

**What it does**

- `GetCommand` / `PutCommand` on `PROCESSED_EVENTS_TABLE` with key `PAYMENT#{paymentIntentId}` and TTL.

**Shortcomings**

- No **ConditionExpression** on Put → **race** under concurrent processors.
- TTL = **90 days** — old replays after expiry could re-apply (rare).

**How to test**

- Mock `DynamoDBDocumentClient.send` to return `{ Item: undefined }` vs `{ Item: {} }`.
- Assert `PutCommand` includes `ttl` roughly `now + 90d` (use fake timers).

---

### 7.7 `@libs/domain` (outside this folder)

**What it does**

- Defines **billing event types**, **entitlement entity**, **Dynamo mappers**, **sync and create use cases**.

**Shortcomings**

- Bugs here affect **all** services using the library; changes need extra care.

**How to test**

- Unit tests **in `libs/domain`** near the use case you change.
- From entitlement-service: run monorepo test script if present (`npm test` at root — check repo conventions).

**Research if stuck**

- **Domain-Driven Design** basics (entity vs value object vs use case).
- Read `libs/domain/src/billing-events` and `libs/domain/src/entitlements`.

---

## 8. When you do not understand something

### 8.1 Questions to ask yourself

- **What is the input?** (One SQS message → one billing JSON.)
- **What is the output?** (Dynamo rows changed + optional SNS publishes + SQS batch response.)
- **Which layer owns this?** (Transport vs policy vs domain.)
- **What happens on retry?** (SQS redelivery — idempotency matters.)

### 8.2 What to research (by symptom)

| Symptom | Research topic |
|---------|----------------|
| “Why did the message come back?” | SQS **visibility timeout**, **DLQ**, Lambda **partial batch failures**. |
| “Why two SNS messages?” | Batching, `publishEntitlementEvents` looping **all** entitlements. |
| “Why JSON inside JSON?” | **SNS → SQS** fan-out message structure. |
| “Why no duplicate protection?” | **At-least-once** delivery, **idempotency keys**, **conditional writes** in DynamoDB. |
| “What is dunning?” | Collections / failed payment timelines; read `libs/domain/src/dunning` and REQUIREMENTS doc §5.4. |
| “What does sync limits do?” | Open `SyncProductLimitsToEntitlementsUseCase` implementation. |

### 8.3 Who to ask (template)

When you ask a teammate, include:

1. **Event type** and sample **redacted** payload.
2. **What you expected** vs **what happened** (Dynamo row + SNS if relevant).
3. **Whether the message retried** (approx receive count from SQS if available).
4. **What you already read** (link to code line or file).

That respects their time and speeds up answers.

---

## 9. How to approach testing (philosophy + concrete tactics)

### 9.1 Testing pyramid for this service

```text
        /\
       /  \   Few E2E / integration (real AWS or LocalStack)
      /____\
     /      \  More unit tests (handlers, parsers, pure logic)
    /________\
```

- **Unit tests** are cheap and fast: start here for `parse-event` and handler batch logic.
- **Use case tests** need heavy mocking unless you refactor dependencies; still valuable for **regressions** when you fix bugs like “publish after skipped revoke.”
- **Integration tests** are expensive but catch IAM, VPC, and SDK wiring mistakes.

### 9.2 Test tooling (pick what the repo uses)

Check the **payment monorepo root** for Jest/Vitest/Mocha. If nothing exists yet for this package, propose **Vitest** or **Jest** with `ts-jest` — align with team standards before adding files.

### 9.3 Fixtures

Create `src/__tests__/fixtures/` (or `test/fixtures/`) with:

- `billing-event-subscription-created.json`
- `sns-wrapped-subscription-created.json` (full SQS `body` string)
- `sqs-event-two-records.json`

Keep **fake UUIDs**; no real user emails.

### 9.4 What “good” looks like for one test

```text
Name:     parseSqsRecord unwraps SNS Notification and returns billing event
Arrange:  const record = { body: JSON.stringify(snsEnvelope), ... }
Act:      const result = parseSqsRecord(record)
Assert:   result.type === "subscription.created"
          result.payload.userId === "..."
```

### 9.5 Property-based / fuzz testing (advanced, optional)

For `parse-event`, random JSON that is not SNS-shaped should either parse as direct event or throw predictably — fuzzing can find odd crashes; optional intern stretch goal.

---

## 10. First-week checklist

- [ ] Run `npm install` and `npm run build` in `services/entitlement-service`.
- [ ] Draw your own diagram: producer → SNS → SQS → Lambda → Dynamo/SNS.
- [ ] List all **billing `type`** strings handled in `execute`’s `switch`.
- [ ] Trace **`subscription.updated`** line by line with a paper payload.
- [ ] Read [REQUIREMENTS_AND_TECH_SPEC.md](./REQUIREMENTS_AND_TECH_SPEC.md) sections 5.4–6.2 (dunning + publish).
- [ ] Find **`SyncProductLimitsToEntitlementsUseCase`** in `libs/domain` and summarize in 5 sentences.
- [ ] Write **one** unit test for `parseSqsRecord` (get team review on test runner choice first if none exists).

---

## 11. Reading material and links

### 11.1 Official AWS (free)

- [AWS Lambda concepts](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [SQS partial batch failure reporting](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html#services-sqs-batchfailurereporting) — matches `SQSBatchResponse`.
- [SNS message formats](https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html) — understand `Type`, `Message`.
- [DynamoDB basics](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.html) — keys, TTL, conditional writes.

### 11.2 Concepts (articles / books)

- **Idempotency** in event-driven systems — search “idempotent consumer SQS.”
- **Hexagonal architecture** — why `bootstrap` and repositories sit at the edges.
- **Domain events** — your `BillingEvent` types are a form of domain event contract.

### 11.3 TypeScript / testing

- TypeScript handbook: [Modules](https://www.typescriptlang.org/docs/handbook/modules.html) and [async/await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function).
- Jest or Vitest docs for **mocking** and **fake timers**.

### 11.4 Internal docs (this folder)

| Doc | Use when |
|-----|----------|
| [README.md](./README.md) | Running builds, env examples, operator overview. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Terraform names, file map, `@libs/domain` boundary. |
| [REQUIREMENTS_AND_TECH_SPEC.md](./REQUIREMENTS_AND_TECH_SPEC.md) | Exact edge cases, defects, traceability matrix. |

---

## Closing advice

You are allowed to read slowly. Event-driven services feel indirect at first: **there is no “button”** — only messages. Once you internalize **“one message → one `execute` → many Dynamo ops → many SNS publishes”**, the codebase becomes navigable.

When you improve tests or fix a defect, **update REQUIREMENTS_AND_TECH_SPEC.md** (or a CHANGELOG) in the same PR so the next intern inherits accurate documentation.

Welcome to the codebase.
