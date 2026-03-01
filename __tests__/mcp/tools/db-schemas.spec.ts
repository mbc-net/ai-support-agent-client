import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { ApiClient } from '../../../src/api-client'
import { registerDbSchemasTool } from '../../../src/mcp/tools/db-schemas'

jest.mock('../../../src/api-client')
jest.mock('../../../src/logger')
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}))
jest.mock('pg', () => ({
  Client: jest.fn(),
}))

describe('db-schemas tool', () => {
  let toolCallback: (args: { name: string }) => Promise<unknown>

  describe('registerDbSchemasTool', () => {
    it('should register the tool on the server', () => {
      const mockServer = { tool: jest.fn() } as unknown as McpServer
      const mockClient = {} as ApiClient

      registerDbSchemasTool(mockServer, mockClient)

      expect((mockServer.tool as jest.Mock)).toHaveBeenCalledWith(
        'get_db_schemas',
        expect.any(String),
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('should execute MySQL schema query', async () => {
      const mockConnection = {
        query: jest.fn().mockResolvedValue([[
          { TABLE_NAME: 'users', COLUMN_NAME: 'id', DATA_TYPE: 'int' },
        ]]),
        end: jest.fn().mockResolvedValue(undefined),
      }
      const mysql2 = require('mysql2/promise')
      mysql2.createConnection.mockResolvedValue(mockConnection)

      const mockServer = {
        tool: jest.fn().mockImplementation((_n: string, _d: string, _s: unknown, cb: typeof toolCallback) => {
          toolCallback = cb
        }),
      } as unknown as McpServer
      const mockClient = {
        getDbCredentials: jest.fn().mockResolvedValue({
          name: 'MAIN', engine: 'mysql', host: 'localhost', port: 3306,
          database: 'testdb', user: 'root', password: 'pass',
        }),
      } as unknown as ApiClient

      registerDbSchemasTool(mockServer, mockClient)

      const result = await toolCallback({ name: 'MAIN' })
      expect(result).toEqual({
        content: [{
          type: 'text',
          text: JSON.stringify([{ TABLE_NAME: 'users', COLUMN_NAME: 'id', DATA_TYPE: 'int' }], null, 2),
        }],
      })
    })

    it('should execute PostgreSQL schema query', async () => {
      const mockClient2 = {
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue({
          rows: [{ table_name: 'users', column_name: 'id', data_type: 'integer' }],
        }),
        end: jest.fn().mockResolvedValue(undefined),
      }
      const pg = require('pg')
      pg.Client.mockImplementation(() => mockClient2)

      const mockServer = {
        tool: jest.fn().mockImplementation((_n: string, _d: string, _s: unknown, cb: typeof toolCallback) => {
          toolCallback = cb
        }),
      } as unknown as McpServer
      const mockApiClient = {
        getDbCredentials: jest.fn().mockResolvedValue({
          name: 'MAIN', engine: 'postgresql', host: 'localhost', port: 5432,
          database: 'testdb', user: 'postgres', password: 'pass',
        }),
      } as unknown as ApiClient

      registerDbSchemasTool(mockServer, mockApiClient)

      const result = await toolCallback({ name: 'MAIN' })
      expect(result).toEqual({
        content: [{
          type: 'text',
          text: JSON.stringify([{ table_name: 'users', column_name: 'id', data_type: 'integer' }], null, 2),
        }],
      })
    })

    it('should handle errors', async () => {
      const mockServer = {
        tool: jest.fn().mockImplementation((_n: string, _d: string, _s: unknown, cb: typeof toolCallback) => {
          toolCallback = cb
        }),
      } as unknown as McpServer
      const mockClient = {
        getDbCredentials: jest.fn().mockRejectedValue(new Error('Not found')),
      } as unknown as ApiClient

      registerDbSchemasTool(mockServer, mockClient)

      const result = await toolCallback({ name: 'MAIN' })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: Not found' }],
        isError: true,
      })
    })
  })
})
