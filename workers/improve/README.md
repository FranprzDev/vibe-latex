# vibe-latex-improve

Cloudflare Worker (free tier) that post-processes converted note text: fixes
voice-mistranscribed technical terms without adding content. Deploy:

    npx -y wrangler@4 deploy

POST `{ "text": "..." }` → `{ "text": "..." }`. CORS-open (Obsidian plugin).
Falls back to the original text on any error.
