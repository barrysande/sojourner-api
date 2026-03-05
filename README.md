# Sojourner API Docs

## Payment System

The subscription system uses a **two-phase creation pattern** to handle Dodo Payments' checkout session flow where subscription IDs aren't available immediately.

**Old Flow (switched from this because dodopayments deprecated the create subscriptions endpoint):** Creation of subscriptions happened before payment meaning that when a user was redirected to dodopayments checkout, the `subscription_id` would be issued at this point.

```ts

subscriptions.create → immediate dodoSubscriptionId → save to DB → webhooks update

```

**New Flow (Current):**

```ts

checkoutSessions.create → sessionId only → save pending record → webhook populates dodoSubscriptionId

```

### The Decoupling Problem

**Core Issue:** The checkout session API returns an object with `sessionId` and `checkoutUrl`, not an object with `paymentLink`, `dodoSubscriptionId`, and other useful data like subscription expiry dates. The subscription ID and other information arrive later (after the user completes the payment flow) via webhook, creating a temporal gap of information in the old flow.

**Challenge:** Services expected immediate `dodoSubscriptionId` for database lookups, but now must work without it until the webhook arrives.

### Two-Phase Approach

Create a record with the available information ie `sessionId`, `checkoutUrl`, and `status` set to `pending`. Then update the relevant tables using the the webhooks payload information once processed.

#### Phase 1: Checkout Session Creation

**Location:** `IndividualSubscriptionService.createIndividualSubscription()` / `GroupSubscriptionService.createGroupSubscription()`

**What Happens:**

