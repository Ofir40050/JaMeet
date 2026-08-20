export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setText(id: string, text: string): void {
  const node = $(id);
  if (node) node.textContent = text;
}

export function setMessage(id: string, message: string, error = false): void {
  const node = $(id);
  if (node) {
    node.textContent = message;
    node.classList.toggle('error', error);
  }
}
