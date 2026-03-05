import type { DesktopApi } from "../preload";

export {};

declare global {
  interface Window {
    api: DesktopApi;
  }
}