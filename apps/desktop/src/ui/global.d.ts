import { clear } from "node:console";

export {};

declare global {
  type Unsubscribe = () => void;

  interface Window {
    api: {
      on<T = unknown>(channel: string, handler: (payload: T) => void): Unsubscribe;
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
      send(channel: string, ...args: unknown[]): void;
    };
  }
}
