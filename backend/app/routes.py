from fastapi import APIRouter, HTTPException
from typing import List
import random
import json
from datetime import datetime, timedelta
from .assets import colors
from pydantic import BaseModel
import logging
import uuid
import threading

router = APIRouter()
logger = logging.getLogger(__name__)

# Global metrics variables
completed_deliveries = 15
total_delivery_time = 1000000
delivery_count = 15
awaiting_pickup = 20
avg_time = "0"
route_data = None

# Data models
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

class RouteDataManager:
    def __init__(self):
        self._route_data = self.load_route_data()
        self._lock = threading.Lock()
    
    def load_route_data(self):
        try:
            with open('app/new_route.json') as f:
                data = json.load(f)
            return data['features']
        except FileNotFoundError:
            logger.warning("route.json not found in app directory")
            return []
    
    def get_route_data(self):
        with self._lock:
            if self._route_data is None:
                self._route_data = self.load_route_data()
            return self._route_data
    
    def set_route_data(self, new_data):
        with self._lock:
            self._route_data = new_data

# Initialize the route data manager
route_manager = RouteDataManager()

@router.get("/metrics")
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

@router.get("/route/{route_id}/coordinates")
async def get_route_coordinates(route_id: str):
    try:
        route_data = route_manager.get_route_data()
        if not route_data:
            raise HTTPException(
                status_code=500,
                detail="Failed to load route data"
            )
        
        # Find the matching route in features array
        route_feature = None
        for feature in route_data:
            if str(feature['properties']['id']) == route_id:
                route_feature = feature
                break
        
        if not route_feature:
            raise HTTPException(
                status_code=404,
                detail=f"Route {route_id} not found"
            )
            
        # Generate the full route response
        current_time = datetime.now()
        coordinates = route_feature['geometry']['coordinates']
        
        return {
            "id": route_id,
            "coordinates": coordinates,
            "color": random.choice(colors),
            "waypoints": [],
            "status": "in_progress",
            "start_point": coordinates[0],
            "end_point": coordinates[-1],
            "delivery_ids": [str(uuid.uuid4())]
        }
        
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="Route data file not found"
        )
    except Exception as e:
        logger.error(f"Error retrieving route coordinates: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving route coordinates: {str(e)}"
        )