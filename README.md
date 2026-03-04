# Sojourner API Documentation

## Payment System

The subscription system uses a **two-phase creation pattern** to handle Dodo Payments' checkout session flow where subscription IDs aren't available immediately.

**Old Flow (owning to dodopayments deprecating the create subscriptions endpoint):** Creation of subscriptions happened before payment meaning that when a user was redirected to dodopayments checkout, the `subscription_id` would be issued at this point.

```ts

subscriptions.create → immediate dodoSubscriptionId → save to DB → webhooks update

```

**New Flow (Current):**

```ts

checkoutSessions.create → sessionId only → save pending record → webhook populates dodoSubscriptionId

```

## The Decoupling Problem

**Core Issue:** The checkout session API returns an object with `sessionId` and `checkoutUrl`, not an object `dodoSubscriptionId` and other useful data like subscription expiry dates. The subscription ID and other information arrive later (after the user completes the payment flow) via webhook, creating a temporal gap.

**Challenge:** Services expected immediate `dodoSubscriptionId` for database lookups, but now must work without it until the webhook arrives.

## Two-Phase Approach

### Phase 1: Checkout Session Creation

**Location:** `IndividualSubscriptionService.createIndividualSubscription()` / `GroupSubscriptionService.createGroupSubscription()`

**What Happens:**

1. User initiates subscription purchase
2. Call `DodoPaymentService.createIndividualSubscription()` or `createGroupSubscription()`
3. Dodo returns `{ checkoutUrl, sessionId }` (NO dodoSubscriptionId yet)
4. Save DB record with:
   - `dodoSessionId` = sessionId from Dodo
   - `dodoSubscriptionId` = null
   - `status` = 'pending'
5. Redirect user to `checkoutUrl`

**Example - Individual:**

```typescript
const dodoResponse = await this.dodoPaymentService.createIndividualSubscription({
  userId,
  planType: payload.plan_type,
  billingAddress: payload.billing_address,
  email: user.email,
  name: user.name,
  metadata: {
    userId: userId.toString(),
    subscription_type: 'individual',
  },
})
await IndividualSubscription.create({
  userId,
  dodoSessionId: dodoResponse.sessionId, //  Have this
  dodoSubscriptionId: null, //  Don't have this yet
  planType: payload.plan_type,
  status: 'pending',
})
```

**Example - Group:**

```typescript
const dodoResponse = await this.dodoPaymentService.createGroupSubscription({
  ownerUserId,
  planType: payload.plan_type,
  totalSeats: payload.total_seats,
  billingAddress: payload.billing_address,
  email: owner.email,
  name: owner.name,
  metadata: {
    ownerUserId: ownerUserId.toString(), // Critical: owner, not just userId
    subscription_type: 'group',
  },
})
await GroupSubscription.create({
  ownerUserId,
  dodoSessionId: dodoResponse.sessionId, //  Have this
  dodoSubscriptionId: null, //  Don't have this yet
  totalSeats: payload.total_seats,
  inviteCode,
  inviteCodeExpiresAt,
  status: 'pending',
  planType: payload.plan_type,
})
```

### Phase 2: Webhook Activation

**Location:** `WebhookProcessorService` → `IndividualSubscriptionService.handleSubscriptionActive()` / `GroupSubscriptionService.handleSubscriptionActive()`

**What Happens:**

1. User completes payment
2. Dodo sends `subscription.active` webhook with `dodoSubscriptionId`
3. Extract `userId`/`ownerUserId` from webhook metadata
4. Find subscription by `userId`/`ownerUserId` + `whereNull('dodoSubscriptionId')`
5. Populate `dodoSubscriptionId`, set `status = 'active'`
6. Update user tiers

**Example - Individual:**

```typescript

async handleSubscriptionActive(
  userId: number,
  dodoSubscriptionId: string,
  expiresAt: string,
  trx: TransactionClientContract
): Promise<User> {
  const subscription = await IndividualSubscription.query({ client: trx })
    .where('user_id', userId)
    .whereNull('dodoSubscriptionId')  // Find the pending one
    .preload('user')
    .forUpdate()
    .firstOrFail()
  await subscription.merge({
    dodoSubscriptionId,  // ← NOW we populate it
    status: 'active',
    expiresAt: DateTime.fromISO(expiresAt),
  }).save()
  await this.gracePeriodService.clearGracePeriod(userId, trx)
  await this.tierService.updateUserTier(userId, 'Payment successful', 'webhook', trx, {
    individual_subscription_id: subscription.id,
  })
  return subscription.user
}

```

**Example - Group:**

