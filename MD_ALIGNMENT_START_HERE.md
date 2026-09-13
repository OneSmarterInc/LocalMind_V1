# LocalMind code changes — start here

This is **increment 1**, not completion of both Markdown documents. See `docs/MD_ALIGNMENT.md` for implemented and pending requirements and validation boundaries. See `device-spike/README.md` for the separate actual-phone experiment.

No GitHub change was made. The integration returned HTTP 403 when creating the feature branch. This package contains local source changes and tests.

## Apply the patch to your existing checkout

Use a clean working tree and keep your current database backed up. The patch is based on application source matching development commit `ebf6285`. It does not replace your dependency lockfile.

```powershell
git status
git switch development
git switch -c feature/md-requirements-alignment
git apply --check "C:\path\to\LocalMind_MD_Alignment_Increment_1.patch"
git apply "C:\path\to\LocalMind_MD_Alignment_Increment_1.patch"
```

If `git apply --check` reports a conflict, stop. Do not use force/reset or overwrite your newer code.

Use the existing backend virtual environment, then:

```powershell
cd backend
python manage.py migrate
python manage.py test
```

On installations whose Docling models were downloaded before this increment, fetch the table models once while online:

```powershell
python manage.py fetch_model --docling --skip-llm
```

Then rebuild the existing web UI and restart the local app:

```powershell
cd ../frontend
npm run typecheck
npm run lint
npm run export:web
cd ..
.\start.bat
```

The content fixes do not require a new cloud API, a cloud deployment or a new classroom model. The separate device spike is optional for running the three-portal application and has its own build steps. No model files or credentials are bundled here.
