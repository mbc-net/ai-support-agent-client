const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
} as const

let verboseEnabled = false

function timestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

function formatLog(level: string, color: string, message: string): string {
  return `${COLORS.gray}[${timestamp()}]${COLORS.reset} ${color}${level}${COLORS.reset} ${message}`
}

export const logger = {
  setVerbose(enabled: boolean): void {
    verboseEnabled = enabled
  },

  info(message: string): void {
    console.log(formatLog('INFO ', COLORS.green, message))
  },

  warn(message: string): void {
    console.log(formatLog('WARN ', COLORS.yellow, message))
  },

  error(message: string): void {
    console.error(formatLog('ERROR', COLORS.red, message))
  },

  debug(message: string): void {
    if (verboseEnabled) {
      console.log(formatLog('DEBUG', COLORS.blue, message))
    }
  },

  success(message: string): void {
    console.log(`${COLORS.green}✓${COLORS.reset} ${message}`)
  },
}
