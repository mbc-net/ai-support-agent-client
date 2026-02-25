import { spawn } from 'child_process'

import { ApiClient } from '../api-client'
import { logger } from '../logger'
import type { AgentChatMode, AgentServerConfig, ChatChunkType, ChatPayload, CommandResult } from '../types'
import { getErrorMessage, parseString } from '../utils'

import { executeApiChatCommand } from './api-chat-executor'

/**
 * エージェントチャットモードに応じてチャットメッセージを処理する
 * - claude_code: Claude Code CLI を使用（デフォルト）
 * - api: Anthropic API 直接呼び出し
 *
 * activeChatMode はサーバーの chatMode ではなく、エージェント内部の実行方式を指す
 */
export async function executeChatCommand(
  payload: ChatPayload,
  commandId: string,
  client: ApiClient,
  serverConfig?: AgentServerConfig,
  activeChatMode?: AgentChatMode,
): Promise<CommandResult> {
  const mode = activeChatMode ?? 'claude_code'

  switch (mode) {
    case 'api':
      return executeApiChatCommand(payload, commandId, client, serverConfig)
    case 'claude_code':
    default:
      return executeClaudeCodeChat(payload, commandId, client)
  }
}

/**
 * Claude Code CLI を使用してチャットメッセージを処理する
 * サブプロセスとして起動し、stdout をストリーミングで読み取り、
 * チャンクとしてAPIに送信する
 */
async function executeClaudeCodeChat(
  payload: ChatPayload,
  commandId: string,
  client: ApiClient,
): Promise<CommandResult> {
  const message = parseString(payload.message)
  if (!message) {
    return { success: false, error: 'message is required' }
  }

  logger.info(`[chat] Starting chat command [${commandId}]: message="${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`)

  let chunkIndex = 0

  const sendChunk = async (
    type: ChatChunkType,
    content: string,
  ): Promise<void> => {
    try {
      logger.debug(`[chat] Sending chunk #${chunkIndex} (${type}) [${commandId}]: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`)
      await client.submitChatChunk(commandId, {
        index: chunkIndex++,
        type,
        content,
      })
    } catch (error) {
      logger.warn(`[chat] Failed to send chunk #${chunkIndex - 1}: ${getErrorMessage(error)}`)
    }
  }

  try {
    logger.debug(`[chat] Spawning claude CLI for command [${commandId}]`)
    const result = await runClaudeCode(message, sendChunk)
    logger.info(`[chat] Chat command completed [${commandId}]: output=${result.length} chars, ${chunkIndex} chunks sent`)
    // 完了チャンクを送信
    await sendChunk('done', result)
    return { success: true, data: result }
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    logger.error(`[chat] Chat command failed [${commandId}]: ${errorMessage}`)
    await sendChunk('error', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Claude Code CLI をサブプロセスとして実行し、出力をストリーミングで返す
 */
async function runClaudeCode(
  message: string,
  sendChunk: (type: ChatChunkType, content: string) => Promise<void>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // claude CLI が利用可能か確認し、print モードで実行
    const child = spawn('claude', ['-p', message], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let fullOutput = ''
    let stderrOutput = ''

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      fullOutput += text
      // delta チャンクとしてAPIに送信（fire-and-forget）
      void sendChunk('delta', text)
    })

    child.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString()
    })

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            'claude CLI が見つかりません。Claude Code がインストールされていることを確認してください。',
          ),
        )
      } else {
        reject(error)
      }
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(fullOutput)
      } else {
        reject(
          new Error(
            `claude CLI がコード ${code} で終了しました${stderrOutput ? `: ${stderrOutput}` : ''}`,
          ),
        )
      }
    })
  })
}
