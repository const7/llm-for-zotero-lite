export type CodexProcess = {
  stdin: { write(text: string): Promise<unknown> | void };
  stdout: { readString(): Promise<string | null> };
  stderr: { readString(): Promise<string | null> };
  kill(): unknown;
  wait(): Promise<unknown>;
};

type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message: string };
};

type PendingRequest = {
  resolve(value: any): void;
  reject(error: Error): void;
};

// One connection owns one process and one inference. Closing it cancels all work.
export class CodexRpc {
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private closed: Error | null = null;
  private stderr = "";
  onNotification: (method: string, params: any) => void = () => {};
  onClose: (error: Error) => void = () => {};

  constructor(private process: CodexProcess) {
    void this.readStdout();
    void this.readStderr();
    void process.wait().then(
      () =>
        this.close(new Error(`Codex process exited. ${this.stderr}`.trim())),
      (error) => this.close(error),
    );
  }

  async request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.closed) throw this.closed;
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(new Error(`Codex timed out: ${method}`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      void this.write({ id, method, params });
    });
  }

  async notify(method: string): Promise<void> {
    if (this.closed) throw this.closed;
    await this.write({ method });
  }

  close(error = new Error("Codex connection closed")): void {
    if (this.closed) return;
    this.closed = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    try {
      void Promise.resolve(this.process.kill()).catch(() => {});
    } catch {
      /* Process may already have exited. */
    }
    this.onClose(error);
  }

  private async write(message: RpcMessage): Promise<void> {
    try {
      await this.process.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async readStderr(): Promise<void> {
    try {
      while (!this.closed) {
        const chunk = await this.process.stderr.readString();
        if (!chunk) break;
        // Diagnostics only; never log protocol payloads or paper contents.
        this.stderr = (this.stderr + chunk).slice(-2000);
      }
    } catch {
      /* stdout/process completion owns connection failure. */
    }
  }

  private async readStdout(): Promise<void> {
    let buffer = "";
    try {
      while (!this.closed) {
        const chunk = await this.process.stdout.readString();
        if (!chunk) {
          this.close(
            new Error(`Codex closed its output. ${this.stderr}`.trim()),
          );
          break;
        }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const message = JSON.parse(line) as RpcMessage;
          if (message.method && message.id !== undefined) {
            // This paper-chat client has no interactive tools or approval UI.
            await this.write({
              id: message.id,
              error: {
                code: -32601,
                message: "Interactive tools are unavailable in paper chat.",
              },
            });
            this.close(
              new Error(
                `Codex requested an unsupported interaction: ${message.method}`,
              ),
            );
            return;
          }
          if (typeof message.id === "number") {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
          } else if (message.method) {
            this.onNotification(message.method, message.params);
          }
        }
      }
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
