import { MIN_INTERVAL, MAX_INTERVAL } from '../constants'
import { t } from '../i18n'
import { logger } from '../logger'
import type { ReleaseChannel } from '../types'

export function parseIntervalOrExit(value: string, name: string): number {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed < MIN_INTERVAL || parsed > MAX_INTERVAL) {
    logger.error(t('config.invalidInterval', { name, value, min: MIN_INTERVAL, max: MAX_INTERVAL }))
    process.exit(1)
  }
  return parsed
}

const VALID_CHANNELS: readonly string[] = ['latest', 'beta', 'alpha']

export function validateUpdateChannel(channel: string | undefined): ReleaseChannel | undefined {
  if (!channel) return undefined
  if (!VALID_CHANNELS.includes(channel)) {
    logger.error(`Invalid update channel: ${channel}. Must be one of: ${VALID_CHANNELS.join(', ')}`)
    process.exit(1)
  }
  return channel as ReleaseChannel
}
