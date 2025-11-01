import type { PlanType, PaymentFrequencyInterval } from '../../types/webhook.js'

export function resolvePlanType(count: number, interval: PaymentFrequencyInterval): PlanType {
  if (interval === 'Month' && count === 1) return 'monthly'
  if (interval === 'Month' && count === 3) return 'quarterly'
  if (interval === 'Year' && count === 1) return 'annual'
  throw new Error(`Unexpected payment frequency: ${count}-${interval}`)
}
