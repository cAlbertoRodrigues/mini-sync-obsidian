import { mountOnboarding } from "./ui/onboarding.js";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (!root) throw new Error("Mini Sync: #app não encontrado");
  mountOnboarding(root);
});
