import * as vscode from 'vscode';
import { GitExtension } from './api/git';

const extensionId = 'wwid';

const WWID_PROMPT = `You are an assistant who helps developers remember what they were doing. Your job is to evaluate the git diff the user gives you and then provide a brief summary of what the changes collectively would suggest the user was intending to do. Do not make your summary longer than 975 characters.`;
// TODO add an example of what a response could look like: "Here is an example of what your response should look like: ..." "If you cannot figure out a single intention then give a brief summary of the most important changes."

export function activate(context: vscode.ExtensionContext) {
	const wwid = new WhatWasIDoin();
	let result = '';
    console.log(`Congratulations, your extension ${extensionId} is now active!`);

    const disposable = vscode.commands.registerCommand(`${extensionId}.whatwasidoin`, async () => {
				let diff = '';
				try {
					vscode.window.withProgress({
							location: vscode.ProgressLocation.Window,
							cancellable: false,
							title: 'Figuring out what you were doing...'
					}, async (progress) => {

							progress.report({  increment: 0 });

							await Promise.resolve();

							progress.report({ increment: 100 });
					});

				  const gitDiffResult = await getGitDiff();

				  if (gitDiffResult) {
					  [diff] = gitDiffResult;
					  console.log(diff);
				  } else {
					  vscode.window.showInformationMessage('The \'What was i doin\' extension only works with git repos that have uncommitted changes. No changes found in the Git repository.');
				  }
			} catch (error) {
					vscode.window.showErrorMessage(`Error: ${error}`);
			}

					// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
					let [model] = await vscode.lm.selectChatModels({
						vendor: 'copilot',
						family: 'gpt-4o'
					});
					const messages = [
						vscode.LanguageModelChatMessage.User(WWID_PROMPT),
						vscode.LanguageModelChatMessage.User(diff)
					];

					// make sure the model is available
					if (model) {
						try {
							let chatResponse = await model.sendRequest(
								messages,
								{},
								new vscode.CancellationTokenSource().token
							);
							if (chatResponse) {
								// handle chat response
								result += await parseChatResponse(chatResponse);
								vscode.window.showInformationMessage(result);
							}
						} catch (err) {
							if (err instanceof vscode.LanguageModelError) {
								vscode.window.showErrorMessage(`${err.message}, ${err.code}, ${err.cause}`);
							} else {
								throw err;
							}
							return;
						}
					}
    });

    context.subscriptions.push(disposable);
		context.subscriptions.push(wwid);
}

async function parseChatResponse(
  chatResponse: vscode.LanguageModelChatResponse
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
				this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
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

