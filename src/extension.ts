import * as vscode from 'vscode';
import { GitExtension } from './types/git';

const extensionId = 'whatwasidoin';

export function activate(context: vscode.ExtensionContext) {
  const wwid = new WhatWasIDoin();
  console.log(`Congratulations, your extension ${extensionId} is now active!`);

  // Update the settings when the configuration relevant to the extension changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(extensionId)) {
        return;
      }
      wwid.syncSettings();
    }),
  );

  // Run the main action when the command is triggers
  context.subscriptions.push(
    vscode.commands.registerCommand(`${extensionId}.whatwasidoin`, async () => {
      let isCancelled = false;
      // TODO: Reconsider using `withProgress` here, maybe the status icon loader is enough?
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            isCancelled = true;
          });

          progress.report({ message: "Figuring out what you were doin'..." });
          const result = await wwid.getModelSummaryOfDiff();
          if (!isCancelled) {
            vscode.window.showInformationMessage(result);
          }
        },
      );
    }),
  );
}

async function parseChatResponse(chatResponse: vscode.LanguageModelChatResponse): Promise<string> {
  let accumulatedResponse = '';
  for await (const fragment of chatResponse.text) {
    accumulatedResponse += fragment;
  }
  return accumulatedResponse;
}

class WhatWasIDoin extends vscode.Disposable {
  private _statusBarItem: vscode.StatusBarItem;
  private _summaryLength: number = 900;
  private _showInStatusBar: boolean = true;

  WWID_PROMPT: string =
    'Evaluate the git diff provided and give a brief summary of what the changes collectively would suggest the user was intending to do. Here is an example of what your response should look like: "It looks like you were trying to switch from using npm to pnpm" or "It looks like you were trying to refactor and enhance the bubble game project. The changes include adding a detailed story to the README, updating the viewport settings in the HTML, adding new dependencies and removing some in \`package.json\`, and refactoring the main application code to use ECS (Entity Component System) for managing bubbles. You also updated the CSS for better styling and animations, and switched from Redux to Jotai for state management. Additionally, you made changes to support BigInt in JSON parsing and updated the main entry point to remove the Redux provider."';

  constructor() {
    super(() => this.dispose());

    this.syncSettings();
    this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._statusBarItem.command = `${extensionId}.whatwasidoin`;
    this._statusBarItem.text = '$(question)';
    this._statusBarItem.tooltip = "What was I doin'?";
    if (this._showInStatusBar) {
      this._statusBarItem.show();
    }
  }

  /**
   * Show a loading spinner in the status bar item
   * @returns a function that will reset the status bar item text to the default value
   */
  showLoadingStatusBarItem(): () => void {
    this._statusBarItem.text = '$(loading~spin)';
    return () => {
      this._statusBarItem.text = '$(question)';
    };
  }

  async askModel(diff: string): Promise<string | undefined> {
    let [model] = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: 'gpt-4o',
    });
    const messages = [
      vscode.LanguageModelChatMessage.User(this.WWID_PROMPT),
      vscode.LanguageModelChatMessage.User(`DO NOT make your response longer than ${this._summaryLength} characters.`),
      vscode.LanguageModelChatMessage.User(diff!),
    ];

    if (model) {
      try {
        let chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
        return await parseChatResponse(chatResponse);
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          vscode.window.showErrorMessage(`${err.message}, ${err.code}, ${err.cause}`);
        } else {
          throw err;
        }
      }
    }
  }

  async getModelSummaryOfDiff(): Promise<string> {
    const restoreStatusBarIcon = this.showLoadingStatusBarItem();
    const gitDiffResult = await this.getGitDiff();
    let result = '';

    if (!gitDiffResult) {
      restoreStatusBarIcon();
      return 'Beats me you have no uncommitted changes...';
    }
    try {
      result = (await this.askModel(gitDiffResult!)) ?? '';
    } catch (error) {
      result = `Error: ${error}`;
    }
    restoreStatusBarIcon();
    return result;
  }

  syncSettings(): void {
    const userSetting = vscode.workspace.getConfiguration(extensionId);
    // Show or hide the status bar item based on the new user setting.
    if (this._showInStatusBar !== userSetting.showInStatusBar) {
      userSetting.showInStatusBar ? this._statusBarItem.show() : this._statusBarItem.hide();
    }
    // only allow `_summaryLength` to be between 0 and 900 characters,
    // but also why would anyone want less than like 200?
    this._summaryLength = Math.max(0, Math.min(userSetting.summaryLength, 900));
    this._showInStatusBar = userSetting.showInStatusBar;
  }

  async getGitDiff(): Promise<string | null> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
    const api = gitExtension?.getAPI(1);
    const repo = api?.repositories[0];

    if (!repo) {
      throw new Error('No Git repository found');
    }

    const changes = repo.state.workingTreeChanges;
    if (changes.length === 0) {
      return null;
    }

    let diff = '';
    for (const change of changes) {
      const uri = change.uri;
      // diff with HEAD to get the changes that are not yet committed
      diff += await repo.diffWithHEAD(uri.fsPath);
    }
    return diff;
  }

  dispose() {
    this._statusBarItem.dispose();
  }
}
