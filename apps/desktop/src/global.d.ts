import type { DesktopApi } from "./preload.js";

type WindowControlsApi = {
	minimize?: () => void;
	close?: () => void;
};

declare global {
	interface Window {
		api: DesktopApi;
		windowControls?: WindowControlsApi;
	}
}
