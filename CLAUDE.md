# beliin

MCP server for automated e-commerce checkout on Shopee and Tokopedia using Playwright.

## Project

- Planning docs: `.planning/`
- Research: `.planning/research/`
- Recon data: `~/personal/cards-hackathon-init/recon/`

## Stack

- TypeScript + Node.js
- @modelcontextprotocol/sdk 1.29.0 (stdio transport)
- Playwright 1.59.1 (persistent browser context)
- Zod 3.25.x (input validation)

## Conventions

- All logging via `console.error()` only — `console.log()` corrupts stdio JSON-RPC transport
- Tool errors return `{ isError: true }` — never throw
- Session state in-memory Map keyed by session_id
- Persistent browser context at `~/.beliin/browser-data/`
- PCI form selectors: type+maxLength (Shopee), container IDs (Tokopedia)

## GSD Workflow

This project uses GSD for planning and execution.

- `/gsd-progress` — check current status
- `/gsd-next` — advance to next step
- `/gsd-discuss-phase N` — gather context before planning
- `/gsd-plan-phase N` — create execution plans
- `/gsd-execute-phase N` — execute plans
- `/gsd-verify-work` — verify phase deliverables
