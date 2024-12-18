from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException, Request, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any, AsyncGenerator
from pydantic import BaseModel, ValidationError
import asyncio
import json
from datetime import datetime, timedelta, timezone
import random
import uuid
import httpx
import os
import logging
from .route_generator import get_route_from_mapbox_async
from .assets import colors
import aiohttp
from collections import deque, defaultdict
import ssl
import threading
from confluent_kafka import Consumer, KafkaError
from .kafka_consumer import RouteCoordinateConsumer
from . import routes
from .routes import Route
from .chat import router as chat_router

app = FastAPI()
# Include the metrics router
app.include_router(routes.router, prefix="/api")
# Include the chat router
app.include_router(chat_router, prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv()
completed_deliveries = 15
total_delivery_time = 1000000
delivery_count = 15
awaiting_pickup = 20
avg_time = "0"
# Data models
class Delivery(BaseModel):
    id: str
    address: str
    latitude: float
    longitude: float
    status: str

class Event(BaseModel):
    id: int
    type: str
    message: str
    timestamp: str
    location: str
    destination: Optional[str] = None

# In-memory storage
routes: List[Route] = []
events: List[Event] = []

# Add these variables at the top level
EVENT_BATCH_SIZE = 5
EVENT_QUEUE = deque()
LAST_FETCH_TIME = None

async def fetch_events_from_api(since_timestamp: Optional[str] = None) -> List[Dict[str, Any]]:
    logger.info("Fetching events from Databricks API")
    """Fetch events from Databricks API with timestamp filter"""
    url = 'https://bbfa62ef-5c68-4d70-b9e2-36d7f6b67f2b.online-tables.cloud.databricks.com/api/2.0/workspace/1444828305810485/online/pgrest/wenwen_xie/events_online'
    headers = {
        "Authorization": f"Bearer {os.getenv('OAUTH_TOKEN')}",
        "Accept-Profile": "manufacturing"
    }
    
    #Add timestamp filter if provided
    params = {}
    if since_timestamp:
        params['event_timestamp'] = f"gte.{since_timestamp}"
    
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ssl_context)) as session:
        async with session.get(url, headers=headers, params=params) as response:
            if response.status == 200:
                events = await response.json()
                logger.info(f"Events: {events}")
                logger.info(f"Successfully fetched {len(events)} events")
                return events
            else:
                logger.error(f"Failed to fetch events: {response.status}, {await response.text()}")
                return []

async def fetch_and_queue_events():
    """Fetch events and add them to the queue"""
    global LAST_FETCH_TIME, EVENT_QUEUE
    try:
        # Use the last fetch time as the starting point
        since_timestamp = LAST_FETCH_TIME.isoformat() if LAST_FETCH_TIME else None
        LAST_FETCH_TIME = datetime.now(timezone.utc)
        
        events = await fetch_events_from_api(since_timestamp)
        
        # Convert API events to Event models and add to queue
        for event_data in events:
            try:
                event = Event(
                    id=event_data["id"],
                    type=event_data["type"],
                    message=event_data["message"],
                    timestamp=event_data["event_timestamp"],
                    location=event_data["location"],
                    destination=event_data.get("destination")
                )
                EVENT_QUEUE.append(event)
                logger.info(f"Added event to queue: {event.id}")
            except Exception as e:
                logger.error(f"Error processing event: {str(e)}, Event data: {event_data}")
    except Exception as e:
        logger.error(f"Error in fetch_and_queue_events: {str(e)}")

@app.get("/health")
async def health_check():
    logger.info("Health check endpoint called")
    return {"status": "ok"}

@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        # Initial fetch
        await fetch_and_queue_events()
        
        while True:
            # If queue is empty, fetch more events
            if not EVENT_QUEUE:
                await fetch_and_queue_events()
            
            # If we still have events, send the next one
            if EVENT_QUEUE:
                event = EVENT_QUEUE.popleft()
                await websocket.send_json(event.dict())
            
            # Small delay to prevent overwhelming the connection
            await asyncio.sleep(2)
            
            # Periodically fetch new events in the background
            if len(EVENT_QUEUE) < EVENT_BATCH_SIZE // 2:
                asyncio.create_task(fetch_and_queue_events())
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")


route_consumer = RouteCoordinateConsumer(
    bootstrap_servers='localhost:9092',
    topic='route_coordinates'
)

@app.websocket("/ws/route-updates")
async def route_updates_websocket(websocket: WebSocket):
    await websocket.accept()
    try:
        async for coordinate in route_consumer.stream_updates():
            await websocket.send_json(coordinate)
    except WebSocketDisconnect:
        logger.info("Client disconnected from route updates")
    except Exception as e:
        logger.error(f"Error in route updates websocket: {e}")



class DeliveryComplete(BaseModel):
    routeId: str
    completionTime: int

@app.post("/api/delivery-complete")
async def delivery_complete(request: DeliveryComplete):
    global completed_deliveries, total_delivery_time, delivery_count, routes, awaiting_pickup
    
    try:
        # Update metrics
        completed_deliveries += 1
        total_delivery_time += request.completionTime
        delivery_count += 1
        if awaiting_pickup > 0:
            awaiting_pickup -= 1
            
        # Set route to completed
        for route in routes:
            if route.id == request.routeId:
                route.status = 'completed'
                break
                
        return {"success": True}
    except Exception as e:
        logger.error(f"Error processing delivery completion: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    

@app.get("/api/metrics")
async def get_metrics():
    global completed_deliveries, total_delivery_time, delivery_count, avg_time, awaiting_pickup
    
    # Calculate metrics
    packages_retrieved = completed_deliveries
    
    # Calculate average delivery time
    if delivery_count > 0:
        avg_minutes = int((total_delivery_time / delivery_count) / 60000 * 100)  # Convert ms to minutes and round to integer
        avg_time = f"{avg_minutes}"  # Convert to integer string
    return {
        "packages_retrieved": packages_retrieved,
        "awaiting_pickup": awaiting_pickup,
        "average_response_time": avg_time
    }
