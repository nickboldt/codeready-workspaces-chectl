/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { boolean, string } from '@oclif/parser/lib/flags'
import { cli } from 'cli-ux'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { cheDeployment, cheNamespace, listrRenderer } from '../../common-flags'
import { DEFAULT_CHE_OPERATOR_IMAGE } from '../../constants'
import { CheTasks } from '../../tasks/che'
import { InstallerTasks } from '../../tasks/installers/installer'
import { ApiTasks } from '../../tasks/platforms/api'
import { PlatformTasks } from '../../tasks/platforms/platform'

export default class Update extends Command {
  static description = 'update CodeReady Workspaces server'

  static flags = {
    installer: string({
      char: 'a',
      description: 'Installer type',
      options: ['operator'],
      default: 'operator'
    }),
    platform: string({
      char: 'p',
      description: 'Type of OpenShift platform. Valid values are \"openshift\", \"crc (for CodeReady Containers)\".',
      options: ['openshift', 'crc'],
      default: 'openshift'
    }),
    chenamespace: cheNamespace,
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: Update.getTemplatesDir(),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
      default: DEFAULT_CHE_OPERATOR_IMAGE
    }),
    'skip-version-check': boolean({
      description: 'Skip user confirmation on version check',
      default: false
    }),
    'deployment-name': cheDeployment,
    'listr-renderer': listrRenderer,
    help: flags.help({ char: 'h' }),
  }

  static getTemplatesDir(): string {
    // return local templates folder if present
    const TEMPLATES = 'templates'
    const templatesDir = path.resolve(TEMPLATES)
    const exists = fs.pathExistsSync(templatesDir)
    if (exists) {
      return TEMPLATES
    }
    // else use the location from modules
    return path.join(__dirname, '../../../templates')
  }

  checkIfInstallerSupportUpdating(flags: any) {
    // matrix checks
    if (!flags.installer) {
      this.error('🛑 --installer parameter must be specified.')
    }

    if (flags.installer === 'operator') {
      // operator already supports updating
      return
    }

    if (flags.installer === 'minishift-addon' || flags.installer === 'helm') {
      this.error(`🛑 The specified installer ${flags.installer} does not support updating yet.`)
    }

    this.error(`🛑 Unknown installer ${flags.installer} is specified.`)
  }

  async run() {
    const { flags } = this.parse(Update)
    const listrOptions: Listr.ListrOptions = { renderer: (flags['listr-renderer'] as any), collapse: false } as Listr.ListrOptions

    const cheTasks = new CheTasks(flags)
    const platformTasks = new PlatformTasks()
    const installerTasks = new InstallerTasks()
    const apiTasks = new ApiTasks()

    // Platform Checks
    let platformCheckTasks = new Listr(platformTasks.preflightCheckTasks(flags, this), listrOptions)

    this.checkIfInstallerSupportUpdating(flags)

    // Checks if CodeReady Workspaces is already deployed
    let preInstallTasks = new Listr(undefined, listrOptions)
    preInstallTasks.add(apiTasks.testApiTasks(flags, this))
    preInstallTasks.add({
      title: '👀  Looking for an already existing CodeReady Workspaces instance',
      task: () => new Listr(cheTasks.checkIfCheIsInstalledTasks(flags, this))
    })

    let preUpdateTasks = new Listr(installerTasks.preUpdateTasks(flags, this), listrOptions)

    let updateTasks = new Listr(undefined, listrOptions)
    updateTasks.add({
      title: '↺  Updating...',
      task: () => new Listr(installerTasks.updateTasks(flags, this))
    })

    try {
      const ctx: any = {}
      await preInstallTasks.run(ctx)

      if (!ctx.isCheDeployed) {
        this.error('CodeReady Workspaces deployment is not found. Use `crwctl server:start` to initiate new deployment.')
      } else {
        await platformCheckTasks.run(ctx)

        await preUpdateTasks.run(ctx)

        if (!flags['skip-version-check']) {
          await cli.anykey(`      Found deployed CodeReady Workspaces with operator [${ctx.deployedCheOperatorImage}]:${ctx.deployedCheOperatorTag}.
      You are going to update it to [${ctx.newCheOperatorImage}]:${ctx.newCheOperatorTag}.
      Note that CodeReady Workspaces operator will update component images (server, plugin registry) only if their values
      are not overridden in eclipse-che Custom Resource. So, you may need to remove them manually.
      Press q to quit or any key to continue`)
        }

        await updateTasks.run(ctx)
      }
      this.log('Command server:update has completed successfully.')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'crwctl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }
}
