# Context Panel

The context panel is the main product surface in this fork.

## Hot Path

`startup -> panel shell -> current paper conversation load -> send -> stream`

Everything on the critical path should stay optimized for that flow.

## Main Files

- `index.ts`: panel registration and hydration entry
- `buildUI.ts`: minimal panel DOM
- `setupHandlers.ts`: runtime event wiring
- `chat.ts`: send / load / render / stream orchestration
- `pdfContext.ts`: paper text extraction and retrieval inputs
- `leanPaperContextPlanner.ts`: paper-chat context assembly
- `mineruCache.ts` / `mineruImages.ts`: MinerU paper-chat inputs

## Design Rules

- prefer paper-scoped behavior
- keep selection and hydration work latest-only
- keep history and heavy UI loading on demand
- keep persistence off the immediate interaction path when possible
- do not reintroduce non-essential product surface into the hot path