```typescript

async handleSubscriptionActive(
  ownerUserId: number,
  dodoSubscriptionId: string,
  expiresAt: string,
  trx: TransactionClientContract
): Promise<User> {
  const groupSubscription = await GroupSubscription.query({ client: trx })
    .where('owner_user_id', ownerUserId)
    .whereNull('dodoSubscriptionId')  // Find the pending one
    .preload('owner')
    .forUpdate()
    .firstOrFail()
  await groupSubscription.merge({
    dodoSubscriptionId,  // ← NOW we populate it
    status: 'active',
    expiresAt: DateTime.fromISO(expiresAt),
  }).save()
  const members = await GroupSubscriptionMember.query({ client: trx })
    .where('group_subscription_id', groupSubscription.id)
    .where('status', 'active')
  // Update tier for all members
  await Promise.all(members.map(async (member) => {
    await this.gracePeriodService.clearGracePeriod(member.userId, trx)
    await this.tierService.updateUserTier(member.userId, 'Group subscription activated', 'webhook', trx, {
      group_subscription_id: groupSubscription.id,
    })
  }))
  return groupSubscription.owner
}

```

## Critical Design Decision: Query by userId/ownerUserId

**Why Not Query by dodoSubscriptionId?**
Because webhooks can arrive **out of order**. If `subscription.renewed` arrives before `subscription.active` completes, `dodoSubscriptionId` is still null and queries fail.

**Solution:** All webhook handlers query by `userId` (individual) or `ownerUserId` (group), never by `dodoSubscriptionId`.

### Individual Subscription Handlers

All handlers receive `userId` and query by it:

```typescript
// subscription.active - populates dodoSubscriptionId
handleSubscriptionActive(userId, dodoSubscriptionId, expiresAt, trx)
// subscription.renewed - queries by userId (works even if dodoSubscriptionId null)
handleSubscriptionRenewed(userId, newExpiresAt, trx)
// subscription.cancelled
handleSubscriptionCancelled(userId, trx)
// subscription.expired
handleSubscriptionExpired(userId, trx)
// subscription.failed
handleSubscriptionFailed(userId, trx)
// subscription.plan_changed
handleSubscriptionPlanChanged(userId, newPlanType, newExpiresAt, trx)
```

Query pattern:

```typescript
const subscription = await IndividualSubscription.query({ client: trx })
  .where('user_id', userId) // ← Always query by userId
  .forUpdate()
  .firstOrFail()
```

### Group Subscription Handlers

All handlers receive `ownerUserId` + `dodoSubscriptionId` and query by `ownerUserId`:

```typescript
// subscription.active - populates dodoSubscriptionId
handleSubscriptionActive(ownerUserId, dodoSubscriptionId, expiresAt, trx)
// subscription.renewed - queries by ownerUserId, populates ID if missing
handleSubscriptionRenewed(ownerUserId, dodoSubscriptionId, newExpiresAt, trx)
// subscription.cancelled
handleSubscriptionCancelled(ownerUserId, dodoSubscriptionId, trx)
// subscription.expired
handleSubscriptionExpired(ownerUserId, dodoSubscriptionId, trx)
// subscription.failed
handleSubscriptionFailed(ownerUserId, dodoSubscriptionId, trx)
// subscription.plan_changed
handleSubscriptionPlanChanged(ownerUserId, dodoSubscriptionId, newQuantity, newPlanType, trx)
```

Query pattern + defensive ID population:

```typescript
const groupSubscription = await GroupSubscription.query({ client: trx })
  .where('owner_user_id', ownerUserId) // ← Always query by ownerUserId
  .preload('owner')
  .forUpdate()
  .firstOrFail()
// Populate dodoSubscriptionId if missing (handles out-of-order webhooks)
if (!groupSubscription.dodoSubscriptionId) {
  groupSubscription.dodoSubscriptionId = dodoSubscriptionId
}
await groupSubscription
  .useTransaction(trx)
  .merge({
    /* updates */
  })
  .save()
```

**Why Pass dodoSubscriptionId to All Handlers?**
So any webhook can populate it if it arrives first. This makes the system resilient to webhook ordering issues.

## Race Condition Resolution

**Problem:** `subscription.renewed` webhook arrives before `subscription.active` completes.

**Old behavior (broken):**

```typescript
// Query by dodoSubscriptionId (still null) → Error: Row not found
const subscription = await GroupSubscription.where('dodoSubscriptionId', dodoSubId).first()
```

**New behavior (fixed):**

```typescript
// Query by ownerUserId (always exists) → Success
const subscription = await GroupSubscription.where('ownerUserId', ownerUserId).first()
// Populate ID if missing
if (!subscription.dodoSubscriptionId) {
  subscription.dodoSubscriptionId = dodoSubscriptionId
}
```

## Metadata Requirements

**Critical:** Metadata is how webhook handlers identify which subscription to update.

### Individual Subscriptions

Must include in metadata:

```typescript

{
  userId: userId.toString(),
  subscription_type: 'individual'
}

```

### Group Subscriptions

Must include in metadata:

```typescript

{
  ownerUserId: ownerUserId.toString(),  // NOT userId - owner's ID because semantically correct and it is a subtle indicator that you are dealing with group subscription information
  subscription_type: 'group'
}

```

