import { logger } from '../logger'
import type { AgentCommandType, CommandDispatch, CommandResult } from '../types'
import { getErrorMessage } from '../utils'

import { fileList, fileRead, fileWrite } from './file-executor'
import { processKill, processList } from './process-executor'
import { executeShellCommand } from './shell-executor'

// Overload: type-safe discriminated union
export async function executeCommand(command: CommandDispatch): Promise<CommandResult>
// Overload: backward-compatible loose signature
export async function executeCommand(type: AgentCommandType, payload: Record<string, unknown>): Promise<CommandResult>
// Implementation
export async function executeCommand(
  typeOrCommand: AgentCommandType | CommandDispatch,
  payload?: Record<string, unknown>,
): Promise<CommandResult> {
  const type = typeof typeOrCommand === 'string' ? typeOrCommand : typeOrCommand.type
  // Runtime payloads come from external API, so cast is safe — runtime validation happens in each executor
  const p = (typeof typeOrCommand === 'string' ? payload! : typeOrCommand.payload) as Record<string, unknown>

  try {
    switch (type) {
      case 'execute_command':
        return await executeShellCommand(p)
      case 'file_read':
        return await fileRead(p)
      case 'file_write':
        return await fileWrite(p)
      case 'file_list':
        return await fileList(p)
      case 'process_list':
        return await processList()
      case 'process_kill':
        return await processKill(p)
      default:
        return { success: false, error: `Unknown command type: ${type}` }
    }
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error(`Command execution failed: ${message}`)
    return { success: false, error: message }
  }
}

export { executeShellCommand } from './shell-executor'
export { fileList, fileRead, fileWrite } from './file-executor'
export { processKill, processList } from './process-executor'
