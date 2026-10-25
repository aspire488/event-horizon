# Release status

## Local release candidate

- Product: EVENT HORIZON; the in-app GOD MODE label is retained.
- Build: Vite 7.3.7 production build succeeds; the production preview at `http://localhost:4173/` serves the latest build.
- Verification: typecheck passed; 46 unit tests passed; 18 production-browser smoke checks passed; final UAT journey rerun passed 11 checks with zero failures; the prior 600.9-second interaction session passed.
- Dependencies: clean `npm ci` succeeded and `npm audit` reported zero vulnerabilities. Node 20.19+ is required by the selected Vite toolchain.
- Public project license: not selected; no `LICENSE` file has been added.

## GitHub publication — waiting for CLI authorization

The authenticated GitHub connector identifies the account as `aspire488`; the requested `aspire488/event-horizon` repository does not exist. The connector has no create-repository operation. The local `gh` CLI has no saved login after the invalid `GITHUB_TOKEN` override was removed, so no repository was created and no push occurred. The project has a local `main` branch and initial commit; no remote is configured.

After signing into GitHub CLI, publish this local commit with:

```sh
gh auth login -h github.com -p https -w
gh repo create event-horizon --public --source . --remote origin --push --description "Interactive cosmic physics sandbox for manipulating gravity, black holes, supernovas, and orbital systems in a living universe."
```

## Vercel deployment — waiting for account authorization

The app is a static Vite site: `npm ci`, `npm run build`, output directory `dist`; it has no backend, required environment variables, or client-side URL routes. No Vercel CLI, auth file, project link, or Vercel integration is available here. No deployment was created or claimed.

After authenticating a Vercel CLI session, deploy with:

```sh
npx vercel login
npx vercel --prod
```

Accept the detected Vite defaults, then verify the returned HTTPS URL and run the production smoke checks against it. No `vercel.json` is needed for this static, route-free app.

## Environment and limitations

- Browser: isolated Playwright Chromium 156.0.8078.47, headless; SwiftShader software WebGL.
- Physical GPU performance, physical touch, browser-level zoom extremes, and injected WebGL context loss were not tested.
- The working directory did not contain Git metadata before this release preparation. GitHub publication remains pending the CLI login step above.
- The project source and dependency lockfile were scanned for common credential patterns before staging; none were found. Local env files, dependency directories, build output, and npm cache are ignored.