1. User initiates subscription attempt
2. Call `DodoPaymentService.createIndividualSubscription()` or `createGroupSubscription()`
3. Dodo returns `{ checkoutUrl, sessionId }` (No dodoSubscriptionId yet)
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
  dodoSessionId: dodoResponse.sessionId,
  dodoSubscriptionId: null, //  don't have this yet
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
    ownerUserId: ownerUserId.toString(),
    subscription_type: 'group',
  },
})
await GroupSubscription.create({
  ownerUserId,
  dodoSessionId: dodoResponse.sessionId,
  dodoSubscriptionId: null, //  don't have this yet
  totalSeats: payload.total_seats,
  inviteCode,
  inviteCodeExpiresAt,
  status: 'pending',
  planType: payload.plan_type,
})
```

#### Phase 2: Webhook Activation

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
    .whereNull('dodo_subscription_id')  // finds the pending one
    .preload('user')
    .forUpdate()
    .firstOrFail()
  await subscription.merge({
    dodoSubscriptionId,  // populates dodo_subscription_id
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
     .whereNull('dodo_subscription_id')   // finds the pending one
    .preload('owner')
    .forUpdate()
    .firstOrFail()
  await groupSubscription.merge({
    dodoSubscriptionId,  // populates dodo_subscription_id
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

---

## Critical Design Decision: Webhook Concurrency & Database Lookups

### Challenge 1: Out-of-Order Webhooks

[Dodo Payments](https://docs.dodopayments.com/developer-resources/webhooks#event-ordering) does not guarantee webhook delivery order. For every new subscription, Dodo sends both `subscription.active` (the subscription is now active and recurring charges are scheduled) and `subscription.renewed` (the first billing cycle was successfully processed). On every subsequent billing cycle, `subscription.renewed` continues to arrive. There is no guarantee which of the two arrives first on that initial pair.

This matters because the `renewed` handler queries by `dodoSubscriptionId`, which only exists after `active` has been processed and written it to the database (we refer to it as the initialiser).

The solution is to treat `handleSubscriptionActive` in `IndividualSubscriptionService` and `GroupSubscriptionService` as the initialiser — the only handler that uses `whereNull('dodo_subscription_id')` to locate and activate the pending record. All other lifecycle handlers
(`renewed`, `cancelled`, `expired`, etc.) query by `dodoSubscriptionId` directly. When `renewed` arrives before `active` has been processed,
`.firstOrFail()` throws, the job queue catches the error, marks the job `failed`, and reschedules it for retry after a delay (`RETRY_DELAYS = [0, 60, 300]` seconds). By the time the retry runs, `active` will have been processed and the `dodoSubscriptionId` populated, allowing `renewed` to find the correct row and complete successfully. The two-phase query pattern is what makes the retry work correctly — without it, the retry would still fail.

### Challenge 2: Selecting the Right Row

Sojourner API enforces a one-active-subscription-per-user rule, but users can accumulate multiple historical subscription records over time (e.g. an expired individual plan followed by a new one). Querying by `userId` alone could match the wrong row.

The `whereNull('dodo_subscription_id')` clause solves this by targeting only the record created during the current checkout session — a null
`dodoSubscriptionId` indicates the subscription has been initiated but not yet activated. While this correlates with `status = 'pending'`, the two are not strictly equivalent and `whereNull` is the more precise signal here.

---

### Phase 1: The Initialiser (`subscription.active`)

**Location:** `webhook_processor_service` → WebhookService.handleSusbcriptionActive() → `IndividualSubscriptionService.handleSubscriptionActive()` / `GroupSubscriptionService.handleSubscriptionActive()`

This handler bridges the gap between the checkout session and the established subscription. Since the database does not yet know the `dodoSubscriptionId`, look up the pending record by the user's identifier.

The `.whereNull('dodo_subscription_id')` clause is applied in `WebhookProcessorService.handleSubscriptionActive` method before calling the service handlers, to confirm a pending record exists and guard against orphan healing.

**Query Pattern:**

- **Individual:** `where('user_id', userId)` + `whereNull('dodo_subscription_id')`
- **Group:** `where('owner_user_id', ownerUserId)` + `whereNull('dodo_subscription_id')`

Both handlers then populate `dodoSubscriptionId`, `dodoCustomerId`, `status`, and `expiresAt` on the located record.

---

### Phase 2: Subscription Lifecycle Updates (`subscription.renewed`, `subscription.cancelled`, `subscription.expired`, `subscription.plan_changed`, `subscription.failed`)

**Location:** `IndividualSubscriptionService` / `GroupSubscriptionService` — respective handler methods

All subsequent webhook handlers query by both the user's identifier and the `dodoSubscriptionId` for a strict match. This prevents a lifecycle event from accidentally targeting the wrong subscription when a user has multiple historical records.

**Query Pattern:**

- **Individual:** `where('user_id', userId)` + `where('dodo_subscription_id', dodoSubscriptionId)`
- **Group:** `where('owner_user_id', ownerUserId)` + `where('dodo_subscription_id', dodoSubscriptionId)`

---

### Race Condition Resolution Flow

Here is how the system automatically heals when `subscription.renewed` is processed before `subscription.active`:

1. The `process:webhooks` worker picks up the `renewed` job and routes it to the handler.
2. The handler queries by `userId` + `dodoSubscriptionId`. Because `subscription.active` hasn't been processed yet, no row with that `dodoSubscriptionId` exists — `.firstOrFail()` throws a `RowNotFoundException`.
3. The worker catches the error, rolls back the transaction, marks the job `failed`, and reschedules it 60 seconds out (`RETRY_DELAYS = [0, 60, 300]`).
4. The worker picks up the `active` job, processes it successfully, and writes `dodoSubscriptionId` onto the subscription record.
5. One minute later, the worker retries the `renewed` job. The strict query now finds the row and updates it successfully.

## Metadata Requirements

Webhook handlers have no direct link to a subscription record — they only receive what Dodo sends back. Metadata is embedded in the checkout session at creation time in `DodoPaymentService.createIndividualSubscription()` / `createGroupSubscription()` and travels with every subsequent webhook for that subscription, giving the handlers the identifiers they need to locate the correct record.

### Individual Subscriptions

```typescript
{
  userId: userId.toString(),
  subscription_type: 'individual'
}
```

### Group Subscriptions

```typescript
{
  ownerUserId: ownerUserId.toString(), // ownerUserId is semantically correct and signals you are dealing with a group subscription
  subscription_type: 'group'
}
```

---

## Webhook Processing Flow

**Location:** `webhook_processor_service.ts`

Extracts `subscription_type`, `userId`/`ownerUserId`, and `dodoSubscriptionId` from the payload, then delegates to the appropriate service handler. See `webhook_processor_service.ts` for the full routing switch.

### `subscription.active`

Handled by `IndividualSubscriptionService.handleSubscriptionActive()` or `GroupSubscriptionService.handleSubscriptionActive()`. Locates the pending record via `whereNull('dodo_subscription_id')` and populates it with the subscription ID, customer ID, status, and expiry.

### `subscription.renewed`

Handled by `IndividualSubscriptionService.handleSubscriptionRenewed()` or `GroupSubscriptionService.handleSubscriptionRenewed()`. Queries by `userId`/`ownerUserId` and updates `expiresAt`.

### Other Webhooks (`subscription.cancelled`, `subscription.expired`, `subscription.failed`, `subscription.plan_changed`)

Same routing pattern — extract identifiers, delegate to the matching service handler. Group handlers additionally receive `dodoSubscriptionId` to populate defensively if null. See individual handler methods in `IndividualSubscriptionService` and `GroupSubscriptionService`.

---

## Database Schema

### individual_subscriptions

See the IndividualSubscription Model for shape - `app/models/individual_subscription.ts`

### group_subscriptions

See the GroupSubscription Model for shape - `app/models/group_subscription.ts`

---

## Orphan Subscription(s) Healing

If a webhook arrives with no matching pending subscription — because the user completed payment but the server was down and never recorded the `session_id` in Phase 1 — the system creates a minimal subscription record from the webhook payload before proceeding with activation. See `webhook_processor_service.ts -> WebhookService.handleSubscriptionActive()` for the healing logic.

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
DodoPaymentService.createGroupSubscription() / createIndividualSubscription()
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
WebhookService.handleSubscriptionActive()
    ↓
Extract ownerUserId from metadata
    ↓
Find subscription: where('owner_user_id', ownerUserId).whereNull('dodo_subscription_id')
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
2. **Querying by** where(`userId`/`ownerUserId`) and whereNull('dodo_subscription_id') where applicable as stated before.
3. **Populating late** with `dodoSubscriptionId` (from webhook)
4. **Handling disorder** via defensive ID population in all handlers

---

## Queue System

Sojourner API uses a database-backed job queue. All job state lives in the same database as the rest of the application. This was a deliberate early-stage decision: it eliminated the need for a separate Redis instance (cost and maintenance), removed the learning curve of a dedicated queue library, and kept the infrastructure footprint small while Sojourner API was being built. The tradeoff is that high-throughput workloads would eventually warrant moving to a proper broker, but for current volumes it is the right fit.

The queue is built using [AdonisJS](https://adonisjs.com/) with [Lucid ORM](https://lucid.adonisjs.com/) PostgreSQL. The scheduler is powered by [adonisjs-scheduler](https://github.com/KABBOUCHI/adonisjs-scheduler).

There are two queues: **`emails`** for transactional emails (auth and subscription), and **`webhooks`** for processing incoming payment events from DodoPayments.

---

## Architecture

The API service and the scheduler service are deployed as two separate Dokploy services, each built from its own Dockerfile. They share the same PostgreSQL database. The scheduler never handles HTTP traffic — it only reads from and writes to the `jobs` and `webhook_events` tables.

## Database Tables

### `jobs`

The central queue table. Both the `emails` and `webhooks` queues are rows in this table, distinguished by `queue_name`.

### `webhook_events`

A dedicated audit table for every verified DodoPayments webhook delivery. A `webhook_events` row is always created before its corresponding `jobs` row, inside the same transaction, so there is never a job without an event record.

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

**Location:** `commands/process_jobs.ts`
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

---

### `process:webhooks` — Webhook Queue

**Location:** `commands/process_webhooks.ts`
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

**Location:** `app/services/webhook_processor_service.ts`

Receives a `WebhookEvent` and a transaction client and routes to the appropriate handler based on `event_type`. All handlers run inside the caller's transaction. |

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

Jobs stay in the table permanently after exhausting retries. They are not deleted automatically until the quarterly cleanup removes `completed` and `failed` rows older than 3 months.

---

## Stuck Job Recovery

`process:webhooks` calls `recoverStuckWebhooks()` at the start of every invocation. It queries for `webhook_events` rows with `status = 'processing'` and `updated_at` older than 5 minutes — indicating the worker that claimed them crashed or was killed before completing. These rows are reset to `status = 'pending'` with `last_error = 'Recovered from stuck processing state'`, making them eligible for pickup on the next cycle.

`process:jobs` does not have an equivalent recovery step. Because it does not wrap the email dispatch in a transaction, a crash mid-send is less likely to leave a job permanently stuck in `'processing'` — but it is worth adding the same recovery step if email delivery volume grows.

---

## Deployment (Dokploy)

The queue system is split across two Dokploy services that share the same PostgreSQL database.

### API Service

Built and run with the standard application Dockerfile. Handles all HTTP traffic.

### Scheduler Service

**Dockerfile:** `Dockerfile.scheduler`

The container runs `scheduler:run` as a long-lived process. [adonisjs-scheduler](https://github.com/KABBOUCHI/adonisjs-scheduler) fires commands on their configured intervals from within that process without a system cron or external job runner.

**Configured schedules (`start/scheduler.ts`):**

All scheduled commands use `.withoutOverlapping()`, which prevents a second invocation from starting if the previous one is still running.

### Environment Variables

The scheduler service requires the same database connection environment variables as the API service. Ensure the following are set in the Dokploy environment configuration for the scheduler service:

```text

