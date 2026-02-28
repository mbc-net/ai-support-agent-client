import { Command } from 'commander'

import { loadConfig, setDefaultProjectDir, setProjectDir } from '../config-manager'
import { t } from '../i18n'
import { logger } from '../logger'
import { ensureProjectDirs, resolveProjectDir } from '../project-dir'

export function registerSetProjectDirCommand(program: Command): void {
  program
    .command('set-project-dir')
    .description(t('cmd.setProjectDir'))
    .option('--project <code>', t('cmd.setProjectDir.project'))
    .option('--path <path>', t('cmd.setProjectDir.path'))
    .option('--default <template>', t('cmd.setProjectDir.default'))
    .action((opts: { project?: string; path?: string; default?: string }) => {
      if (opts.default) {
        setDefaultProjectDir(opts.default)
        logger.success(t('projectDir.defaultSet', { template: opts.default }))
        return
      }

      if (opts.project && opts.path) {
        const config = loadConfig()
        const project = config?.projects?.find((p) => p.projectCode === opts.project)
        if (!project) {
          logger.error(t('projectDir.noProject', { projectCode: opts.project! }))
          return
        }

        const result = setProjectDir(opts.project, opts.path)
        if (result) {
          const resolvedDir = resolveProjectDir({ ...project, projectDir: opts.path }, config?.defaultProjectDir)
          ensureProjectDirs(resolvedDir)
          logger.success(t('projectDir.set', { projectCode: opts.project, projectDir: resolvedDir }))
        } else {
          logger.error(t('projectDir.noProject', { projectCode: opts.project! }))
        }
        return
      }

      logger.error(t('projectDir.usageHint'))
    })
}
