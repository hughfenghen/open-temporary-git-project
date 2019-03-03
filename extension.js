// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const os = require('os');
const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const rimraf = require('rimraf')

const REPS_STATE_KEY = 'temporaryGit.repositories'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  let openRemoteRepository = vscode.commands.registerCommand('temporaryGit.openRemoteRepository', async () => {
    const reps = context.globalState.get(REPS_STATE_KEY, [])
    // 已有历史项目
    if (reps.length > 0) {
      const selectedPrjName = await vscode.window.showQuickPick(
        ['New Repository'].concat(reps.map(({
          prjName
        }) => prjName)), 
        { placeHolder: 'Delete the selected repositories.' }
      );

      if (selectedPrjName !== 'New Repository') {
        openDirInNewWindow(
          reps.find(({ prjName }) => prjName === selectedPrjName).path
        )
        return
      }
    }

    const url = await vscode.window.showInputBox({
      placeHolder: 'Input a remote repository path.'
    })
    if (!url) return

    const tmpDir = os.tmpdir()
    const regRs = /.+\/(.+?)(?:\.git)?$/.exec(url.trim())
    if (!regRs || !regRs[1]) {
      vscode.window.showErrorMessage(`Invalid path: ${url}`)
      return
    }
    const prjName = regRs[1]
    const fullPath = `${tmpDir}${path.sep}${prjName}`
    let progressResolve = () => {}
    const gitSpawn = cp.spawn('git', ['clone', '--progress', url.trim(), fullPath]);
    let gitCloneProgress = null

    gitSpawn.stdout.on('data', (data) => { console.log(data) })
    gitSpawn.stderr.on('data', (data) => {
      const errStr = data.toString()
      console.error(errStr)
      // git 关键信息都输出在stderr
      if (/^s*fatal:/.test(errStr)) {
        vscode.window.showErrorMessage(errStr)
      }

      const increment  = /.*(\d+)%.*/.exec(errStr)
      if (increment) {
        gitCloneProgress.report({ increment: Number(increment[1]) })
      }
    })
    gitSpawn.on('close', (code) => {
      progressResolve()
      if (code !== 0) { return }

      const newReps = [{ prjName, path: fullPath }]
        .concat(
          reps.filter(({ path }) => path !== fullPath)
        )
      context.globalState.update(REPS_STATE_KEY, newReps.slice(0, 10))
      // 最多保存十个临时项目，删除旧的项目
      rmDirs(newReps.slice(10).map(({ path }) => path))

      openDirInNewWindow(fullPath)
    })

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `cloning ${prjName} to ${tmpDir}`,
      cancellable: true
    }, (progress, token) => {
      gitCloneProgress = progress
      token.onCancellationRequested(() => {
        gitSpawn.kill('SIGINT')
        rmDirs([fullPath])
      });
      return new Promise((resolve) => {
        progressResolve = resolve
      })
    })
  });

  const deleteRepository = vscode.commands.registerCommand('temporaryGit.deleteRepository', async () => {
    const reps = context.globalState.get(REPS_STATE_KEY, [])
    if (reps.length === 0) {
      vscode.window.showInformationMessage('Can\'t find repositories.')
      return
    }

    const selectedPrjName = await vscode.window.showQuickPick(
      reps.map(({ prjName }) => prjName)
        .concat('All Repositories'),
      {
        placeHolder: 'Delete the selected repositories.'
      });
    if (!selectedPrjName) return
    
    let restReps = []
    if (selectedPrjName === 'All Repositories') {
      rmDirs(reps.map(({ path }) => path))
      restReps = []
    } else {
      rmDirs(
        reps.filter(({ prjName }) => prjName === selectedPrjName)
          .map(({ path }) => path)
      )
      restReps = reps.filter(({ prjName }) => prjName !== selectedPrjName)
    }
    await context.globalState.update(REPS_STATE_KEY, restReps)
    vscode.window.showInformationMessage(`${selectedPrjName} deleted.`)
  })

  context.subscriptions.push(openRemoteRepository);
  context.subscriptions.push(deleteRepository);
}

function rmDirs(dirs) {
  dirs.forEach((path) => {
    try {
      rimraf.sync(path)
    } catch (e) {
      console.error(e);
      vscode.window.showErrorMessage(e.toString())
      throw e
    }
  })
}

function openDirInNewWindow(dir) {
  fs.exists(dir, (exists) => {
    if (exists) {
      cp.exec(`code ${dir}`, (err, stdout, stderr) => {
        if (!stderr) return
        vscode.window.showErrorMessage(stderr + ';\nYou need install "code" command in PATH')
        console.error(stderr + ';\nYou need install "code" command in PATH');
      })
      return
    }

    vscode.window.showErrorMessage(`${dir} don't exists.`)
    const reps = context.globalState.get(REPS_STATE_KEY, [])
    context.globalState.update(
      REPS_STATE_KEY,
      reps.filter(({ path }) => path !== dir)
     )
  })

}

exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate
}
