# Scalency2

Scalency2 is a full-stack project for generating and managing marketplace listings, with Vinted automation support via a browser extension.

## Project Structure

- `scalency-frontend/` — React + Vite web app
- `scalency-backend/` — FastAPI backend + Celery tasks
- `vinted-extension/` — Browser extension for Vinted auth/actions

## Tech Stack

- **Frontend:** React, Vite
- **Backend:** FastAPI, Celery, Redis, SQLAlchemy
- **Extension:** JavaScript (Manifest-based browser extension)

## Prerequisites

- Node.js 18+
- Python 3.10+
- Redis (local or Docker)
- Docker + Docker Compose (optional, recommended)

## Quick Start

## 1) Backend Setup

```powershell
cd .\scalency-backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Start API:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Start Celery worker (new terminal):

```powershell
cd .\scalency-backend
.\.venv\Scripts\Activate.ps1
celery -A app.tasks.celery_worker.celery_app worker --loglevel=info
```

## 2) Frontend Setup

```powershell
cd .\scalency-frontend
npm install
copy .env.example .env
npm run dev
```

Default dev URL: `http://localhost:5173`

## 3) Vinted Extension Setup

1. Open browser extensions page (`chrome://extensions` or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `vinted-extension/`

## Environment Variables

- Frontend: configure API base URL in `scalency-frontend/.env`
- Backend: configure DB/Redis/secrets in `scalency-backend/.env`

Refer to `.env.example` files in each app.

## Useful Commands

### Backend tests

```powershell
cd .\scalency-backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

### Frontend build

```powershell
cd .\scalency-frontend
npm run build
npm run preview
```

## API Docs

After backend starts, open:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Notes

- Ensure Redis is running before starting Celery tasks.
- Run frontend and backend simultaneously during development.
- Keep `.env` files private; never commit secrets.
