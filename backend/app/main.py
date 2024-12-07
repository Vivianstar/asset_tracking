from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException, Request, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from pydantic import BaseModel, ValidationError
import asyncio
import json
from datetime import datetime, timedelta
import random
import uuid
import httpx
import os
import logging
from .route_generator import get_route_from_mapbox_async
from .assets import colors
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
    id: str
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



load_dotenv()
LLM_ENDPOINT = os.getenv("AGENT_ENDPOINT")
API_KEY = os.getenv("DATABRICKS_TOKEN")

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

# Add this near the top of the file
NYC_ADDRESSES = [
    "137 E 2nd St",
    "400 W 14th St",
    "97 Charles St",
    "220 Elizabeth St",
    "55 Water St",
    "350 5th Ave",
    "30 Rockefeller Plaza",
    "81 Baxter St",
    "16 Barrow St",
    "100 10th Ave",

]

def generate_mock_event():
    event_types = ['new_order', 'pickup', 'delivery']
    event_type = random.choice(event_types)
    
    if event_type == 'new_order':
        location = random.choice(NYC_ADDRESSES)
        message = f"New order at {location}"
    elif event_type == 'pickup':
        location = random.choice(NYC_ADDRESSES)
        dest_loc = random.choice(NYC_ADDRESSES)
        message = f"Pickup at {location}, headed to {dest_loc}"
    else:  # delivery
        location = random.choice(NYC_ADDRESSES)
        message = f"Delivered to {location}"

    return Event(
        id=str(uuid.uuid4()),
        type=event_type,
        message=message,
        timestamp=datetime.now().isoformat(),
        location=location,
        destination=dest_loc if event_type == 'pickup' else None
    )

# Add WebSocket endpoint for events
@app.get("/health")
async def health_check():
    logger.info("Health check endpoint called")
    return {"status": "ok"}

@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    #if websocket.client.host == "localhost:3000":
    await websocket.accept()
    try:
        while True:
            await asyncio.sleep(2)
            event = generate_mock_event()
            await websocket.send_json(event.dict())
    except WebSocketDisconnect:
        print("Client disconnected")

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