**Location:** `DodoPaymentService.createIndividualSubscription()` / `createGroupSubscription()`

```typescript

// Individual
const response = await this.client.checkoutSessions.create({
  product_cart: [...],
  billing_address: {...},
  customer: {...},
  metadata: {
    userId: params.userId.toString(),
    subscription_type: 'individual',
  },
  return_url: env.get('FRONTEND_URL'),
})
// Group
const response = await this.client.checkoutSessions.create({
  product_cart: [...],
  billing_address: {...},
  customer: {...},
  metadata: {
    ownerUserId: params.ownerUserId.toString(),
    subscription_type: 'group',
  },
  return_url: env.get('FRONTEND_URL'),
})

```

## Webhook Processing Flow

**File:** `WebhookProcessorService.processWebhookEvent()`

### subscription.active

```typescript
const userId = Number(payload.metadata?.userId)
const ownerUserId = Number(payload.metadata?.ownerUserId)
const dodoSubId = payload.subscription_id
const expiresAt = payload.expires_at
if (subType === 'individual') {
  // Find pending subscription by userId
  let subscription = await IndividualSubscription.query({ client: trx })
    .where('userId', userId)
    .whereNull('dodoSubscriptionId')
    .first()
  // Call handler to populate dodoSubscriptionId
  return individualSubscriptionService.handleSubscriptionActive(userId, dodoSubId, expiresAt, trx)
}
if (subType === 'group') {
  // Find pending subscription by ownerUserId
  let subscription = await GroupSubscription.query({ client: trx })
    .where('ownerUserId', ownerUserId)
    .whereNull('dodoSubscriptionId')
    .first()
  // Call handler to populate dodoSubscriptionId
  return groupSubscriptionService.handleSubscriptionActive(ownerUserId, dodoSubId, expiresAt, trx)
}
```

### subscription.renewed

```typescript
const userId = Number(payload.metadata?.userId)
const ownerUserId = Number(payload.metadata?.ownerUserId)
const dodoSubId = payload.subscription_id
const newExpiresAt = payload.expires_at
if (subType === 'individual') {
  return individualSubscriptionService.handleSubscriptionRenewed(userId, newExpiresAt, trx)
}
if (subType === 'group') {
  return groupSubscriptionService.handleSubscriptionRenewed(
    ownerUserId,
    dodoSubId,
    newExpiresAt,
    trx
  )
}
```

### Other Webhooks (cancelled, expired, failed, plan_changed)

Same pattern:

1. Extract `userId`/`ownerUserId` from metadata
2. Extract `dodoSubId` from payload
3. Pass both to handler
4. Handler queries by `userId`/`ownerUserId`
5. Handler populates `dodoSubscriptionId` if null
6. Handler performs updates

## Database Schema

### individual_subscriptions

```sql

CREATE TABLE individual_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  dodo_session_id VARCHAR(255) NOT NULL UNIQUE,      -- Phase 1: From checkout
  dodo_subscription_id VARCHAR(255) UNIQUE,           -- Phase 2: From webhook (nullable)
  plan_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_individual_subscriptions_user_id ON individual_subscriptions(user_id);
CREATE INDEX idx_individual_subscriptions_dodo_session_id ON individual_subscriptions(dodo_session_id);
CREATE INDEX idx_individual_subscriptions_dodo_subscription_id ON individual_subscriptions(dodo_subscription_id);

```

### group_subscriptions

```sql

CREATE TABLE group_subscriptions (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  dodo_session_id VARCHAR(255) NOT NULL UNIQUE,      -- Phase 1: From checkout
  dodo_subscription_id VARCHAR(255) UNIQUE,           -- Phase 2: From webhook (nullable)
  total_seats INTEGER NOT NULL,
  invite_code VARCHAR(255) UNIQUE,
  invite_code_expires_at TIMESTAMP,
  plan_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_group_subscriptions_owner_user_id ON group_subscriptions(owner_user_id);
CREATE INDEX idx_group_subscriptions_dodo_session_id ON group_subscriptions(dodo_session_id);
CREATE INDEX idx_group_subscriptions_dodo_subscription_id ON group_subscriptions(dodo_subscription_id);

```

## Key Differences: Individual vs Group

| Aspect                      | Individual                     | Group                                 |
| --------------------------- | ------------------------------ | ------------------------------------- |
| **Metadata key**            | `userId`                       | `ownerUserId`                         |
| **DB lookup**               | `where('user_id', userId)`     | `where('owner_user_id', ownerUserId)` |
| **Tier updates**            | Single user                    | All active members                    |
| **Handler params (active)** | `userId, dodoSubId, expiresAt` | `ownerUserId, dodoSubId, expiresAt`   |
| **Handler params (others)** | `userId`                       | `ownerUserId, dodoSubId`              |
| **ID population**           | Only in `active` handler       | In ALL handlers (defensive)           |

## Orphan Healing

