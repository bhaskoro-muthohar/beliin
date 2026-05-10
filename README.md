# beliin

*beliin* (Indonesian slang: "buy it for me") — an MCP server that automates e-commerce checkout on Tokopedia using Playwright, orchestrated by Claude Desktop. Given a product URL and a virtual Visa card from the x402 Card MCP, beliin drives the browser through search, product selection, payment form entry, and checkout — pausing only when human input is genuinely required (login, OTP).

## Architecture

```
User ──► Claude Desktop ──┬──► x402 Card MCP ──► Virtual Visa (PAN, CVV, expiry)
                          │
                          └──► beliin MCP ──► Playwright ──► Tokopedia
```

## Prerequisites

- Node.js 18+
- A Tokopedia account (logged in, with a saved shipping address)
- x402 Card MCP access (hackathon API key)
- Claude Desktop

## Important Notes

- **Login required:** On first run, the Playwright browser opens automatically. Log into your Tokopedia account manually — the session persists across future runs.
- **Saved address:** Your Tokopedia account must have a shipping address configured before checkout.
- **Tokopedia only:** The Shopee adapter is scaffolded but not functional. Only `buy_on_tokopedia` and `search_on_tokopedia` work end-to-end.
- **Why Playwright?** Tokopedia has no public checkout API. Browser automation through their actual UI is the only way to complete a real purchase.

## Setup

```bash
git clone https://github.com/bhaskoro-muthohar/beliin.git
cd beliin
npm install
npx playwright install chromium
```

Or run the setup script:

```bash
./scripts/setup.sh
```

## Claude Desktop Configuration

Add both MCP servers to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402card": {
      "command": "npx",
      "args": ["mcp-remote", "https://card.straitsx.ai/mcp"]
    },
    "beliin": {
      "command": "npx",
      "args": ["tsx", "/path/to/beliin/src/index.ts"]
    }
  }
}
```

Replace `/path/to/beliin` with the actual path to your cloned repo.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_on_tokopedia` | Search Tokopedia for products matching a query, return top results with URLs and prices |
| `buy_on_tokopedia` | Start an autonomous checkout session for a Tokopedia product URL with card details |
| `search_on_shopee` | Search Shopee for products (scaffolded) |
| `buy_on_shopee` | Start a checkout session on Shopee (scaffolded) |
| `extract_card_details` | Scrape card PAN/CVV/expiry from an x402 iframe URL using Playwright |
| `get_session_status` | Poll the progress of an async checkout session |
| `submit_input` | Provide human input (OTP, variant selection, card details) to a paused session |

## Example Prompt

> I already have a virtual card issued. Card opaque ID: `01KBH2EYSAD339Z3X18E9RWTVK`, settlement TX: `0x681bd5c...`. Retrieve the card details first.
>
> Then help me buy something. I've been getting into spirits lately and want to explore something new. I usually enjoy whiskey — I like the warmth and complexity — but I'm open to trying a nice rum or Japanese whisky if it's worth it. I don't enjoy anything too smoky or harsh.
>
> Find me something interesting on Tokopedia:
> - Budget: under Rp 600,000
> - Something approachable but not boring — I want to taste something with character
> - Good reviews and popular with other buyers
> - Prefer sellers in Jabodetabek for fast shipping
> - Surprise me with your pick, but explain why you chose it
>
> Search, compare a few options, and buy the best one. No need to ask me — I trust your taste.

## How It Works

1. Claude calls `search_on_tokopedia` to find products matching constraints
2. Claude picks a product and calls x402's `get_virtual_card` + `view_virtual_card` to mint a fresh Visa
3. Claude calls `extract_card_details` to scrape PAN/CVV/expiry from the x402 iframe
4. Claude calls `buy_on_tokopedia` with the product URL and card details
5. beliin drives Playwright through: PDP → variant selection → cart/buy → checkout → card form → CVV → 3DS → success
6. Claude polls `get_session_status` until the session reaches `success` or `failed`
7. If the session pauses (`need_input`), Claude provides input via `submit_input`

## Demo

[Demo Video](https://www.youtube.com/watch?v=s24sHaPLWog)

## Claude Code Skill (Bonus Track)

beliin also ships as a Claude Code skill. Type `/beliin` in Claude Code and describe what you want — the agent handles card issuance, search, comparison, and checkout autonomously.

```bash
# In Claude Code:
/beliin I want a nice bottle of Japanese whisky under Rp500k
```

> **Note:** The demo video does NOT use the /beliin skill. We intentionally demonstrated the raw MCP flow — Claude picks up the tools from their descriptions alone and orchestrates the full purchase without any pre-packaged instructions. The skill is a convenience wrapper for repeat use, not a crutch.

## Tech Stack

- TypeScript + Node.js
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) (stdio transport)
- [Playwright](https://playwright.dev/) (persistent browser context)
- [Zod](https://zod.dev/) (input validation)
