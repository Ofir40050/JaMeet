# Project Rules for JaMeet

## Testing and GitHub Policy
- NEVER run automated test suites unless explicitly requested by the user.
- Always commit and push changes to GitHub at the end of each action/task.
- Always return the GitHub Pull Request URL (or compare/commit URL if on main), branch name, commit SHA, and the exact list of committed files at the end of each action/task.
- Apply code changes and let Vite/Electron HMR reload the UI instantly without extra test overhead.

## Architecture & Code Design Rules

### 1. Controller Criteria & Naming
- Do NOT create a new `*Controller.ts` just as a thin wrapper, pass-through proxy, or single-function forwarder.
- Before creating a Controller, verify it meets at least one of these criteria:
  - **Manages Flow/Orchestration**: Coordinates a multi-step asynchronous workflow or state machine.
  - **Coordinates Multiple Systems**: Bridges between different subsystems (e.g., Audio, WebRTC, Preferences, UI).
  - **Manages Lifecycle/Listeners**: Maintains lifecycle state, interval timers, or a collection of event listeners.
- If it does not meet these criteria, classify it properly by responsibility:
  - `*Logic.ts` — Pure business rules and transformations.
  - `*Calculations.ts` / `*Math.ts` — Pure mathematical/audio formulas.
  - `*Testing.ts` / `*Tester.ts` — Diagnostic or testing services.
  - `*Utils.ts` / `*Formatters.ts` — Generic helper functions.
  - `*Ui.ts` — DOM rendering and UI presentation.

### 2. Strict UI Separation (No Business Logic in UI)
- Files named `*Ui.ts` must focus strictly on:
  - DOM rendering and HTML templates (`render*`)
  - DOM event bindings (`addEventListener`)
  - DOM manipulation and updates (`setText`, `classList.toggle`)
- UI files must NEVER contain:
  - Direct network calls (`fetch`, signaling dispatch, API calls).
  - Complex state recalculations or persistence ownership.
  - All side-effects and backend interactions must be delegated through options/context callbacks provided by composition roots or controllers.

### 3. Media Domain Cleanliness (No DOM in Media Data Layers)
- Media data layer modules (e.g., `media/audio/sources/`, `media/remote/`, `media/video/`) must only know audio/video streams, WebRTC, DSP, and native APIs.
- Media data layer modules must NEVER know about or import:
  - DOM elements or selector IDs (e.g., `#music-app-select`, `#camera-preview`).
  - CSS classes or UI components.
- UI elements related to media belong strictly in dedicated `ui/` modules (e.g., `media/audio/ui/`) and consume data types via unidirectional dependencies.

