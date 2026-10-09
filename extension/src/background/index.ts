import { PORT_NAME, type PanelCommand, type WorkerEvent } from "../shared/types";
import { loadStoplightWasm } from "../shared/wasm";
import { StoplightController } from "./controller";

interface PortLike {
  name: string;
  postMessage(message: WorkerEvent): void;
  onMessage: {
    addListener(listener: (message: PanelCommand) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
}

interface ControllerLike {
  subscribe(listener: (event: WorkerEvent) => void): () => void;
  handleCommand(command: PanelCommand): Promise<void>;
  refreshArmTarget(): Promise<void>;
  handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: unknown,
  ): Promise<void>;
  handleDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): Promise<void>;
}

if (canStartBackground()) {
  const controllerPromise = initializeController();

  chrome.runtime.onConnect.addListener((port) => {
    bindWorkerPort(port, controllerPromise);
  });

  void controllerPromise
    .then((controller) => {
      chrome.debugger.onEvent.addListener((source, method, params) => {
        void controller.handleDebuggerEvent(source, method, params);
      });

      chrome.debugger.onDetach.addListener((source, reason) => {
        void controller.handleDebuggerDetach(source, String(reason));
      });

      chrome.tabs?.onActivated?.addListener(() => {
        void controller.refreshArmTarget();
      });

      chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo, tab) => {
        if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
          void controller.refreshArmTarget();
        }
      });
    })
    .catch((error) => {
      console.error("Stoplight background bootstrap failed.", error);
    });
}

export function bindWorkerPort(
  port: PortLike,
  controllerPromise: Promise<ControllerLike>,
): void {
  if (port.name !== PORT_NAME) {
    return;
  }

  let disconnected = false;
  let controller: ControllerLike | null = null;
  let unsubscribe: (() => void) | null = null;
  const queuedMessages: PanelCommand[] = [];

  port.onMessage.addListener((message) => {
    if (controller) {
      void controller.handleCommand(message);
      return;
    }

    queuedMessages.push(message);
  });

  port.onDisconnect.addListener(() => {
    disconnected = true;
    unsubscribe?.();
    unsubscribe = null;
  });

  void controllerPromise
    .then((readyController) => {
      if (disconnected) {
        return;
      }

      controller = readyController;
      unsubscribe = readyController.subscribe((event) => {
        port.postMessage(event);
      });

      for (const message of queuedMessages) {
        void readyController.handleCommand(message);
      }
      queuedMessages.length = 0;
    })
    .catch((error) => {
      if (disconnected) {
        return;
      }

      port.postMessage({
        type: "error",
        message: toErrorMessage(error),
      });
    });
}

async function initializeController(): Promise<StoplightController> {
  const wasm = await loadStoplightWasm();
  const controller = new StoplightController({
    wasm,
    debuggerApi: {
      attach(target, requiredVersion) {
        return new Promise((resolve, reject) => {
          chrome.debugger.attach(target, requiredVersion, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve();
          });
        });
      },
      detach(target) {
        return new Promise((resolve, reject) => {
          chrome.debugger.detach(target, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve();
          });
        });
      },
      sendCommand(target, method, commandParams) {
        return new Promise((resolve, reject) => {
          chrome.debugger.sendCommand(target, method, commandParams, (result) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(result);
          });
        });
      },
    },
    tabsApi: {
      query(queryInfo) {
        return new Promise((resolve, reject) => {
          chrome.tabs.query(queryInfo, (tabs) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(tabs);
          });
        });
      },
    },
    sessionStorage: {
      get(keys) {
        return new Promise((resolve, reject) => {
          chrome.storage.session.get(keys ?? null, (items) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(items);
          });
        });
      },
      set(items) {
        return new Promise((resolve, reject) => {
          chrome.storage.session.set(items, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve();
          });
        });
      },
    },
    localStorage: {
      get(keys) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.get(keys ?? null, (items) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(items);
          });
        });
      },
      set(items) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.set(items, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve();
          });
        });
      },
    },
  });

  await controller.hydrate();

  try {
    await new Promise<void>((resolve, reject) => {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  } catch {
    // Leave panel behavior as-is if Chrome rejects the call.
  }

  return controller;
}

function canStartBackground(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime?.onConnect !== "undefined" &&
    typeof chrome.debugger?.onEvent !== "undefined" &&
    typeof chrome.debugger?.onDetach !== "undefined"
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}
