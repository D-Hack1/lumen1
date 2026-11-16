# Ephemeris Pipeline Setup

_Owner: Gowri_

## Requirements

- Python 3.11 or newer
- Git LFS, for generated binary data

## Install

From the repository root:

```bash
git lfs install
git lfs pull
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e "./pipeline[dev]"
```

On Windows PowerShell, activate the environment with:

```powershell
.venv\Scripts\Activate.ps1
```

## Verify

```bash
pytest pipeline/tests
ruff check pipeline
```
