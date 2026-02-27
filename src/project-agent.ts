import * as os from 'os'

import { ApiClient } from './api-client'
import { AppSyncSubscriber, type AppSyncNotification } from './appsync-subscriber'
import { detectAvailableChatModes, resolveActiveChatMode } from './chat-mode-detector'
import { executeCommand } from './commands'
import { CONFIG_SYNC_DEBOUNCE_MS, LOG_PAYLOAD_LIMIT, LOG_RESULT_LIMIT } from './constants'
import { t } from './i18n'
import { logger } from './logger'
import { writeAwsConfig } from './aws-profile'
import { syncProjectConfig } from './project-config-sync'
import { initProjectDir } from './project-dir'
import { getSystemInfo, getLocalIpAddress } from './system-info'
import type { AgentChatMode, AgentServerConfig, ProjectConfigResponse, ProjectRegistration, RegisterResponse } from './types'
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
  private readonly projectDir: string | undefined
  private currentConfigHash: string | undefined = undefined
  private configSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private projectConfig: ProjectConfigResponse | undefined = undefined

  constructor(
    project: ProjectRegistration,
    private readonly agentId: string,
    private readonly options: ProjectAgentOptions,
    tenantCode?: string,
    localAgentChatMode?: AgentChatMode,
    defaultProjectDir?: string,
  ) {
    this.client = new ApiClient(project.apiUrl, project.token)
    this.prefix = `[${project.projectCode}]`
    this.tenantCode = tenantCode ?? project.projectCode
    this.localAgentChatMode = localAgentChatMode
    // Resolve project directory if configured
    if (project.projectDir || defaultProjectDir) {
      this.projectDir = initProjectDir(project, defaultProjectDir)
    }
  }

  start(): void {
    this.registerAndStart().catch((error) => {
      logger.error(t('runner.unexpectedError', { message: getErrorMessage(error) }))
    })
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.configSyncDebounceTimer) clearTimeout(this.configSyncDebounceTimer)
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

    // Perform initial config sync
    await this.performConfigSync()

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

        const response = await this.client.heartbeat(
          this.agentId,
          getSystemInfo(),
          undefined,
          this.availableChatModes,
          this.activeChatMode,
          getLocalIpAddress(),
        )

        // Check configHash from heartbeat response (polling fallback)
        if (response && typeof response === 'object' && 'configHash' in response) {
          const heartbeatResponse = response as { configHash?: string }
          if (heartbeatResponse.configHash && heartbeatResponse.configHash !== this.currentConfigHash) {
            logger.info(`${this.prefix} Config hash changed in heartbeat response, syncing...`)
            this.scheduleConfigSync()
          }
        }

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

    switch (notification.action) {
      case 'agent-command': {
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
        break
      }
      case 'config-update': {
        await this.handleConfigUpdate(notification)
        break
      }
      default:
        logger.debug(`${this.prefix} Ignoring notification with action: ${notification.action}`)
    }
  }

  private async handleConfigUpdate(notification: AppSyncNotification): Promise<void> {
    const newHash = notification.content?.configHash as string
    if (newHash && newHash !== this.currentConfigHash) {
      logger.info(`${this.prefix} Config update detected (hash: ${newHash})`)
      this.scheduleConfigSync()
    }
  }

  private scheduleConfigSync(): void {
    if (this.configSyncDebounceTimer) {
      clearTimeout(this.configSyncDebounceTimer)
    }
    this.configSyncDebounceTimer = setTimeout(() => {
      void this.performConfigSync()
    }, CONFIG_SYNC_DEBOUNCE_MS)
  }

  private async performConfigSync(): Promise<void> {
    const config = await syncProjectConfig(
      this.client,
      this.currentConfigHash,
      this.projectDir,
      this.prefix,
    )
    if (config) {
      this.applyProjectConfig(config)
    }
  }

  private applyProjectConfig(config: ProjectConfigResponse): void {
    this.currentConfigHash = config.configHash
    this.projectConfig = config

    // Update serverConfig from project config
    this.serverConfig = {
      agentEnabled: config.agent.agentEnabled,
      builtinAgentEnabled: config.agent.builtinAgentEnabled,
      builtinFallbackEnabled: config.agent.builtinFallbackEnabled,
      externalAgentEnabled: config.agent.externalAgentEnabled,
      chatMode: 'agent',
      claudeCodeConfig: {
        allowedTools: config.agent.allowedTools,
        addDirs: config.agent.claudeCodeConfig?.additionalDirs,
        systemPrompt: config.agent.claudeCodeConfig?.appendSystemPrompt,
      },
    }

    // Write AWS config file if project directory and AWS accounts are configured
    if (this.projectDir && config.aws?.accounts?.length) {
      try {
        writeAwsConfig(this.projectDir, config.project.projectCode, config.aws.accounts)
      } catch (error) {
        logger.warn(`${this.prefix} Failed to write AWS config: ${getErrorMessage(error)}`)
      }
    }

    logger.info(`${this.prefix} Config applied (hash: ${config.configHash})`)
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
        projectDir: this.projectDir,
        projectConfig: this.projectConfig,
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
