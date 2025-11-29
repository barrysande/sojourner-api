# Dodo Payments Subscription System - Decoupled Architecture Documentation

## Overview

The subscription system uses a **two-phase creation pattern** to handle Dodo Payments' checkout session flow where subscription IDs aren't available immediately.

**Old Flow (Deprecated):**

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

## Two-Phase Architecture

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
  dodoSessionId: dodoResponse.sessionId, // ✓ Have this
  dodoSubscriptionId: null, // ✗ Don't have this yet
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
  dodoSessionId: dodoResponse.sessionId, // ✓ Have this
  dodoSubscriptionId: null, // ✗ Don't have this yet
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
  ownerUserId: ownerUserId.toString(),  // NOT userId - owner's ID
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
    dodoSubId, // Pass for defensive population
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

If a webhook arrives without a matching pending subscription (edge case), the system creates one:

```typescript
if (!subscription) {
  logger.warn(`ORPHAN subscription found. Healing now: ${dodoSubId}`)

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

- ✓ Check metadata includes correct `userId`/`ownerUserId`
- ✓ Verify handler queries by `userId`/`ownerUserId`, not `dodoSubscriptionId`
- ✓ Confirm `dodoSessionId` was saved in Phase 1

### dodoSubscriptionId stays null

- ✓ Check `subscription.active` webhook arrived
- ✓ Verify handler calls `.merge({ dodoSubscriptionId })` and `.save()`
- ✓ Check for transaction rollbacks

### Duplicate subscriptions created

- ✓ Verify `dodo_session_id` has UNIQUE constraint
- ✓ Check idempotency in webhook processing
- ✓ Confirm no race conditions in Phase 1 creation

### Wrong subscription updated

- ✓ Verify metadata has correct `userId`/`ownerUserId` (not switched)
- ✓ Check webhook processor extracts correct metadata field for group vs individual

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
✓ Subscription fully active

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
✓ Subscription renewed
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

This makes the system resilient to webhook timing issues while maintaining data integrity.
