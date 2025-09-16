import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { Button } from './components/ui/button';
import { Slider } from './components/ui/slider';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Separator } from './components/ui/separator';
import { Palette, Eraser, Users, Share, RotateCcw, Brush } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

function App() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState('brush');
  const [currentColor, setCurrentColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState([3]);
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [showJoinDialog, setShowJoinDialog] = useState(true);
  const [lastPoint, setLastPoint] = useState(null);

  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
    '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#FFC0CB'
  ];

  // Initialize canvas
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  // WebSocket connection
  const connectToRoom = useCallback((roomCode) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`${WS_URL}/ws/${roomCode}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setRoomId(roomCode);
      setShowJoinDialog(false);
      console.log('Connected to room:', roomCode);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'draw') {
        drawOnCanvas(message.data);
      } else if (message.type === 'clear_canvas') {
        clearCanvas();
      } else if (message.type === 'existing_data') {
        // Redraw existing data
        message.data.forEach(item => {
          if (item.type === 'draw') {
            drawOnCanvas(item.data);
          }
        });
      } else if (message.type === 'user_joined' || message.type === 'user_left') {
        fetchUserCount();
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('Disconnected from room');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };
  }, []);

  // Fetch user count
  const fetchUserCount = useCallback(async () => {
    if (!roomId) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/rooms/${roomId}/users`);
      const data = await response.json();
      setUserCount(data.user_count);
    } catch (error) {
      console.error('Error fetching user count:', error);
    }
  }, [roomId]);

  // Drawing functions
  const startDrawing = useCallback((e) => {
    if (currentTool === 'eraser') return;
    
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    setLastPoint(point);
  }, [currentTool]);

  const draw = useCallback((e) => {
    if (!isDrawing && currentTool !== 'eraser') return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const currentPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    if (currentTool === 'eraser') {
      eraseArea(currentPoint);
      return;
    }

    if (lastPoint && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const drawData = {
        fromX: lastPoint.x,
        fromY: lastPoint.y,
        toX: currentPoint.x,
        toY: currentPoint.y,
        color: currentColor,
        size: brushSize[0],
        tool: currentTool
      };

      // Draw locally
      drawOnCanvas(drawData);
      
      // Send to other users via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'draw',
        data: drawData
      }));
    }
    
    setLastPoint(currentPoint);
  }, [isDrawing, lastPoint, currentColor, brushSize, currentTool]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setLastPoint(null);
  }, []);

  const drawOnCanvas = useCallback((data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    
    ctx.beginPath();
    ctx.moveTo(data.fromX, data.fromY);
    ctx.lineTo(data.toX, data.toY);
    ctx.stroke();
  }, []);

  const eraseArea = useCallback((point) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(point.x, point.y, brushSize[0], 0, Math.PI * 2);
    ctx.fill();
  }, [brushSize]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handleClearCanvas = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear' }));
    }
    clearCanvas();
  }, [clearCanvas]);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleJoinRoom = (roomCode) => {
    if (roomCode.trim()) {
      connectToRoom(roomCode.trim().toUpperCase());
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
  };

  useEffect(() => {
    initCanvas();
    fetchUserCount();
    
    // Handle window resize
    const handleResize = () => {
      initCanvas();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [initCanvas, fetchUserCount]);

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b shadow-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Brush className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-semibold text-gray-800">Collaborative Whiteboard</h1>
          </div>
          {isConnected && (
            <Badge variant="outline" className="flex items-center gap-2 bg-green-50 text-green-700 border-green-200">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              Room: {roomId}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {isConnected && (
            <>
              <Badge variant="secondary" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {userCount} user{userCount !== 1 ? 's' : ''}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={copyRoomId}
                className="flex items-center gap-2"
              >
                <Share className="h-4 w-4" />
                Share
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {isConnected && (
        <div className="bg-white border-b px-6 py-3">
          <div className="flex items-center gap-6">
            {/* Tools */}
            <div className="flex items-center gap-2">
              <Button
                variant={currentTool === 'brush' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentTool('brush')}
                className="flex items-center gap-2"
              >
                <Brush className="h-4 w-4" />
                Brush
              </Button>
              <Button
                variant={currentTool === 'eraser' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentTool('eraser')}
                className="flex items-center gap-2"
              >
                <Eraser className="h-4 w-4" />
                Eraser
              </Button>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Colors */}
            <div className="flex items-center gap-3">
              <Palette className="h-4 w-4 text-gray-600" />
              <div className="flex items-center gap-2">
                {colors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setCurrentColor(color)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      currentColor === color ? 'border-gray-800 scale-110' : 'border-gray-300'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Brush Size */}
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium">Size</Label>
              <div className="w-32">
                <Slider
                  value={brushSize}
                  onValueChange={setBrushSize}
                  max={20}
                  min={1}
                  step={1}
                  className="w-full"
                />
              </div>
              <Badge variant="outline" className="min-w-[3rem] text-center">
                {brushSize[0]}px
              </Badge>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Clear Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCanvas}
              className="flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50"
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 p-6">
        {isConnected ? (
          <Card className="w-full h-full bg-white shadow-lg rounded-lg overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-full cursor-crosshair"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
            />
          </Card>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Card className="p-8 max-w-md w-full">
              <div className="text-center space-y-4">
                <Brush className="h-12 w-12 text-blue-600 mx-auto" />
                <h2 className="text-2xl font-semibold text-gray-800">Join a Whiteboard</h2>
                <p className="text-gray-600">Connect to start collaborating in real-time</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Join Room Dialog */}
      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brush className="h-5 w-5 text-blue-600" />
              Join Whiteboard Room
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="room-input">Room Code</Label>
              <Input
                id="room-input"
                placeholder="Enter room code or leave empty to create new"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    const roomCode = e.target.value || generateRoomId();
                    handleJoinRoom(roomCode);
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  const input = document.getElementById('room-input');
                  const roomCode = input.value || generateRoomId();
                  handleJoinRoom(roomCode);
                }}
              >
                Join Room
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const roomCode = generateRoomId();
                  document.getElementById('room-input').value = roomCode;
                  handleJoinRoom(roomCode);
                }}
              >
                Create New
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
