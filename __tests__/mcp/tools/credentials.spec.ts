import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { ApiClient } from '../../../src/api-client'
import { registerCredentialsTool } from '../../../src/mcp/tools/credentials'

jest.mock('../../../src/api-client')
jest.mock('../../../src/logger')

describe('credentials tool', () => {
  let toolCallback: (args: { type: string; name: string }) => Promise<unknown>

  function setupTool(mockClient: Partial<ApiClient>) {
    const mockServer = {
      tool: jest.fn().mockImplementation((_n: string, _d: string, _s: unknown, cb: typeof toolCallback) => {
        toolCallback = cb
      }),
    } as unknown as McpServer

    registerCredentialsTool(mockServer, mockClient as ApiClient)
  }

  describe('registerCredentialsTool', () => {
    it('should register the tool on the server', () => {
      const mockServer = { tool: jest.fn() } as unknown as McpServer
      const mockClient = {} as ApiClient

      registerCredentialsTool(mockServer, mockClient)

      expect((mockServer.tool as jest.Mock)).toHaveBeenCalledWith(
        'get_credentials',
        expect.any(String),
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('AWS credentials', () => {
    it('should return AWS credentials', async () => {
      setupTool({
        getAwsCredentials: jest.fn().mockResolvedValue({
          accessKeyId: 'AKID',
          secretAccessKey: 'SECRET',
          sessionToken: 'TOKEN',
          region: 'ap-northeast-1',
        }),
      })

      const result = await toolCallback({ type: 'aws', name: 'account-1' }) as { content: Array<{ text: string }> }
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.accessKeyId).toBe('AKID')
      expect(parsed.secretAccessKey).toBe('SECRET')
      expect(parsed.sessionToken).toBe('TOKEN')
      expect(parsed.region).toBe('ap-northeast-1')
    })
  })

  describe('DB credentials', () => {
    it('should return DB credentials', async () => {
      setupTool({
        getDbCredentials: jest.fn().mockResolvedValue({
          name: 'MAIN',
          engine: 'mysql',
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          user: 'root',
          password: 'pass',
        }),
      })

      const result = await toolCallback({ type: 'db', name: 'MAIN' }) as { content: Array<{ text: string }> }
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.name).toBe('MAIN')
      expect(parsed.engine).toBe('mysql')
      expect(parsed.password).toBe('pass')
    })
  })

  describe('error handling', () => {
    it('should handle API errors', async () => {
      setupTool({
        getAwsCredentials: jest.fn().mockRejectedValue(new Error('Unauthorized')),
      })

      const result = await toolCallback({ type: 'aws', name: 'bad-account' })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Unauthorized' }],
        isError: true,
      })
    })

    it('should handle non-Error throws', async () => {
      setupTool({
        getDbCredentials: jest.fn().mockRejectedValue('string error'),
      })

      const result = await toolCallback({ type: 'db', name: 'bad' })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: string error' }],
        isError: true,
      })
    })
  })
})
