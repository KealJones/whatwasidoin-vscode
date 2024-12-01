import * as vscode from 'vscode';
import { GitExtension } from './api/git';

const extensionId = 'wwid';

const WWID_PROMPT = `Evaluate the git diff provided and give a brief summary of what the changes collectively would suggest the user was intending to do. DO NOT make your summary longer than 900 characters. Here is an example of what your response should look like: "It looks like you were trying to switch from using npm to pnpm" or "It looks like you were trying to refactor and enhance the bubble game project. The changes include adding a detailed story to the README, updating the viewport settings in the HTML, adding new dependencies and removing some in \`package.json\`, and refactoring the main application code to use ECS (Entity Component System) for managing bubbles. You also updated the CSS for better styling and animations, and switched from Redux to Jotai for state management. Additionally, you made changes to support BigInt in JSON parsing and updated the main entry point to remove the Redux provider."`;

export function activate(context: vscode.ExtensionContext) {
  const wwid = new WhatWasIDoin();
  console.log(`Congratulations, your extension ${extensionId} is now active!`);

  const disposable = vscode.commands.registerCommand(
    `${extensionId}.whatwasidoin`,
    async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: 'Figuring out what you were doing...',
          },
          async (progress, token) => {
            token.onCancellationRequested(() => {
              console.log('User canceled the long running operation');
            });

            progress.report({ increment: 0 });

            const gitDiffResult = await getGitDiff();

            if (!gitDiffResult) {
              vscode.window.showInformationMessage(
                "The 'What was i doin' extension only works with git repos that have uncommitted changes. No changes found in the Git repository.",
              );
            }

            progress.report({ increment: 50 });

            let [model] = await vscode.lm.selectChatModels({
              vendor: 'copilot',
              family: 'gpt-4o',
            });
            const messages = [
              vscode.LanguageModelChatMessage.User(WWID_PROMPT),
              vscode.LanguageModelChatMessage.User(gitDiffResult!),
            ];

            // make sure the model is available
            if (model) {
              try {
                let chatResponse = await model.sendRequest(
                  messages,
                  {},
                  new vscode.CancellationTokenSource().token,
                );
                if (chatResponse) {
                  // handle chat response
                  const result = await parseChatResponse(chatResponse);
                  progress.report({ increment: 100 });
                  vscode.window.showInformationMessage(result);
                }
              } catch (err) {
                if (err instanceof vscode.LanguageModelError) {
                  vscode.window.showErrorMessage(
                    `${err.message}, ${err.code}, ${err.cause}`,
                  );
                } else {
                  throw err;
                }
                return;
              }
            }
          },
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    },
  );

  context.subscriptions.push(disposable);
  context.subscriptions.push(wwid);
}

async function parseChatResponse(
  chatResponse: vscode.LanguageModelChatResponse,
): Promise<string> {
  let accumulatedResponse = '';

  for await (const fragment of chatResponse.text) {
    accumulatedResponse += fragment;

    // if the fragment is a }, we can try to parse the whole line
    if (fragment.includes('}')) {
      try {
        const annotation = JSON.parse(accumulatedResponse);

        // reset the accumulator for the next line
        accumulatedResponse = '';
      } catch (e) {
        // do nothing
      }
    }
  }
  return accumulatedResponse;
}

class WhatWasIDoin extends vscode.Disposable {
  private _statusBarItem: vscode.StatusBarItem;

  constructor() {
    super(() => this.dispose());
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this._statusBarItem.command = `${extensionId}.whatwasidoin`;
    this._statusBarItem.text = '$(question)';
    this._statusBarItem.tooltip = 'What Was I Doin?';
    this._statusBarItem.show();
    console.log('WhatWasIDoin StatusBarItem created');
  }

  dispose() {
    this._statusBarItem.dispose();
  }
}

async function getGitDiff(): Promise<string | null> {
  const gitExtension =
    vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
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
