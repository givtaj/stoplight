import { describe, expect, it, vi } from "vitest";

import { EMPTY_SESSION_STATE, PORT_NAME, type PanelCommand, type WorkerEvent } from "../shared/types";
import { bindWorkerPort } from "./index";

class ListenerSet<T extends (...args: never[]) => void> {
  private readonly listeners: T[] = [];

  addListener(listener: T): void {
    this.listeners.push(listener);
  }

  emit(...args: Parameters<T>): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createPort(name = PORT_NAME) {
  const messages = new ListenerSet<(message: PanelCommand) => void>();
  const disconnects = new ListenerSet<() => void>();
  const posted: WorkerEvent[] = [];

  return {
    port: {
      name,
      postMessage(message: WorkerEvent) {
        posted.push(message);
      },
      onMessage: {
        addListener(listener: (message: PanelCommand) => void) {
          messages.addListener(listener);
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnects.addListener(listener);
        },
      },
    },
    messages,
    disconnects,
    posted,
  };
}

type TestController = {
  subscribe(listener: (event: WorkerEvent) => void): () => void;
  handleCommand(command: PanelCommand): Promise<void>;
  handleDebuggerEvent(): Promise<void>;
  handleDebuggerDetach(): Promise<void>;
};

describe("bindWorkerPort", () => {
  it("buffers messages until the controller is ready", async () => {
    const pendingController = deferred<TestController>();
    const port = createPort();
    const handleCommand = vi.fn(async () => undefined);

    bindWorkerPort(port.port, pendingController.promise);
    port.messages.emit({ type: "requestState" });

    expect(handleCommand).not.toHaveBeenCalled();

    pendingController.resolve({
      subscribe(listener) {
        listener({ type: "state", state: EMPTY_SESSION_STATE });
        return () => undefined;
      },
      handleCommand,
      async handleDebuggerEvent() {
        return undefined;
      },
      async handleDebuggerDetach() {
        return undefined;
      },
    });

    await Promise.resolve();

    expect(port.posted).toEqual([{ type: "state", state: EMPTY_SESSION_STATE }]);
    expect(handleCommand).toHaveBeenCalledWith({ type: "requestState" });
  });

  it("surfaces bootstrap failures to the side panel port", async () => {
    const pendingController = deferred<TestController>();
    const port = createPort();

    bindWorkerPort(port.port, pendingController.promise);
    pendingController.reject(new Error("bootstrap failed"));

    await Promise.resolve();
    await Promise.resolve();

    expect(port.posted).toEqual([
      {
        type: "error",
        message: "bootstrap failed",
      },
    ]);
  });
});
