# Leaderboard Voting Web App

A production-ready web application for creating, joining, and voting on dynamic leaderboards with reputation-weighted voting.

## Features

- **Discord OAuth Authentication** - Secure login via Discord
- **Dynamic Leaderboards** - Create custom leaderboards with voting options
- **Reputation System** - Weighted votes based on user reputation
- **Anti-Abuse** - Rate limiting, spam prevention, and validation
- **Discovery** - Trending, search, and profile pages
- **Modern Brutalist UI** - Clean, responsive design with animations

## Tech Stack

- **Backend**: FastAPI (Python)
- **Database**: PostgreSQL with asyncpg
- **Frontend**: HTML, CSS, JavaScript
- **Auth**: Discord OAuth

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your Discord OAuth credentials
```

3. Run the server:
```bash
python main.py
```

4. Access the app at `http://localhost:8000`

## Project Structure

```
leaderboards/
├── backend/
│   ├── __init__.py
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── auth/
│   ├── leaderboards/
│   ├── votes/
│   ├── users/
│   └── middleware/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── requirements.txt
```
