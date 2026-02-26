import * as os from 'os'

import type { SystemInfo } from './types'

export function getSystemInfo(): SystemInfo {
  const cpus = os.cpus()
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuUsage: cpus.length > 0 ? (os.loadavg()[0] / cpus.length) * 100 : 0,
    memoryUsage: (1 - os.freemem() / os.totalmem()) * 100,
    uptime: os.uptime(),
  }
}

export function getLocalIpAddress(): string | undefined {
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
