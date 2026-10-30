# Digest review preview

Issue: https://github.com/sspasha0605/mega-s01e04/issues/7
Cleanup: https://github.com/sspasha0605/mega-s01e04/issues/8

The preview is one self-contained HTML response from the running service. Keep it outside this repository. Only the template sample data and the issued lane marker belong in that page.

## Export

Set the course-issued `LANE_MARKER` in the ignored `.env`, then start the service:

```sh
pnpm start
```

In another terminal, save its actual response outside the repository:

```sh
mkdir -p ../preview
curl --fail --silent --show-error http://localhost:8787/digest/2026-10-28 -o ../preview/index.html
```

## Publish after approval

Use a Cloudflare Pages Direct Upload project in the student's own account. Upload only the preview directory. Proposed project name: `mega-s01e04-sspasha0605`; use its production `pages.dev` URL for review and cleanup. Record the actual assigned URL; do not assume name availability. Do not connect the source repository as the static site, and do not upload `.env` or working logs.

Before deploying, ask the student to approve the public sample-data page and marker, destination, audience, and removal method. Account creation, authentication and any spending remain separate student decisions. Keep issue #7 open until the approved public HTTPS URL and issue list reach the reviewer.

Cloudflare Direct Upload documentation: https://developers.cloudflare.com/pages/get-started/direct-upload/

## Cleanup after review and separate approval

Restart the service without loading `.env`, with `LANE_MARKER` removed from its environment:

```sh
env -u LANE_MARKER pnpm exec tsx src/server.ts
```

Stop the previous server first. Export the page again using the same curl command, confirm its banner reads `no marker set`, then ask for the required replacement approval. Deploy to the same production project and verify the same URL. Remove superseded deployments that still expose the old marker, subject to the student's approval, because Cloudflare can retain old deployment URLs.

Archive `plan.md` under `docs/plans/done/` with all eight issue links only after the reviewed preview has been replaced. Never commit preview HTML or the issued marker.