If a webhook arrives without a matching pending subscription (edge case) because for some reason the user completed payment but got cut off or the server goes down so the database does not record the initial `session_id` but receives the webhook, then the system creates one from the webhook payload as below:

```ts

if (!subscription) {
  logger.warn(`Orphan subscription found. Healing now: ${dodoSubId}`)
  subscription = await GroupSubscription.create({
    ownerUserId,
    dodoSessionId: payload.session_id || 'unknown',
    dodoSubscriptionId: null,
    totalSeats,
    inviteCode,
    inviteCodeExpiresAt,
    status: 'pending',
    planType: resolvePlanType(...)
  }, { client: trx })
}

```

## Debugging Checklist

### Webhook fails with "Row not found"

- Check metadata includes correct `userId`/`ownerUserId`
- Verify handler queries by `userId`/`ownerUserId`, not `dodoSubscriptionId`
- Confirm `dodoSessionId` was saved in Phase 1

### dodoSubscriptionId stays null

- Check `subscription.active` webhook arrived
- Verify handler calls `.merge({ dodoSubscriptionId })` and `.save()`
- Check for transaction rollbacks

### Duplicate subscriptions created

- Verify `dodo_session_id` has UNIQUE constraint
- Check idempotency in webhook processing
- Confirm no race conditions in Phase 1 creation

### Wrong subscription updated

- Verify metadata has correct `userId`/`ownerUserId` (not switched)
- Check webhook processor extracts correct metadata field for group vs individual

## Complete Flow Diagram

```ts

User Checkout
    ↓
DodoPaymentService.createGroupSubscription()
    ↓
Dodo API: checkoutSessions.create()
    ↓
← { checkoutUrl, sessionId }
    ↓
DB: Save with dodoSessionId=sessionId, dodoSubscriptionId=null, status='pending'
    ↓
Redirect user to checkoutUrl
    ↓
[User completes payment]
    ↓
Dodo → subscription.active webhook
    ↓
WebhookProcessorService.handleSubscriptionActive()
    ↓
Extract ownerUserId from metadata
    ↓
Find subscription: where('owner_user_id', ownerUserId).whereNull('dodoSubscriptionId')
    ↓
GroupSubscriptionService.handleSubscriptionActive()
    ↓
Populate: dodoSubscriptionId, status='active', expiresAt
    ↓
Clear grace periods, update tiers
    ↓
 Subscription fully active
[Later: subscription.renewed webhook]
    ↓
Extract ownerUserId from metadata
    ↓
Find subscription: where('owner_user_id', ownerUserId)
    ↓
Populate dodoSubscriptionId if null (defensive)
    ↓
Update expiresAt, maintain status='active'
    ↓
Update tiers
    ↓
 Subscription renewed

```

## Files Modified

1. **DodoPaymentService** - Added metadata to checkout session creation
2. **IndividualSubscriptionService** - Two-phase creation, userId-based handlers
3. **GroupSubscriptionService** - Two-phase creation, ownerUserId-based handlers
4. **WebhookProcessorService** - Extract userId/ownerUserId, pass to handlers
5. **Models** - Added `dodoSessionId`, made `dodoSubscriptionId` nullable
6. **Migrations** - Added columns, indexes

## Summary

The decoupled architecture solves the temporal gap between checkout and subscription activation by:

1. **Saving early** with `dodoSessionId` (from checkout)
2. **Querying by stable identifiers** (`userId`/`ownerUserId`)
3. **Populating late** with `dodoSubscriptionId` (from webhook)
4. **Handling disorder** via defensive ID population in all handlers

---

## Queue System

