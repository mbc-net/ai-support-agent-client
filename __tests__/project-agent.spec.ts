import { ApiClient } from '../src/api-client'
import { executeCommand } from '../src/command-executor'
import { logger } from '../src/logger'
import { ProjectAgent } from '../src/project-agent'

jest.mock('../src/api-client')
jest.mock('../src/command-executor')
jest.mock('../src/logger')

const MockApiClient = ApiClient as jest.MockedClass<typeof ApiClient>
const mockedExecuteCommand = executeCommand as jest.MockedFunction<typeof executeCommand>

describe('ProjectAgent', () => {
  let mockClient: {
    register: jest.Mock
    heartbeat: jest.Mock
    getPendingCommands: jest.Mock
    getCommand: jest.Mock
    submitResult: jest.Mock
    getVersionInfo: jest.Mock
  }

  const project = { projectCode: 'test-proj', token: 'tok', apiUrl: 'http://api' }
  const options = { pollInterval: 5000, heartbeatInterval: 30000 }

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      register: jest.fn().mockResolvedValue({ agentId: 'test-id', appsyncUrl: '', appsyncApiKey: '' }),
      heartbeat: jest.fn().mockResolvedValue({ success: true }),
      getPendingCommands: jest.fn().mockResolvedValue([]),
      getCommand: jest.fn(),
      submitResult: jest.fn().mockResolvedValue(undefined),
      getVersionInfo: jest.fn().mockResolvedValue({ latestVersion: '0.0.1', minimumVersion: '0.0.0', channel: 'latest', channels: {} }),
    }
    MockApiClient.mockImplementation(() => mockClient as unknown as ApiClient)
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('should register on start and begin heartbeat/polling', async () => {
    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)

    expect(mockClient.register).toHaveBeenCalled()
    expect(logger.success).toHaveBeenCalled()

    // Heartbeat should have fired
    expect(mockClient.heartbeat).toHaveBeenCalled()

    agent.stop()
  })

  it('should log error and not start timers when registration fails', async () => {
    mockClient.register.mockRejectedValue(new Error('Network error'))

    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)

    expect(logger.error).toHaveBeenCalledWith('runner.registerFailed')

    // Timers should not fire
    mockClient.heartbeat.mockClear()
    mockClient.getPendingCommands.mockClear()
    await jest.advanceTimersByTimeAsync(60000)

    expect(mockClient.heartbeat).not.toHaveBeenCalled()
    expect(mockClient.getPendingCommands).not.toHaveBeenCalled()

    agent.stop()
  })

  it('should log warning when heartbeat fails', async () => {
    mockClient.heartbeat.mockRejectedValue(new Error('Heartbeat timeout'))

    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)

    expect(logger.warn).toHaveBeenCalledWith('runner.heartbeatFailed')

    agent.stop()
  })

  it('should poll, execute commands, and submit results', async () => {
    mockClient.getPendingCommands.mockResolvedValue([
      { commandId: 'cmd-1', type: 'execute_command' },
    ])
    mockClient.getCommand.mockResolvedValue({
      commandId: 'cmd-1',
      type: 'execute_command',
      payload: { command: 'echo hi' },
    })
    mockedExecuteCommand.mockResolvedValue({ success: true, data: 'hi' })

    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)

    // Trigger poll interval
    await jest.advanceTimersByTimeAsync(options.pollInterval)

    expect(mockClient.getPendingCommands).toHaveBeenCalled()
    expect(mockClient.getCommand).toHaveBeenCalledWith('cmd-1')
    expect(mockedExecuteCommand).toHaveBeenCalledWith('execute_command', { command: 'echo hi' })
    expect(mockClient.submitResult).toHaveBeenCalledWith('cmd-1', { success: true, data: 'hi' })

    agent.stop()
  })

  it('should handle command execution error', async () => {
    mockClient.getPendingCommands.mockResolvedValue([
      { commandId: 'cmd-2', type: 'execute_command' },
    ])
    mockClient.getCommand.mockRejectedValue(new Error('Command fetch failed'))
    mockClient.submitResult.mockRejectedValue(new Error('Submit failed'))

    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)
    await jest.advanceTimersByTimeAsync(options.pollInterval)

    expect(logger.error).toHaveBeenCalledWith('runner.commandError')
    expect(logger.error).toHaveBeenCalledWith('runner.resultSendFailed')

    agent.stop()
  })

  it('should clear timers on stop()', async () => {
    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)

    agent.stop()

    mockClient.heartbeat.mockClear()
    mockClient.getPendingCommands.mockClear()

    await jest.advanceTimersByTimeAsync(60000)

    expect(mockClient.heartbeat).not.toHaveBeenCalled()
    expect(mockClient.getPendingCommands).not.toHaveBeenCalled()
  })

  it('should expose the ApiClient via getClient()', () => {
    const agent = new ProjectAgent(project, 'agent-1', options)
    expect(agent.getClient()).toBeDefined()
  })

  it('should handle polling error gracefully', async () => {
    mockClient.getPendingCommands.mockRejectedValue(new Error('Network failure'))

    const agent = new ProjectAgent(project, 'agent-1', options)
    agent.start()

    await jest.advanceTimersByTimeAsync(100)
    await jest.advanceTimersByTimeAsync(options.pollInterval)

    // Should continue running despite polling error
    agent.stop()
  })
})