NODE_ENV=
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

## 1. The Challenge: Upgrades and Middleware

Integrating Socket.io with AdonisJS presents a two-fold architectural challenge. Because Adonis completely abstracts the underlying Node.js HTTP server and relies on a strict middleware pipeline, a naive Socket.io integration typically fails in two distinct phases: first at the protocol upgrade level, and second when attempting to access the HTTP context for authentication.

### Phase 1: The Upgrade Failure (Stuck on "Switching Protocols")

Before a WebSocket connection can be established, the client must send an HTTP request with an `Upgrade: websocket` header.

- **The Error:** The client browser throws `WebSocket is closed before the connection is established`, and the network tab shows the request permanently stuck in the "Switching Protocols" status.
- **The Cause:** By default, AdonisJS's HTTP router handles all incoming traffic. If you attempt to instantiate Socket.io by passing the Adonis server object directly (instead of extracting the raw Node.js server), the Adonis router intercepts the upgrade request, fails to process the WebSocket protocol, and drops the connection.

### Phase 2: The Middleware Bypass (Authentication Failure)

Once the server is correctly bound using `adonisServer.getNodeServer()` and the socket upgrade succeeds, the connection inherently bypasses the standard Adonis HTTP middleware stack.

- **The Error:** `E_UNAUTHORIZED_ACCESS: Invalid or expired user session` at `SessionGuard.getUserOrFail`, and the socket is disconnected.
- **The Cause:** Because the standard session middleware was bypassed during the WebSocket upgrade, the incoming socket request never read or decrypted the session cookie. When the Auth module attempts to resolve the user, it finds an empty session and panics.

