import { logger } from '../../src/logger'
import { parseIntervalOrExit, validateUpdateChannel } from '../../src/cli/validators'

jest.mock('../../src/logger')

describe('cli/validators', () => {
  let exitSpy: jest.Spied<typeof process.exit>

  beforeEach(() => {
    jest.clearAllMocks()
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
  })

  describe('parseIntervalOrExit', () => {
    it('should return parsed integer for valid value', () => {
      expect(parseIntervalOrExit('3000', 'poll-interval')).toBe(3000)
    })

    it('should call process.exit for value below MIN_INTERVAL', () => {
      expect(() => parseIntervalOrExit('500', 'poll-interval')).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should call process.exit for value above MAX_INTERVAL', () => {
      expect(() => parseIntervalOrExit('999999', 'poll-interval')).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should call process.exit for non-numeric value', () => {
      expect(() => parseIntervalOrExit('abc', 'poll-interval')).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('validateUpdateChannel', () => {
    it('should return undefined for undefined input', () => {
      expect(validateUpdateChannel(undefined)).toBeUndefined()
    })

    it('should return channel for valid channels', () => {
      expect(validateUpdateChannel('latest')).toBe('latest')
      expect(validateUpdateChannel('beta')).toBe('beta')
      expect(validateUpdateChannel('alpha')).toBe('alpha')
    })

    it('should call process.exit for invalid channel', () => {
      expect(() => validateUpdateChannel('invalid')).toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(logger.error).toHaveBeenCalled()
    })
  })
})
