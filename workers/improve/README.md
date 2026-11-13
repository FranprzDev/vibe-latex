# vibe-latex-improve

Cloudflare Worker (free tier) backing two optional plugin features. Deploy:

    npx -y wrangler@4 deploy

- `POST /` `{ "text": "..." }` → `{ "text": "..." }`: fixes
  voice-mistranscribed technical terms (llama-3.3-70b-instruct-fp8-fast)
  without adding content.
- `POST /vision` `{ "image": "<base64>" }` → `{ "text": "<latex>" }`:
  transcribes a formula screenshot to LaTeX
  (llama-3.2-11b-vision-instruct; its Community License was accepted on
  the account, which the model requires once).

CORS-open (Obsidian plugin). Every route falls back cleanly on error.
