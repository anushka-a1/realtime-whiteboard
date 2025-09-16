from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Set
import uuid
from datetime import datetime
import json


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# WebSocket connection manager for real-time whiteboard
class ConnectionManager:
    def __init__(self):
        # Dictionary to store active connections by room_id
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Dictionary to store drawing data for each room (in-memory, temporary)
        self.room_data: Dict[str, List[dict]] = {}
    
    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = set()
            self.room_data[room_id] = []
        
        self.active_connections[room_id].add(websocket)
        
        # Send existing drawing data to new user
        if self.room_data[room_id]:
            await websocket.send_text(json.dumps({
                "type": "existing_data",
                "data": self.room_data[room_id]
            }))
        
        # Notify others about new user
        await self.broadcast_to_room(room_id, {
            "type": "user_joined",
            "message": "A user joined the whiteboard"
        }, exclude_websocket=websocket)
    
    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            self.active_connections[room_id].discard(websocket)
            
            # Clean up empty rooms
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                # Remove room data when no users left (temporary sessions)
                if room_id in self.room_data:
                    del self.room_data[room_id]
    
    async def broadcast_to_room(self, room_id: str, message: dict, exclude_websocket: WebSocket = None):
        if room_id not in self.active_connections:
            return
        
        connections_to_remove = []
        for connection in self.active_connections[room_id].copy():
            if connection == exclude_websocket:
                continue
            
            try:
                if connection.client_state == WebSocketState.CONNECTED:
                    await connection.send_text(json.dumps(message))
                else:
                    connections_to_remove.append(connection)
            except Exception as e:
                connections_to_remove.append(connection)
        
        # Clean up disconnected connections
        for connection in connections_to_remove:
            self.active_connections[room_id].discard(connection)
    
    def add_drawing_data(self, room_id: str, data: dict):
        if room_id not in self.room_data:
            self.room_data[room_id] = []
        self.room_data[room_id].append(data)
    
    def clear_room_data(self, room_id: str):
        if room_id in self.room_data:
            self.room_data[room_id] = []

manager = ConnectionManager()

# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Whiteboard API is running"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

@api_router.get("/rooms/{room_id}/users")
async def get_room_users(room_id: str):
    """Get number of active users in a room"""
    user_count = len(manager.active_connections.get(room_id, set()))
    return {"room_id": room_id, "user_count": user_count}

@api_router.post("/rooms/{room_id}/clear")
async def clear_room(room_id: str):
    """Clear all drawing data in a room"""
    manager.clear_room_data(room_id)
    await manager.broadcast_to_room(room_id, {
        "type": "clear_canvas",
        "message": "Canvas cleared by user"
    })
    return {"message": f"Room {room_id} cleared successfully"}

# WebSocket endpoint for real-time whiteboard collaboration
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "draw":
                # Store drawing data and broadcast to other users
                manager.add_drawing_data(room_id, message)
                await manager.broadcast_to_room(room_id, message, exclude_websocket=websocket)
            
            elif message["type"] == "clear":
                # Clear canvas for all users
                manager.clear_room_data(room_id)
                await manager.broadcast_to_room(room_id, {
                    "type": "clear_canvas",
                    "message": "Canvas cleared"
                }, exclude_websocket=websocket)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        await manager.broadcast_to_room(room_id, {
            "type": "user_left",
            "message": "A user left the whiteboard"
        })

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
