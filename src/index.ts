import * as vscode from 'vscode';
import { OpenAI } from 'openai';
import * as path from 'path';
import { execSync } from 'child_process';
import { ChatCompletionMessageParam } from 'openai/resources';


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'fake-for-ollama',
    baseURL: 'http://localhost:11434/v1',
});

const debugFunctions = [
    {
        name: 'setBreakpoint',
        description: 'Sets a breakpoint in a specific file and line.',
        parameters: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    description: 'Path to the file. Can be absolute or relative to the workspace root.'
                },
                line: {
                    type: 'number',
                    description: 'Line number (1-based) at which the breakpoint should be set.'
                }
            },
            required: ['file', 'line']
        }
    },
    {
        name: 'stepOver',
        description: 'Step over the current line in the debugger',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'stepIn',
        description: 'Step into the current function call in the debugger',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'stepOut',
        description: 'Step out of the current function call in the debugger',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'continueExec',
        description: 'Continue execution in the debugger',
        parameters: { type: 'object', properties: {} },
    }
];

export async function activate(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
        // Node.js only for now
        await vscode.debug.startDebugging(undefined, {
            type: 'node',
            request: 'launch',
            name: 'LLM Debugger',
            program: '${workspaceFolder}/app.js'
        });

        // Yek hard dependency..
        const repoCode = execSync('yek', {
            // workspace root
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        }).toString();

        // Prepare a basic system or user prompt
        const systemMessage: ChatCompletionMessageParam = {
            role: 'system',
            content: 'You are an AI assistant that decides debugging steps.'
        };

        const userMessage: ChatCompletionMessageParam = {
            role: 'user',
            content: `Here is the code to analyze:\n${repoCode}\nBased on this code, decide the next debugger action by calling one of the provided functions.`
        };

        // Continuously ask the LLM for next steps (until some stopping condition)
        let continueDebugging = true;

        while (continueDebugging && vscode.debug.activeDebugSession) {
            // Call the LLM with function calling
            const response = await openai.chat.completions.create({
                model: 'phi4-tools', 
                messages: [systemMessage, userMessage],
                functions: debugFunctions,
                function_call: 'auto'
            });

            // Check if the response includes a function call
            const choice = response.choices[0];
            const finishReason = choice.finish_reason;

            for (const toolCall of choice.message?.tool_calls || []) {
                const { function: { name, arguments: functionArgsString } } = toolCall;

                switch (name) {
                    case 'setBreakpoint':
                        await setBreakpoint(functionArgsString);
                        break;
                    case 'stepOver':
                        await vscode.debug.activeDebugSession.customRequest('next');
                        break;
                    case 'stepIn':
                        await vscode.debug.activeDebugSession.customRequest('stepIn');
                        break;
                    case 'stepOut':
                        await vscode.debug.activeDebugSession.customRequest('stepOut');
                        break;
                    case 'continueExec':
                        await vscode.debug.activeDebugSession.customRequest('continue');
                        break;
                    default:
                        // If LLM calls something unknown, do nothing or log.
                        break;
                }
            }

            // Decide when to stop the loop:
            // 1) If the LLM said it's finished
            // 2) If the debug session ended
            if (!vscode.debug.activeDebugSession || finishReason === 'stop') {
                continueDebugging = false;
            }
        }
    });

    context.subscriptions.push(command);
}

async function setBreakpoint(functionArgsString: string) {
    try {
        // Parse function arguments
        const { file, line } = JSON.parse(functionArgsString);

        // Resolve file path
        let fullPath = file;
        // If the path is not absolute, try resolving it relative to the first workspace folder
        if (!path.isAbsolute(file) && vscode.workspace.workspaceFolders?.length) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            fullPath = path.join(workspaceRoot, file);
        }

        // Create a breakpoint at the specified line (minus 1 since Position is zero-based)
        const uri = vscode.Uri.file(fullPath);
        const position = new vscode.Position(line - 1, 0);
        const location = new vscode.Location(uri, position);

        const breakpoint = new vscode.SourceBreakpoint(location, true);
        vscode.debug.addBreakpoints([breakpoint]);

        // Optionally, you could provide feedback in VS Code UI
        vscode.window.showInformationMessage(`Breakpoint set at ${file}:${line}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to set breakpoint: ${String(err)}`);
    }
}

export function deactivate() {
    // Cleanup if needed
}