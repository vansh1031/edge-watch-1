# Edge Watch — notes for Claude

## Ownership and credits (always)
- Developer / author of this project: **Vanshraj Singh Rathore — vanshraj.rathore.05227@gmail.com**.
- Use exactly this name wherever the project names an author or developer (README "Developed By",
  docs, about pages, package metadata, licence headers, new files).
- Do not add anyone else's name as author. If another person's name appears as author or developer
  (e.g. "Somya" / "Somya Jaiswal" from the original copy), replace it with the name above and tell the user.

## Must run on Windows and on the Jetson (Linux ARM64)
- Every change has to work on both. Use `os.path` / `pathlib`, open text files with `encoding="utf-8"`,
  no shell-only commands in the app, no hard-coded `/home/...` or `C:\` paths.
- Start everything with `python run.py` (Windows: `py run.py`); it creates `backend/venv` and installs packages.
- CI (`.github/workflows/ci.yml`) tests Windows, Linux x64 and Linux ARM64 on every push — keep it green.

## Checks before pushing
- Backend: `cd backend && python -m pytest tests`
- Frontend: `npm run build` and `npm test`; `npx tsc -p tsconfig.app.json --noEmit` should show no new errors.
- Changes the user can see: check in a browser (Normal page, Demo page, 1920×1080 and 1366×768).