Sojourner API uses a PostgreSQL-backed job queue instead of a dedicated queue broker like [BullMQ](https://bullmq.io/). All job state lives in the same database as the rest of the application. This was a deliberate early-stage decision: it eliminated the need for a separate Redis instance (cost and maintenance), removed the learning curve of a dedicated queue library, and kept the infrastructure footprint small while Sojourner API was being built. The tradeoff is that high-throughput workloads would eventually warrant moving to a proper broker, but for current volumes it is the right fit.

The queue is built on [AdonisJS](https://adonisjs.com/) with [Lucid ORM](https://lucid.adonisjs.com/) and [Knex.js](https://knexjs.org/) under the hood for query building, running against PostgreSQL. The scheduler is powered by [adonisjs-scheduler](https://github.com/KABBOUCHI/adonisjs-scheduler).

There are two queues: **`emails`** for transactional emails (auth and subscription), and **`webhooks`** for processing incoming payment events from DodoPayments.

---

## Architecture

```text

┌─────────────────────────────────────────────────────────┐
│                     API Service                         │
│                                                         │
│  POST webhooks  ──► WebhooksController                 │
│                         │                               │
│                         │ db.transaction()              │
│                         ▼                               │
│               webhook_events (pending)                  │
│               jobs [queue: webhooks] (pending)          │
│                                                         │
│  Auth flows  ──────► EmailVerification / PasswordReset  │
│                         │                               │
│                         │                               │
│                         ▼                               │
│               jobs [queue: emails] (pending)            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Scheduler Service                       │
│           (node build/bin/console.js scheduler:run)     │
│                                                         │
│   every 5s ──► process:jobs     ──► emails queue        │
│   every 5s ──► process:webhooks ──► webhooks queue      │
│                                                         │
│   every 15m ──► expired_grace_periods                   │
│   quarterly ──► cleanup_password_tokens                 │
│   quarterly ──► clean_expired_tokens                    │
│   quarterly ──► delete completed/failed jobs (3mo+)     │
└─────────────────────────────────────────────────────────┘

```

The API service and the scheduler service are deployed as two separate Dokploy services, each built from its own Dockerfile. They share the same PostgreSQL database. The scheduler never handles HTTP traffic — it only reads from and writes to the `jobs` and `webhook_events` tables.

## Database Tables

### `jobs`

The central queue table. Both the `emails` and `webhooks` queues are rows in this table, distinguished by `queue_name`.

| Column | Type | Description |
| |--- |---| --- |
| `id` | integer (PK) | Auto-incrementing job ID |
| `queue_name` | string | `'emails'` or `'webhooks'` |
| `payload` | JSON | Queue-specific payload (see below) |
| `status` | string | `pending`, `processing`, `completed`, `failed` |
| `priority` | integer | Lower value = processed first |
| `attempts` | integer | Number of times this job has been attempted |
| `scheduled_for` | datetime (nullable) | Earliest time the job may run; `null` means run immediately |
| `last_error` | string (nullable) | Error message from the most recent failed attempt |
| `created_at` | datetime | Row creation timestamp |
| `updated_at` | datetime | Last updated timestamp |

#### Payload shapes

```ts
// queue_name: 'webhooks'
interface WebhookJobPayload {
  eventId: number // FK → webhook_events.id
}

// queue_name: 'emails'
interface EmailJobPayload {
  userId: number
  emailType: 'email_verification' | 'password_reset' | 'subscription_confirmation'
  metadata?: Record<string, any> // e.g. { plainToken, eventName }
}
```

### `webhook_events`

A dedicated audit table for every verified DodoPayments webhook delivery. A `webhook_events` row is always created before its corresponding `jobs` row, inside the same transaction, so there is never a job without an event record.

| Column         | Type                | Description                                                        |
| -------------- | ------------------- | ------------------------------------------------------------------ |
| `id`           | integer (PK)        | Auto-incrementing ID                                               |
| `event_id`     | string              | Dodo webhook delivery ID (from `webhook-id` header)                |
| `event_type`   | string              | e.g. `subscription.active`, `subscription.renewed`                 |
| `business_id`  | string              | Dodo business identifier                                           |
| `payload`      | JSON                | Full verified webhook payload                                      |
| `status`       | string              | Mirrors job status: `pending`, `processing`, `completed`, `failed` |
| `attempts`     | integer             | Number of processing attempts                                      |
| `last_error`   | string (nullable)   | Error from last failed attempt                                     |
| `processed_at` | datetime (nullable) | Set when successfully processed                                    |
| `created_at`   | datetime            | Row creation timestamp                                             |
| `updated_at`   | datetime            | Last updated timestamp                                             |

---

## Job Lifecycle

```text

                    ┌─────────┐
                    │ pending │ ◄─── job created (or recovered from stuck)
                    └────┬────┘
                         │ worker picks job (FOR UPDATE SKIP LOCKED)
                         ▼
                  ┌────────────┐
                  │ processing │
                  └─────┬──────┘
              ┌─────────┴──────────┐
              │ success            │ failure
              ▼                    ▼
        ┌───────────┐        ┌────────┐
        │ completed │        │ failed │
        └───────────┘        └───┬────┘
                                 │ attempts < MAX (3)
                                 ▼
                           ┌─────────┐
                           │ pending │ (scheduled_for = now + delay)
                           └─────────┘

```

Status transitions for webhook jobs are written within the same database transaction as the business logic, so a crash mid-processing will not leave a job silently dropped — see [Stuck Job Recovery](#stuck-job-recovery) below.

---

## Queue Workers

### `process:jobs` — Email Queue

**File:** `commands/process_jobs.ts`
**Schedule:** every 5 seconds, `withoutOverlapping()`

Handles all outbound emails. On each invocation it:

1. Queries the `jobs` table for a single due `emails` job (`pending` or retryable `failed`), ordered by `priority → scheduled_for → created_at`.
2. Acquires a row-level lock with `FOR UPDATE SKIP LOCKED` so concurrent invocations never double-process the same job.
3. Sets `status = 'processing'` and dispatches based on `emailType`:
   - **`email_verification`** — resolves `emailVerificationService` from the IoC container and sends the verification email using the plain token in `metadata`.
   - **`password_reset`** — resolves `passwordResetService` and sends the reset email.
   - **`subscription_confirmation`** — resolves `subscriptionEmailService` and sends the subscription receipt.
4. On success: sets `status = 'completed'`, clears `last_error`.
5. On failure: increments `attempts`, sets `status = 'failed'`, writes `last_error`, and sets `scheduled_for` for the next retry window (see [Retry Logic](#retry-logic)).

> **Note:** `process:jobs` does not open an explicit transaction wrapping both the email dispatch and the job status update. This means a crash after the email sends but before `status = 'completed'` could cause a retry that re-sends the email. Auth emails (verification, password reset) are idempotent in practice because the token is consumed on use; subscription confirmation emails are not strictly idempotent, so this is a known minor caveat.

---

### `process:webhooks` — Webhook Queue

**File:** `commands/process_webhooks.ts`
**Schedule:** every 5 seconds, `withoutOverlapping()`

Handles DodoPayments webhook events. On each invocation it:

1. Calls `recoverStuckWebhooks()` first (see below).
2. Opens a database transaction (`db.transaction()`).
3. Queries for a single due `webhooks` job with `FOR UPDATE SKIP LOCKED`.
4. Sets `job.status = 'processing'` within the transaction.
5. Loads the linked `WebhookEvent` and delegates to `WebhookProcessorService.processWebhookEvent()`.
6. On success:
   - Marks `webhook_event.status = 'completed'`, sets `processedAt`.
   - Marks `job.status = 'completed'`.
   - If `processWebhookEvent()` returned a `User`, creates a new `emails` queue job for `subscription_confirmation` — within the same transaction, so the confirmation email job is only enqueued if the subscription state update committed successfully.
7. On failure: increments attempts on both the `job` and `webhook_event` rows, writes `last_error`, schedules retry.
8. Commits or rolls back the transaction.

Because the entire processing cycle — subscription state mutation, event status update, job status update, and confirmation email enqueue — happens inside one transaction, a failure at any point rolls everything back cleanly.

---

### `WebhookProcessorService` — Event Routing

**File:** `app/services/webhook_processor_service.ts`

Receives a `WebhookEvent` and a transaction client and routes to the appropriate handler based on `event_type`. All handlers run inside the caller's transaction.

| Event type                                     | Handler                         | Description                                                                                       |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `subscription.active`                          | `handleSubscriptionActive`      | Activates an individual or group subscription; heals orphaned subscription records if none exists |
| `subscription.renewed`                         | `handleSubscriptionRenewed`     | Extends `expires_at` on renewal                                                                   |
| `subscription.cancelled`                       | `handleSubscriptionCancelled`   | Marks subscription cancelled                                                                      |
| `subscription.expired`                         | `handleSubscriptionExpired`     | Marks subscription expired                                                                        |
| `subscription.failed` / `subscription.on_hold` | `handleSubscriptionFailed`      | Marks subscription as failed/on hold                                                              |
| `subscription.plan_changed`                    | `handleSubscriptionPlanChanged` | Updates plan type and seat count                                                                  |
| anything else                                  | —                               | Logs a warning; returns `undefined`; job completes without error                                  |

Each handler delegates to either `IndividualSubscriptionService` or `GroupSubscriptionService` depending on `payload.metadata.subscription_type`.

**Orphan healing:** `handleSubscriptionActive` checks for an existing subscription record with a `null` `dodoSubscriptionId`. If none is found it creates one before activating, which handles cases where a checkout session completed but an earlier webhook delivery failed.

---

## Retry Logic

Both workers share the same retry configuration, driven by the `WEBHOOK_MAX_ATTEMPTS` environment variable (defaults to `3`):

```text

MAX_ATTEMPTS  = env.get('WEBHOOK_MAX_ATTEMPTS', 3)
RETRY_DELAYS  = [0, 60, 300]  // seconds: immediate, 1 min, 5 min

```

On each failure the worker calculates `nextAttemptCount = job.attempts + 1`. If `nextAttemptCount < MAX_ATTEMPTS`, the job is rescheduled:

| Attempt                 | Delay before next retry                                           |
| ----------------------- | ----------------------------------------------------------------- |
| 1st failure (attempt 1) | immediate (`scheduled_for = now + 0s`)                            |
| 2nd failure (attempt 2) | 1 minute (`scheduled_for = now + 60s`)                            |
| 3rd failure (attempt 3) | max attempts reached — job stays `failed`, `scheduled_for = null` |

Jobs stay in the table permanently after exhausting retries. They are not deleted automatically until the quarterly cleanup removes `completed` and `failed` rows older than 3 months.

---

## Stuck Job Recovery

`process:webhooks` calls `recoverStuckWebhooks()` at the start of every invocation. It queries for `webhook_events` rows with `status = 'processing'` and `updated_at` older than 5 minutes — indicating the worker that claimed them crashed or was killed before completing. These rows are reset to `status = 'pending'` with `last_error = 'Recovered from stuck processing state'`, making them eligible for pickup on the next cycle.

`process:jobs` does not have an equivalent recovery step. Because it does not wrap the email dispatch in a transaction, a crash mid-send is less likely to leave a job permanently stuck in `'processing'` — but it is worth adding the same recovery step if email delivery volume grows.

---

## Deployment (Dokploy)

The queue system is split across two Dokploy services that share the same PostgreSQL database.

### API Service

Built and run with the standard application Dockerfile. Handles all HTTP traffic including the `POST /webhooks` endpoint. The webhook controller verifies the Dodo signature, then writes a `webhook_events` row and a `jobs` row atomically before returning `200 { received: true }` — the actual processing is fully decoupled from the HTTP response.

### Scheduler Service

**Dockerfile:** `Dockerfile.scheduler`

```dockerfile

FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm i --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm install -g pnpm && pnpm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

CMD ["node", "build/bin/console.js", "scheduler:run"]

```

The container runs `scheduler:run` as a long-lived process. [adonisjs-scheduler](https://github.com/KABBOUCHI/adonisjs-scheduler) fires commands on their configured intervals from within that process without a system cron or external job runner.

**Configured schedules (`start/scheduler.ts`):**

| Command                      | Interval         | Notes                                   |
| ---------------------------- | ---------------- | --------------------------------------- |
| `process:jobs`               | every 5 seconds  | Email queue worker                      |
| `process:webhooks`           | every 5 seconds  | Webhook queue worker                    |
| `expired_grace_periods`      | every 15 minutes | Expires subscriptions past grace period |
| `cleanup_password_tokens`    | quarterly        | Removes expired password reset tokens   |
| `clean_expired_tokens`       | quarterly        | Removes other expired auth tokens       |
| Completed/failed job cleanup | quarterly        | Deletes `jobs` rows older than 3 months |

All scheduled commands use `.withoutOverlapping()`, which prevents a second invocation from starting if the previous one is still running.

### Environment Variables

The scheduler service requires the same database connection environment variables as the API service. Ensure the following are set in the Dokploy environment configuration for the scheduler service:

```text

NODE_ENV=production
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_DATABASE=
WEBHOOK_MAX_ATTEMPTS=3   # optional; defaults to 3

```

---

## Webhook Ingestion Flow (End-to-End)

```text

DodoPayments
    │
    │ POST /webhooks
    │ (webhook-id, webhook-signature, webhook-timestamp headers)
    ▼
WebhooksController.handle()
    │
    ├── verify signature via dodoPaymentService.client.webhooks.unwrap()
    │       └── on failure → 400 WebhookVerificationException
    │
    └── db.transaction()
            ├── INSERT webhook_events (status: pending)
            ├── INSERT jobs [queue: webhooks] (status: pending)
            └── commit
    │
    ▼
200 { received: true }   ← DodoPayments considers delivery complete

    ... (up to 5 seconds later) ...

process:webhooks (scheduler)
    │
    ├── recoverStuckWebhooks()
    ├── db.transaction()
    │       ├── SELECT job FOR UPDATE SKIP LOCKED
    │       ├── job.status = 'processing'
    │       ├── WebhookProcessorService.processWebhookEvent()
    │       │       └── mutates subscription state
    │       ├── webhook_event.status = 'completed'
    │       ├── job.status = 'completed'
    │       ├── INSERT jobs [queue: emails, type: subscription_confirmation]
    │       └── commit
    │
    ... (up to 5 seconds later) ...

process:jobs (scheduler)
    │
    ├── SELECT email job FOR UPDATE SKIP LOCKED
    ├── subscriptionEmailService.sendSubscriptionConfirmation()
    └── job.status = 'completed'
```

## Real-Time Chat Integration

This section outlines the architecture and implementation details for the real-time chat functionality within Sojourner API. It integrates [Socket.io's Server-API](https://socket.io/docs/v4/server-api/) directly into AdonisJS's underlying Node.js server to ensure seamless session authentication and routing.

## Acknowledgments

A significant architectural insight for this implementation came from the [nedois/adonis-chat-demo](https://github.com/nedois/adonis-chat-demo) repository. It provided the critical pattern for correctly tapping into AdonisJS's underlying Node.js server and creating a mock HTTP context to parse session cookies over WebSockets.

---

## 1. The Architectural Challenge: Upgrades and Middleware

Integrating Socket.io with AdonisJS presents a two-fold architectural challenge. Because Adonis completely abstracts the underlying Node.js HTTP server and relies on a strict middleware pipeline, a naive Socket.io integration typically fails in two distinct phases: first at the protocol upgrade level, and second when attempting to access the HTTP context for authentication.

### Phase 1: The Upgrade Failure (Stuck on "Switching Protocols")

Before a WebSocket connection can be established, the client must send an HTTP request with an `Upgrade: websocket` header.

- **The Error:** The client browser throws `WebSocket is closed before the connection is established`, and the network tab shows the request permanently stuck in the "Switching Protocols" status.
- **The Cause:** By default, AdonisJS's HTTP router handles all incoming traffic. If you attempt to instantiate Socket.io by passing the Adonis server object directly (instead of extracting the raw Node.js server), the Adonis router intercepts the upgrade request, fails to process the WebSocket protocol, and drops the connection.

**The Broken Code (Phase 1):**

```ts
// ❌ BAD: Passing the Adonis server abstraction directly
import app from '@adonisjs/core/services/app'
import { Server } from 'socket.io'

class Websocket {
  async boot() {
    const adonisServer = await app.container.make('server')

    // This fails the WebSocket upgrade protocol
    // adonisServer is not a native Node HTTP server!
    this.io = new Server(adonisServer, socketConfig)
  }
}
```

### Phase 2: The Middleware Bypass (Authentication Failure)

Once the server is correctly bound using `adonisServer.getNodeServer()` and the socket upgrade succeeds, the connection inherently bypasses the standard Adonis HTTP middleware stack.

- **The Error:** `E_UNAUTHORIZED_ACCESS: Invalid or expired user session` at `SessionGuard.getUserOrFail`, and the socket is disconnected.
- **The Cause:** Because the standard session middleware was bypassed during the WebSocket upgrade, the incoming socket request never read or decrypted the session cookie. When the Auth module attempts to resolve the user, it finds an empty session and panics.

**The Broken Code (Phase 2):**

```ts
// ❌ BAD: Attempting to auth without awaiting or rebuilding the context
export function setupWebsocketsHandlers(io: Server) {
  io.on('connection', (socket: ExtendedSocket) => {
    try {
      // Fails: Not awaited, and no custom middleware ran to parse the cookie
      socket.context.auth.authenticateUsing(['web'])
    } catch {
      socket.disconnect(true)
      return
    }

    // Crashes the server with E_UNAUTHORIZED_ACCESS
    const user = socket.context.auth.getUserOrFail()
  })
}
```

### The Solution

To resolve both phases, the Sojourner API explicitly binds Socket.io to the raw Node server (fixing the upgrade), and implements custom Socket middleware, see the `/app/middleware/socket/socket_http_context_middleware.ts` directory, to rebuild the HTTP context, decrypt the session, and await the authentication guard (fixing the auth).

---

## 2. Core Implementation Strategy

The integration is broken down across specific services, providers, and custom middleware to strictly separate concerns and maintain the service patterns.

### A. Tapping the Underlying Node Server

**File:** `app/services/socket.ts`

Instead of starting a separate Nodejs/maybe an Express server (which causes port conflicts and detaches the socket from the Adonis ecosystem), this service acts as a singleton. It extracts the raw Node.js server instance from the Adonis application container and attaches Socket.io directly to it. This allows HTTP and WebSocket traffic to safely share the same port.

### B. Bootstrapping via Provider

**File:** `app/providers/socket_provider.ts`

This Adonis Service Provider ensures the socket server boots securely during the application's `ready` lifecycle phase. For more information on AdonisJS's lifecycles see documentation at [AdonisJS-lifecycles] It also handles dynamic imports for the WebSocket handlers to ensure all Adonis services are fully booted before listeners are attached. Finally, it registers a `shutdown` hook to close the socket server cleanly, preventing memory leaks or hanging ports during terminal commands (such as running migrations).

### C. Rebuilding the HTTP Context

**File:** `app/middleware/socket/socket_http_context_middleware.ts`

This is the most critical piece of the architecture. This custom Socket.io middleware intercepts the initial handshake. It takes the raw Node `socket.request`, creates a mock `ServerResponse`, and forces the Adonis server instance to build a complete `HttpContext`.

Once the context is created, it resolves the `auth.manager` from the IoC container, creates an authenticator, and attaches the fully hydrated context back onto the socket object (`socket.context`). This allows standard Adonis session authentication to function over the WebSocket protocol.

### D. WebSocket Handlers and Room Management

**File:** `app/services/websocket_service.ts`

Once the context is established by the middleware, this service manages real-time state and event listeners.

- **State Management:** Uses in-memory maps (`userConnections`, `typingUsers`, `typingTimeouts`) to track active socket IDs against authenticated user IDs.
- **Connection Logic:** The `connection` handler safely extracts the authenticated user from the injected `socket.context.auth`. If the user is invalid, the socket is immediately disconnected.
- **Event Listeners:** Registers all core chat events — `join_room`, `send_message`, `typing_start`, `typing_stop`, `disconnect`. Also exports utility functions such as `disconnectUserFromGroup` to allow standard HTTP controllers to force-kick users from active socket rooms when access is revoked.

---

## 3. Service Layer Architecture

**File:** `app/services/chat_service.ts`

Database interactions are strictly decoupled from the WebSocket layer to keep the real-time server performant. The `websocket_service.ts` resolves `ChatService` via the Adonis IoC container to handle all database work.
