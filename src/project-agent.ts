import * as os from 'os'

import { ApiClient } from './api-client'
import { AppSyncSubscriber, type AppSyncNotification } from './appsync-subscriber'
import { detectAvailableChatModes, resolveActiveChatMode } from './chat-mode-detector'
import { executeCommand } from './commands'
import { t } from './i18n'
import { logger } from './logger'
import { getSystemInfo, getLocalIpAddress } from './system-info'
import type { AgentChatMode, AgentServerConfig, ProjectRegistration, RegisterResponse } from './types'
import { LOG_PAYLOAD_LIMIT, LOG_RESULT_LIMIT } from './constants'
import { getErrorMessage } from './utils'

export interface ProjectAgentOptions {
  pollInterval: number
  heartbeatInterval: number
}

export class ProjectAgent {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private subscriber: AppSyncSubscriber | null = null
  private processing = false
  private readonly client: ApiClient
  private readonly prefix: string
  private readonly tenantCode: string
  private serverConfig: AgentServerConfig | null = null
  private availableChatModes: AgentChatMode[] = []
  private activeChatMode: AgentChatMode | undefined = undefined
  private readonly localAgentChatMode: AgentChatMode | undefined

  constructor(
    project: ProjectRegistration,
    private readonly agentId: string,
    private readonly options: ProjectAgentOptions,
    tenantCode?: string,
    localAgentChatMode?: AgentChatMode,
  ) {
    this.client = new ApiClient(project.apiUrl, project.token)
    this.prefix = `[${project.projectCode}]`
    this.tenantCode = tenantCode ?? project.projectCode
    this.localAgentChatMode = localAgentChatMode
  }

