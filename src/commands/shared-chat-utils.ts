import { ApiClient } from '../api-client'
import { CHUNK_LOG_LIMIT } from '../constants'
import { logger } from '../logger'
import type { ChatChunkType } from '../types'
import { getErrorMessage, truncateString } from '../utils'

export interface ChunkSenderOptions {
  debugLog?: boolean
}

/**
 * チャンクを送信する関数を生成するファクトリ
 *
 * @param commandId - コマンドID
 * @param client - APIクライアント
 * @param agentId - エージェントID
 * @param logTag - ログのプレフィックスタグ（例: "chat", "api-chat"）
 * @param options - オプション（debugLog: チャンク送信時のデバッグログ出力）
 * @returns chunkIndex を内部管理する sendChunk 関数と、現在の chunkIndex を取得する関数
 */
export function createChunkSender(
  commandId: string,
  client: ApiClient,
  agentId: string,
  logTag: string,
  options?: ChunkSenderOptions,
): {
  sendChunk: (type: ChatChunkType, content: string) => Promise<void>
  getChunkIndex: () => number
} {
  let chunkIndex = 0

  const sendChunk = async (
    type: ChatChunkType,
    content: string,
  ): Promise<void> => {
    try {
      if (options?.debugLog) {
        logger.debug(`[${logTag}] Sending chunk #${chunkIndex} (${type}) [${commandId}]: ${truncateString(content, CHUNK_LOG_LIMIT)}`)
      }
      await client.submitChatChunk(commandId, {
        index: chunkIndex++,
        type,
        content,
      }, agentId)
    } catch (error) {
      logger.warn(`[${logTag}] Failed to send chunk #${chunkIndex - 1}: ${getErrorMessage(error)}`)
    }
  }

  return { sendChunk, getChunkIndex: () => chunkIndex }
}
