// Re-export from commands/ for backward compatibility
export { executeCommand } from './commands'

// Re-export security utilities for backward compatibility
export {
  ALLOWED_SIGNALS,
  BLOCKED_COMMAND_PATTERNS,
  BLOCKED_PATH_PREFIXES,
  buildSafeEnv,
  getSensitiveHomePaths,
  resolveAndValidatePath,
  SAFE_ENV_KEYS,
  validateCommand,
  validateFilePath,
} from './security'
