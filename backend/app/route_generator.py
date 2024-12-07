from typing import List, Tuple, Dict
import requests
import json
import os
import asyncio
import httpx
from datetime import datetime, timedelta
import dotenv

dotenv.load_dotenv()

async def get_route_from_mapbox_async(client: httpx.AsyncClient, start: Tuple[float, float], end: Tuple[float, float], route_id: int) -> Dict:
    """Get route coordinates using Mapbox Directions API asynchronously"""
    
    mapbox_token = os.getenv('MAPBOX_TOKEN')
    
    # Format coordinates for Mapbox API
    coords = f"{start[0]},{start[1]};{end[0]},{end[1]}"
    
    # Make request to Mapbox Directions API
    url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}"
    params = {
        "access_token": mapbox_token,
        "geometries": "geojson",
        "overview": "full"
    }
    
    response = await client.get(url, params=params)
    data = response.json()
    
    if data.get("routes"):
        return {
            "type": "Feature",
            "properties": {"id": route_id},
            "geometry": {
                "coordinates": data["routes"][0]["geometry"]["coordinates"],
                "type": "LineString"
            }
        }
    return None

async def generate_multiple_routes(route_pairs: List[Tuple[Tuple[float, float], Tuple[float, float]]], output_file: str):
    """Generate multiple routes simultaneously"""
    
    async with httpx.AsyncClient() as client:
        # Create tasks for all route pairs
        tasks = [
            get_route_from_mapbox_async(client, start, end, i + 1)
            for i, (start, end) in enumerate(route_pairs)
        ]
        
        # Execute all requests concurrently
        routes = await asyncio.gather(*tasks)
        
        # Filter out any failed routes
        valid_routes = [route for route in routes if route is not None]
        
        # Create GeoJSON FeatureCollection
        geojson = {
            "type": "FeatureCollection",
            "features": valid_routes
        }
        
        # Save to file
        with open(output_file, 'w') as f:
            json.dump(geojson, f, indent=2)
        
        return len(valid_routes)

if __name__ == "__main__":
    # Example coordinates (longitude, latitude) for multiple routes
    route_pairs = [
        # Manhattan routes
        ((-73.989, 40.753), (-73.998, 40.739)),  # Route 1
        ((-73.991, 40.764), (-73.973, 40.757)),  # Route 2
        ((-73.980, 40.742), (-73.992, 40.725)),  # Route 3
        ((-73.989, 40.758), (-74.003, 40.747)),  # Route 4
        ((-73.978, 40.777), (-73.990, 40.771)),  # Route 5
    ]
    
    async def main():
        num_routes = await generate_multiple_routes(route_pairs, './route.json')
        print(f"Generated {num_routes} routes successfully")
    
    asyncio.run(main()) 