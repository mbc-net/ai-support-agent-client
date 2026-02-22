import {
  executeCommand,
  executeShellCommand,
  fileRead,
  fileWrite,
  fileList,
  processList,
  processKill,
} from '../../src/commands'
import type { CommandDispatch } from '../../src/types'

jest.mock('../../src/logger')

describe('commands/dispatch', () => {
  describe('CommandDispatch overload', () => {
    it('should dispatch execute_command via CommandDispatch', async () => {
      const dispatch: CommandDispatch = {
        type: 'execute_command',
        payload: { command: 'echo dispatch-test' },
      }
      const result = await executeCommand(dispatch)
      expect(result.success).toBe(true)
      expect((result.data as string).trim()).toBe('dispatch-test')
    })

    it('should dispatch process_list via CommandDispatch', async () => {
      const dispatch: CommandDispatch = {
        type: 'process_list',
        payload: {} as Record<string, never>,
      }
      const result = await executeCommand(dispatch)
      expect(result.success).toBe(true)
    })

    it('should handle unknown command type via loose signature', async () => {
      const result = await executeCommand('nonexistent_type' as any, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Unknown command type')
      }
    })
  })

  describe('re-exports', () => {
    it('should export executeShellCommand', () => {
      expect(typeof executeShellCommand).toBe('function')
    })

    it('should export fileRead', () => {
      expect(typeof fileRead).toBe('function')
    })

    it('should export fileWrite', () => {
      expect(typeof fileWrite).toBe('function')
    })

    it('should export fileList', () => {
      expect(typeof fileList).toBe('function')
    })

    it('should export processList', () => {
      expect(typeof processList).toBe('function')
    })

    it('should export processKill', () => {
      expect(typeof processKill).toBe('function')
    })
  })
})
