import { processKill, processList } from '../../src/commands/process-executor'
import type { CommandResult } from '../../src/types'

function expectFailure(result: CommandResult): asserts result is { success: false; error: string; data?: unknown } {
  expect(result.success).toBe(false)
}

describe('process-executor', () => {
  describe('processList', () => {
    it('should list processes', async () => {
      const result = await processList()
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })
  })

  describe('processKill', () => {
    it('should return error when no PID specified', async () => {
      const result = await processKill({})
      expectFailure(result)
      expect(result.error).toContain('Invalid PID')
    })

    it('should reject negative PID', async () => {
      const result = await processKill({ pid: -1 })
      expectFailure(result)
      expect(result.error).toContain('Invalid PID')
    })

    it('should send signal to existing process', async () => {
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)

      const result = await processKill({ pid: 12345 })
      expect(result.success).toBe(true)
      expect(result.data).toBe('Sent SIGTERM to PID 12345')
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM')

      killSpy.mockRestore()
    })

    it('should block SIGKILL signal', async () => {
      const result = await processKill({ pid: 12345, signal: 'SIGKILL' })
      expectFailure(result)
      expect(result.error).toContain('Signal not allowed: SIGKILL')
    })

    it('should send SIGUSR1 signal when specified', async () => {
      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)

      const result = await processKill({ pid: 12345, signal: 'SIGUSR1' })
      expect(result.success).toBe(true)
      expect(result.data).toBe('Sent SIGUSR1 to PID 12345')

      killSpy.mockRestore()
    })
  })
})
