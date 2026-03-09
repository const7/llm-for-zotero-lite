import type {
  AgentPromptDefinition,
  AgentResourceDefinition,
  AgentToolCall,
  AgentToolContext,
  AgentToolDefinition,
  PreparedToolExecution,
  PromptSpec,
  ResourceSpec,
  ToolSpec,
} from "../types";

function createSyntheticErrorResult(
  call: AgentToolCall,
  message: string,
): PreparedToolExecution {
  return {
    kind: "result",
    result: {
      callId: call.id,
      name: call.name,
      ok: false,
      content: { error: message },
    },
  };
}

function createRequestId(): string {
  return `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition<any, any>>();
  private readonly resources = new Map<string, AgentResourceDefinition<any>>();
  private readonly prompts = new Map<string, AgentPromptDefinition<any>>();

  register<TInput, TResult>(tool: AgentToolDefinition<TInput, TResult>): void {
    this.tools.set(tool.spec.name, tool);
  }

  registerResource<TValue>(resource: AgentResourceDefinition<TValue>): void {
    this.resources.set(resource.spec.name, resource);
  }

  registerPrompt<TArgs>(prompt: AgentPromptDefinition<TArgs>): void {
    this.prompts.set(prompt.spec.name, prompt);
  }

  listTools(): ToolSpec[] {
    return Array.from(this.tools.values()).map((tool) => tool.spec);
  }

  listResources(): ResourceSpec[] {
    return Array.from(this.resources.values()).map((resource) => resource.spec);
  }

  listPrompts(): PromptSpec[] {
    return Array.from(this.prompts.values()).map((prompt) => prompt.spec);
  }

  getTool(name: string): AgentToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  getResource(name: string): AgentResourceDefinition<any> | undefined {
    return this.resources.get(name);
  }

  getPrompt(name: string): AgentPromptDefinition<any> | undefined {
    return this.prompts.get(name);
  }

  async prepareExecution(
    call: AgentToolCall,
    context: AgentToolContext,
  ): Promise<PreparedToolExecution> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createSyntheticErrorResult(call, `Unknown tool: ${call.name}`);
    }
    const validation = tool.validate(call.arguments);
    if (!validation.ok) {
      return createSyntheticErrorResult(
        call,
        `Invalid tool input for ${call.name}: ${validation.error}`,
      );
    }

    const runExecution = async () => {
      const runWithInput = async (resolvedInput: typeof validation.value) => {
        try {
          const content = await tool.execute(resolvedInput, context);
          return {
            callId: call.id,
            name: call.name,
            ok: true,
            content,
          };
        } catch (error) {
          return {
            callId: call.id,
            name: call.name,
            ok: false,
            content: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      };
      return runWithInput(validation.value);
    };

    const runConfirmedExecution = async (resolutionData?: unknown) => {
      if (resolutionData !== undefined && tool.applyConfirmation) {
        const resolved = tool.applyConfirmation(
          validation.value,
          resolutionData,
          context,
        );
        if (!resolved.ok) {
          return {
            callId: call.id,
            name: call.name,
            ok: false,
            content: {
              error: `Invalid confirmation input for ${call.name}: ${resolved.error}`,
            },
          };
        }
        try {
          const content = await tool.execute(resolved.value, context);
          return {
            callId: call.id,
            name: call.name,
            ok: true,
            content,
          };
        } catch (error) {
          return {
            callId: call.id,
            name: call.name,
            ok: false,
            content: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
      try {
        const content = await tool.execute(validation.value, context);
        return {
          callId: call.id,
          name: call.name,
          ok: true,
          content,
        };
      } catch (error) {
        return {
          callId: call.id,
          name: call.name,
          ok: false,
          content: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    };

    if (tool.spec.requiresConfirmation && tool.createPendingWriteAction) {
      const requestId = createRequestId();
      return {
        kind: "confirmation",
        requestId,
        action: tool.createPendingWriteAction(validation.value, context),
        execute: runConfirmedExecution,
        deny: () => ({
          callId: call.id,
          name: call.name,
          ok: false,
          content: { error: "User denied action" },
        }),
      };
    }

    return {
      kind: "result",
      result: await runExecution(),
    };
  }
}
