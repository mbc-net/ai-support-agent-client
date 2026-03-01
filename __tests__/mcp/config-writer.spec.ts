import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { buildMcpConfig, getMcpConfigPath, writeMcpConfig } from '../../src/mcp/config-writer'

describe('config-writer', () => {
  const testDir = join(tmpdir(), 'ai-support-agent-test-mcp-' + Date.now())

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('getMcpConfigPath', () => {
    it('should return correct path', () => {
      const result = getMcpConfigPath('/project/dir')
      expect(result).toBe(join('/project/dir', '.ai-support-agent', 'mcp', 'config.json'))
    })
  })

  describe('buildMcpConfig', () => {
    it('should build correct config structure', () => {
      const config = buildMcpConfig(
        'http://localhost:3030',
        'TEST_01',
        '/path/to/server.js',
      )

      expect(config).toEqual({
        mcpServers: {
          'ai-support-agent': {
            command: 'node',
            args: ['/path/to/server.js'],
            env: {
              AI_SUPPORT_AGENT_API_URL: 'http://localhost:3030',
              AI_SUPPORT_AGENT_TOKEN: '${AI_SUPPORT_AGENT_TOKEN}',
              AI_SUPPORT_AGENT_PROJECT_CODE: 'TEST_01',
            },
          },
        },
      })
    })
  })

  describe('writeMcpConfig', () => {
    it('should write config file with correct content', () => {
      const configPath = writeMcpConfig(
        testDir,
        'http://localhost:3030',
        'test-token-123',
        'TEST_01',
        '/path/to/server.js',
      )

      expect(existsSync(configPath)).toBe(true)

      const content = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(content.mcpServers['ai-support-agent'].command).toBe('node')
      expect(content.mcpServers['ai-support-agent'].args).toEqual(['/path/to/server.js'])
      expect(content.mcpServers['ai-support-agent'].env.AI_SUPPORT_AGENT_API_URL).toBe('http://localhost:3030')
      expect(content.mcpServers['ai-support-agent'].env.AI_SUPPORT_AGENT_TOKEN).toBe('test-token-123')
      expect(content.mcpServers['ai-support-agent'].env.AI_SUPPORT_AGENT_PROJECT_CODE).toBe('TEST_01')
    })

    it('should set file permission to 0600', () => {
      const configPath = writeMcpConfig(
        testDir,
        'http://localhost:3030',
        'test-token-123',
        'TEST_01',
        '/path/to/server.js',
      )

      const stat = statSync(configPath)
      // 0o600 = owner read+write only
      const mode = stat.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('should return the config path', () => {
      const configPath = writeMcpConfig(
        testDir,
        'http://localhost:3030',
        'token',
        'PROJ',
        '/srv.js',
      )

      expect(configPath).toBe(getMcpConfigPath(testDir))
    })
  })
})
