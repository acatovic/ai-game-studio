import "./styles/main.css";
import { mountApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("#app not found");
}
mountApp(root);
