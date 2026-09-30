# AWS and mobile integration

`AWS_and_Mobile` starts from `deploy/aws-ec2` and merges
`feature/mobile-android`. Neither source branch is modified by this merge.

## Source revisions

- AWS: `b1db51144b7ea89ab0dc82abec2e8b14cde47e6b`
- Mobile: `4c3851c8c9a6a4f78f80d1ede152d02d8c1c12d3`

## Conflict resolutions

- Keep the AWS environment template and EC2 runbook, including persistent
  private-book storage. Update the runbook's Android storage description to
  match the mobile configuration (2048 MB).
- Keep the mobile Android manifest, Gradle properties, Expo configuration,
  and storage plugin. This preserves the tested native library declarations,
  disabled Android backup, EAS project identity, and a single storage plugin.
- The frontend application code matches the mobile parent; two integration-test
  files are added. The backend and deployment
  directories match the AWS parent. Platform-specific web/native device
  adapters remain separate.

## Verification

- Fresh `npm ci`, including the native runtime patch and local parser assets.
- TypeScript and lint checks.
- Production web export and offline asset manifest.
- 163 private-study tests, 7 native-runtime tests, and 49 navigation/JSON tests.
- Django migration consistency and 683 backend tests.
- Two focused browser integration tests pass: AWS shared-book upload/reload,
  and web lesson/quiz generation, saved answers, offline reload, and doubt solving.
  Run with `npx playwright test -c tests/integration.playwright.config.ts`
  from `frontend` after exporting the web app and installing Playwright Chromium.
  The Python environment must contain the backend test dependencies.

The older full browser suite is not green: its second test expects the retired
`Generate a lesson` button directly on the book page, instead of choosing a
module and opening the Lesson tab. It stopped after that failure (one pass,
one failure, 52 not run). The focused tests exercise the current UI; they do not
claim coverage of the entire older suite. Full Chromium initially could not
launch due to this environment's socket restriction; the standard Playwright
headless shell ran the focused tests successfully.

Backend tests use disposable/local test data with AI disabled and
`DJANGO_DEBUG=true`; heavy `docling` and `llama-cpp-python` dependencies are
excluded as in the repository's test workflow. Browser tests use real Django
and controlled model inference, not a downloaded language model.

## Acceptance before deployment

No AWS deployment or EAS build is performed as part of this merge. Build an APK
from this branch and repeat the physical-device lesson, quiz, doubt, and
cancellation checks. Validate the web build in a staging deployment before
promoting it to AWS; production Docker/PostgreSQL infrastructure is not exercised
by the local tests.

The EAS profiles still point to `https://localmind.onesmarter.com`. A separate
Git branch does not isolate that API or its data. Use a staging API configuration
when device testing needs an isolated backend.

To abandon the integration, switch back to the original branch. No rollback of
AWS or mobile is needed unless the integration is subsequently deployed or
merged into those branches.
