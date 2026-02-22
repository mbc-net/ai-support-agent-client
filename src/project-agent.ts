import * as os from 'os'

import { ApiClient } from './api-client'
import { executeCommand } from './command-executor'
import { t } from './i18n'
import { logger } from './logger'
import type { ProjectRegistration, SystemInfo } from './types'
import { getErrorMessage } from './utils'

export interface ProjectAgentOptions {
  pollInterval: number
  heartbeatInterval: number
}

function getSystemInfo(): SystemInfo {
  const cpus = os.cpus()
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuUsage: cpus.length > 0 ? (os.loadavg()[0] / cpus.length) * 100 : 0,
    memoryUsage: (1 - os.freemem() / os.totalmem()) * 100,
    uptime: os.uptime(),
  }
}

function getLocalIpAddress(): string | undefined {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return undefined
}

export class ProjectAgent {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private processing = false
  private readonly client: ApiClient
  private readonly prefix: string

  constructor(
    project: ProjectRegistration,
    private readonly agentId: string,
    private readonly options: ProjectAgentOptions,
  ) {
    this.client = new ApiClient(project.apiUrl, project.token)
    this.prefix = `[${project.projectCode}]`
  }

  start(): void {
    this.registerAndStart().catch((error) => {
      logger.error(t('runner.unexpectedError', { message: getErrorMessage(error) }))
    })
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  getClient(): ApiClient {
    return this.client
  }

  private async registerAndStart(): Promise<void> {
    try {
      const result = await this.client.register({
        agentId: this.agentId,
        hostname: os.hostname(),
        os: os.platform(),
        arch: os.arch(),
        ipAddress: getLocalIpAddress(),
      })
      logger.success(t('runner.registered', { prefix: this.prefix, agentId: result.agentId }))
    } catch (error) {
      logger.error(t('runner.registerFailed', { prefix: this.prefix, message: getErrorMessage(error) }))
      return
    }

    // Heartbeat loop
    const sendHeartbeat = async (): Promise<void> => {
      try {
        await this.client.heartbeat(this.agentId, getSystemInfo())
        logger.debug(`${this.prefix} Heartbeat sent`)
      } catch (error) {
        logger.warn(t('runner.heartbeatFailed', { prefix: this.prefix, message: getErrorMessage(error) }))
      }
    }

    this.heartbeatTimer = setInterval(() => {
      void sendHeartbeat()
    }, this.options.heartbeatInterval)

    void sendHeartbeat()

    // Command polling loop
    const pollCommands = async (): Promise<void> => {
      if (this.processing) return
      this.processing = true

      try {
        const pending = await this.client.getPendingCommands()

        for (const cmd of pending) {
          logger.info(t('runner.commandReceived', { prefix: this.prefix, type: cmd.type, commandId: cmd.commandId }))

          try {
            const detail = await this.client.getCommand(cmd.commandId)
            const result = await executeCommand(detail.type, detail.payload)
            await this.client.submitResult(cmd.commandId, result)
            logger.info(
              t('runner.commandDone', {
                prefix: this.prefix,
                commandId: cmd.commandId,
                result: result.success ? 'success' : 'failed',
              }),
            )
          } catch (error) {
            const message = getErrorMessage(error)
            logger.error(
              t('runner.commandError', { prefix: this.prefix, commandId: cmd.commandId, message }),
            )

            try {
              await this.client.submitResult(cmd.commandId, {
                success: false,
                error: message,
              })
            } catch {
              logger.error(t('runner.resultSendFailed', { prefix: this.prefix }))
            }
          }
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
}