### The Solution

To resolve both phases, the Sojourner API explicitly binds Socket.io to the raw Node server (fixing the upgrade), and implements custom Socket middleware, see the `/app/middleware/socket/socket_http_context_middleware.ts` directory, to rebuild the HTTP context, decrypt the session, and await the authentication guard (fixing the auth).

---

## 2. Implementation Strategy

The integration is broken down across specific services, providers, and custom middleware to strictly separate concerns and maintain the service patterns.

### A. Tapping the Underlying Node Server

**Location:** `app/services/socket.ts`

It extracts the raw Node.js server instance from the Adonis application container and attaches Socket.io directly to it. This allows HTTP and WebSocket traffic to safely share the same port.

### B. Bootstrapping via Provider

**Location:** `app/providers/socket_provider.ts`

This Adonis Service Provider ensures the socket server boots securely during the application's `ready` lifecycle phase. For more information on AdonisJS's lifecycles see documentation at [AdonisJS Aplication Lifecycle](https://v6-docs.adonisjs.com/guides/concepts/application-lifecycle) It also handles dynamic imports for the WebSocket handlers to ensure all Adonis services are fully booted before listeners are attached. Finally, it registers a `shutdown` hook to close the socket server gracefully.

### C. Rebuilding the HTTP Context

**Location:** `app/middleware/socket/socket_http_context_middleware.ts`

This custom Socket.io middleware intercepts the initial handshake. It takes the raw Node `socket.request`, creates a mock `ServerResponse`, and forces the Adonis server instance to build a complete `HttpContext`.

Once the context is created, it resolves the `auth.manager` from the IoC container, creates an authenticator, and attaches the fully hydrated context back onto the socket object (`socket.context`) thereby allowing standard Adonis session authentication to function over the WebSocket protocol.

### D. WebSocket Handlers and Room Management

**Location:** `app/services/websocket_service.ts`

Once the context is established by the middleware, this service manages real-time state and event listeners.

- **State Management:** Uses in-memory maps (`userConnections`, `typingUsers`, `typingTimeouts`) to track active socket IDs against authenticated user IDs.
- **Connection Logic:** The `connection` handler safely extracts the authenticated user from the injected `socket.context.auth`. If the user is invalid, the socket is immediately disconnected.
- **Event Listeners:** Registers all core chat events — `join_room`, `send_message`, `typing_start`, `typing_stop`, `disconnect`. Also exports utility functions such as `disconnectUserFromGroup` to allow standard HTTP controllers to force-kick users from active socket rooms when access is revoked.

---

## 3. Service Layer

**Location:** `app/services/chat_service.ts`

Database interactions are strictly decoupled from the WebSocket layer to keep the real-time server performant. The `websocket_service.ts` resolves `ChatService` via the Adonis IoC container to handle all database work.
