# Collaborative Whiteboard

A simple **real-time collaborative whiteboard** built with **FastAPI** and **React**. Multiple users can draw, erase, and clear the canvas in real-time.

---

## Features

- Real-time drawing using **WebSockets**
- Room-based sessions
- Brush and eraser tools
- Custom brush size and color
- Clear canvas for all users

---

## Tech Stack

- **Backend:** FastAPI, Python, MongoDB  
- **Frontend:** React, Tailwind CSS  
- **Realtime:** WebSockets  

---

## Getting Started

### Backend
```bash
cd backend
pip install fastapi uvicorn motor python-dotenv
uvicorn server:app --reload

Frontend
cd frontend
npm install
npm start


Open http://localhost:3000 to start using the whiteboard.

Usage

1 Enter a room code or create a new one.

2 Start drawing — all users in the room will see it live.

3 Use brush/eraser and change colors or size.

4 Clear canvas for everyone if needed.

Author

Anushka