  start(): void {
    this.registerAndStart().catch((error) => {
      logger.error(t('runner.unexpectedError', { message: getErrorMessage(error) }))
    })
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.subscriber) this.subscriber.disconnect()
  }

  getClient(): ApiClient {
    return this.client
  }

  private async registerAndStart(): Promise<void> {
    await this.refreshChatMode(true)

    let result: RegisterResponse
    try {
      result = await this.client.register({
        agentId: this.agentId,
        hostname: os.hostname(),
        os: os.platform(),
        arch: os.arch(),
        ipAddress: getLocalIpAddress(),
        capabilities: ['shell', 'file_read', 'file_write', 'process_manage', 'chat'],
        availableChatModes: this.availableChatModes,
        activeChatMode: this.activeChatMode,
      })
      logger.success(t('runner.registered', { prefix: this.prefix, agentId: result.agentId }))
      logger.debug(`${this.prefix} Register response: transportMode=${result.transportMode ?? 'none'}, appsyncUrl=${result.appsyncUrl ? 'present' : 'absent'}`)
    } catch (error) {
      logger.error(t('runner.registerFailed', { prefix: this.prefix, message: getErrorMessage(error) }))
      return
    }

    if (result.transportMode === 'realtime' && result.appsyncUrl && result.appsyncApiKey) {
      logger.info(`${this.prefix} Starting subscription mode (realtime)`)
      await this.startSubscriptionMode(result)
    } else {
      logger.info(`${this.prefix} Starting polling mode (interval: ${this.options.pollInterval}ms)`)
      this.startPollingMode()
    }

    this.startHeartbeat()
  }

  private async startSubscriptionMode(registerResult: RegisterResponse): Promise<void> {
    this.subscriber = new AppSyncSubscriber(registerResult.appsyncUrl, registerResult.appsyncApiKey)

    try {
      await this.subscriber.connect()
      logger.success(`${this.prefix} Connected via AppSync WebSocket`)
    } catch (error) {
      logger.warn(`${this.prefix} WebSocket connection failed, falling back to polling: ${getErrorMessage(error)}`)
      this.startPollingMode()
      return
    }

    this.subscriber.subscribe(
      this.tenantCode,
      (notification) => { void this.handleNotification(notification) },
    )

    this.subscriber.onReconnect(() => {
      logger.info(`${this.prefix} Reconnected, checking for pending commands...`)
      void this.checkPendingCommands()
    })
  }

  private startPollingMode(): void {
    const pollCommands = async (): Promise<void> => {
      if (this.processing) return
      this.processing = true

      try {
        const pending = await this.client.getPendingCommands(this.agentId)
        if (pending.length > 0) {
          logger.debug(`${this.prefix} Polling found ${pending.length} pending command(s)`)
        }

        for (const cmd of pending) {
          logger.info(t('runner.commandReceived', { prefix: this.prefix, type: cmd.type, commandId: cmd.commandId }))
          await this.processCommand(cmd.commandId)
        }
      } catch (error) {
        logger.debug(`${this.prefix} Polling error: ${getErrorMessage(error)}`)
      } finally {
        this.processing = false
      }
    }

    this.pollTimer = setInterval(() => {
      void pollCommands()
    }, this.options.pollInterval)
  }

  private startHeartbeat(): void {
    const sendHeartbeat = async (): Promise<void> => {
      try {
        await this.refreshChatMode(false)

        await this.client.heartbeat(
          this.agentId,
          getSystemInfo(),
          undefined,
          this.availableChatModes,
          this.activeChatMode,
          getLocalIpAddress(),
        )
        logger.debug(`${this.prefix} Heartbeat sent (activeChatMode=${this.activeChatMode ?? 'none'})`)
      } catch (error) {
        logger.warn(t('runner.heartbeatFailed', { prefix: this.prefix, message: getErrorMessage(error) }))
      }
    }

    this.heartbeatTimer = setInterval(() => {
      void sendHeartbeat()
    }, this.options.heartbeatInterval)

    void sendHeartbeat()
  }

  private async handleNotification(notification: AppSyncNotification): Promise<void> {
    logger.debug(`${this.prefix} Notification received: action=${notification.action}, content=${JSON.stringify(notification.content ?? {}).substring(0, LOG_RESULT_LIMIT)}`)

    if (notification.action !== 'agent-command') {
      logger.debug(`${this.prefix} Ignoring notification with action: ${notification.action}`)
      return
    }

    const commandId = notification.content?.commandId as string
    if (!commandId) {
      logger.warn(`${this.prefix} Notification missing commandId: ${JSON.stringify(notification.content ?? {})}`)
      return
    }

    logger.info(t('runner.commandReceived', {
      prefix: this.prefix,
      type: (notification.content?.type as string) ?? 'unknown',
      commandId,
    }))

    await this.processCommand(commandId)
  }

  private async processCommand(commandId: string): Promise<void> {
    try {
      const detail = await this.client.getCommand(commandId, this.agentId)
      logger.debug(`${this.prefix} Command detail [${commandId}]: type=${detail.type}, payload=${JSON.stringify(detail.payload).substring(0, LOG_PAYLOAD_LIMIT)}`)
      const result = await executeCommand(detail.type, detail.payload, {
        commandId,
        client: this.client,
        serverConfig: this.serverConfig ?? undefined,
        activeChatMode: this.activeChatMode,
        agentId: this.agentId,
      })
      logger.debug(`${this.prefix} Command result [${commandId}]: success=${result.success}, data=${JSON.stringify(result.success ? result.data : result.error).substring(0, LOG_RESULT_LIMIT)}`)
      await this.client.submitResult(commandId, result, this.agentId)
      logger.info(t('runner.commandDone', {
        prefix: this.prefix,
        commandId,
        result: result.success ? 'success' : 'failed',
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      logger.error(
        t('runner.commandError', { prefix: this.prefix, commandId, message }),
      )

      try {
        await this.client.submitResult(commandId, {
          success: false,
          error: message,
        }, this.agentId)
      } catch {
        logger.error(t('runner.resultSendFailed', { prefix: this.prefix }))
      }
    }
  }

  private async refreshChatMode(verbose: boolean): Promise<void> {
    this.availableChatModes = await detectAvailableChatModes()
    if (verbose) {
      logger.info(`${this.prefix} Available chat modes: ${JSON.stringify(this.availableChatModes)}`)
    }

    try {
      this.serverConfig = await this.client.getConfig()
      if (verbose) {
        logger.info(`${this.prefix} Server config loaded: chatMode=${this.serverConfig.chatMode}`)
        if (this.serverConfig.claudeCodeConfig) {
          logger.debug(`${this.prefix} claudeCodeConfig: allowedTools=[${this.serverConfig.claudeCodeConfig.allowedTools?.join(', ') ?? ''}], addDirs=[${this.serverConfig.claudeCodeConfig.addDirs?.join(', ') ?? ''}]`)
        }
      }
    } catch (error) {
      if (verbose) {
        logger.warn(`${this.prefix} Failed to load server config, using defaults: ${getErrorMessage(error)}`)
      }
    }

    this.activeChatMode = resolveActiveChatMode(
      this.availableChatModes,
      this.localAgentChatMode,
      this.serverConfig?.defaultAgentChatMode,
    )
    if (verbose) {
      logger.info(`${this.prefix} Active chat mode: ${this.activeChatMode ?? 'none'}`)
    }
  }

  private async checkPendingCommands(): Promise<void> {
    try {
      const pending = await this.client.getPendingCommands(this.agentId)
      for (const cmd of pending) {
        await this.handleNotification({
          id: cmd.commandId,
          table: '',
          pk: '',
          sk: '',
          tenantCode: '',
          action: 'agent-command',
          content: { commandId: cmd.commandId, type: cmd.type },
        })
      }
    } catch (error) {
      logger.warn(`${this.prefix} Failed to check pending commands: ${getErrorMessage(error)}`)
    }
  }
}
