# Deploy

This is a static three.js site with no build step. Pick one host below.

## First-time setup: create GitHub remote

This repo doesn't have a GitHub remote yet. Create one:

```bash
gh repo create ghanemja/bookshelf-portfolio --public --source=. --push
```

## Option A: GitHub Pages (recommended)

A workflow is wired up at `.github/workflows/deploy.yml` — it deploys every push to `main` straight from the repo root, no build step.

After the first push:

1. Go to **Settings → Pages** in the GitHub repo.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. The workflow runs automatically on push; the URL appears in the Actions tab on success.

Final URL: `https://ghanemja.github.io/bookshelf-portfolio/`

## Option B: Netlify

A `netlify.toml` is included that publishes the repo root with no build command.

1. Push to GitHub (see above).
2. On [netlify.com](https://app.netlify.com/), **Add new site → Import from Git** → pick this repo.
3. Accept the defaults — `netlify.toml` already configures publish dir and SPA-style redirects.

## Local preview

```bash
python3 -m http.server 5173
# → http://localhost:5173
```

Or `npx serve .`
