# KingBebras (interactive Bebras test)

Browser-only student experience: login → attempt → 15 interactive tasks.

## Run locally (teacher/dev)

1. Install dependencies

```bash
npm install
```

2. Start server

```bash
npm run dev
```

3. Open `http://localhost:3000`

## How scoring works (current prototype)

- Each task sends "move" events to the host page using `postMessage`.
- The host page records each move via `POST /api/moves`.
- When the task is finished, `POST /api/tasks/finish` computes:
  - `finalScore = maxScore - sum(penalty for moves)`

You can customize penalty rules per task (or per move type) later.

