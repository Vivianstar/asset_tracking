from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException, Request, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any
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
from collections import deque
import ssl

app = FastAPI()
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
LLM_ENDPOINT = os.getenv("AGENT_ENDPOINT")
API_KEY = os.getenv("DATABRICKS_TOKEN")

# Data models
class Delivery(BaseModel):
    id: str
    address: str
    latitude: float
    longitude: float
    status: str

class RoutePoint(BaseModel):
    longitude: float
    latitude: float
    timestamp: datetime

class Route(BaseModel):
    id: str
    coordinates: List[List[float]]
    color: str
    delivery_ids: List[str]
    waypoints: List[RoutePoint]
    status: str  # 'in_progress' or 'completed'
    start_point: List[float]  # [longitude, latitude]
    end_point: List[float]   # [longitude, latitude]

class Event(BaseModel):
    id: int
    type: str
    message: str
    timestamp: str
    location: str
    destination: Optional[str] = None

# Add this new model for chat
class ChatMessage(BaseModel):
    message: str
    role: Optional[str] = "user"

# In-memory storage
routes: List[Route] = []
events: List[Event] = []

# Add these variables at the top level
completed_deliveries = 15
total_delivery_time = 1000000
delivery_count = 15
awaiting_pickup = 20
avg_time = "0"

# Load route data
def load_route_data():
    try:
        with open('app/new_route.json') as f:
            route_data = json.load(f)
        return route_data['features']
    except FileNotFoundError:
        print("Warning: route.json not found in app directory")
        return []
# Modified generate_mock_route function
def generate_route_metadata(delivery_ids: List[str]):
    route_features = load_route_data()
    routes = []
    
    # Take only the first 5 routes
    route_features = route_features[:5]
    current_time = datetime.now()
    
    for i, feature in enumerate(route_features):
        coordinates = feature['geometry']['coordinates']
        waypoints = [
            RoutePoint(
                longitude=coord[0],
                latitude=coord[1],
                timestamp=current_time + timedelta(minutes=idx * 2)
            )
            for idx, coord in enumerate(coordinates)
        ]
        
        route = Route(
            id=str(feature['properties']['id']),
            coordinates=coordinates,
            color=colors[random.randint(0, len(colors) - 1)],  
            delivery_ids=delivery_ids,
            waypoints=waypoints,
            status='in_progress',
            start_point=coordinates[0],
            end_point=coordinates[-1]
        )
        routes.append(route)
    
    return routes


@app.get("/api/routes")
async def get_routes():
    return generate_route_metadata(['initial'])

@app.get("/api/metrics")
async def get_metrics():
    global completed_deliveries, total_delivery_time, delivery_count, avg_time, awaiting_pickup
    
    # Calculate metrics
    packages_retrieved = completed_deliveries
    
    # Calculate average delivery time
    if delivery_count > 0:
        avg_minutes = ((total_delivery_time / delivery_count) / 60000)*100 # Convert ms to minutes
        avg_time = f"{int(avg_minutes)}"  # Convert to integer string
    return {
        "packages_retrieved": packages_retrieved,
        "awaiting_pickup": awaiting_pickup,
        "average_response_time": avg_time
    }



# Model for the request body
class ChatRequest(BaseModel):
    message: str

# Simplified response model
class ChatResponse(BaseModel):
    content: str


@app.post("/api/chat", response_model=ChatResponse)
async def chat_with_llm(request: ChatRequest):
    logger.info(request.message)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    payload = {
        "messages": [{"role": "user", "content": request.message}]
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(LLM_ENDPOINT, json=payload, headers=headers, timeout=500.0)
            response.raise_for_status()
            response_data = response.json()
            try:
                # Extract content from the first choice's message
                content = response_data[0]['choices'][0]['message']['content']
                return ChatResponse(content=content)
            except (KeyError, IndexError, ValidationError) as e:
                raise HTTPException(status_code=500, detail="Invalid response from LLM endpoint")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

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
    


# Add these new variables at the top level
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

@app.get("/api/new-route")
async def get_new_route():
    try:
        start_point = [
            random.uniform(-74.020, -73.930),
            random.uniform(40.700, 40.780)
        ]
        end_point = [
            random.uniform(-74.020, -73.930),
            random.uniform(40.700, 40.780)
        ]
        
        delivery_ids = [str(uuid.uuid4())]
        new_route = await generate_single_route(start_point, end_point, delivery_ids)
        
        return new_route
    except Exception as e:
        logger.error(f"Error generating new route: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

def write_to_new_route_json(route_feature, coordinates):
    try:
        route_data = {
            "type": "Feature",
            "properties": route_feature["properties"],
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates
            }
        }
        
        # Load existing routes if file exists
        try:
            with open('app/new_route.json', 'r') as f:
                existing_data = json.load(f)
                routes = existing_data.get("features", [])
        except (FileNotFoundError, json.JSONDecodeError):
            routes = []
        
        # Add new route
        routes.append(route_data)
        
        # Save updated routes
        with open('app/new_route.json', 'w') as f:
            json.dump({"type": "FeatureCollection", "features": routes}, f, indent=2)
            
        logger.info(f"Saved new route to new_route.json")
    except Exception as e:
        logger.error(f"Error saving route to file: {str(e)}")

async def generate_single_route(start_point, end_point, delivery_ids):
    # async with httpx.AsyncClient() as client:
    #     route_feature = await get_route_from_mapbox_async(
    #         client, 
    #         start_point, 
    #         end_point, 
    #         str(uuid.uuid4())
    #     )
        # simulate route_feature by randomly read one from new_route.json
        current_time = datetime.now()

        route_features = json.load(open('app/new_route.json'))['features']
        route_feature = route_features[random.randint(0, len(route_features) - 1)]
        coordinates = route_feature['geometry']['coordinates']
        
        #write_to_new_route_json(route_feature, coordinates)
        return {
            "id": route_feature['properties']['id'],
            "coordinates": coordinates,
            "color": random.choice(colors),
            "delivery_ids": delivery_ids,
            "waypoints": [
                {
                    "longitude": coord[0],
                    "latitude": coord[1],
                    "timestamp": (current_time + timedelta(minutes=idx * 2)).isoformat()
                }
                for idx, coord in enumerate(coordinates)
            ],
            "status": "in_progress",
            "start_point": coordinates[0],
            "end_point": coordinates[-1]
        }

