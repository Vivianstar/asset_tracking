from route_producer import RouteCoordinateProducer
import logging
import json
import time
import asyncio
import os

# Set up detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def load_route_data(file_path: str = './new_route.json'):
    """Load route data from JSON file"""
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            logger.info(f"Successfully loaded route data: {len(data['features'])} routes found")
            return data
    except FileNotFoundError:
        logger.error(f"Current working directory: {os.getcwd()}")
        return None
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON in route file: {file_path}")
        return None

async def main():
    try:
        # Check if route file exists and can be loaded
        route_data = load_route_data()
        if not route_data:
            logger.error("Failed to load route data. Exiting...")
            return

        logger.info(f"Number of features: {len(route_data['features'])}")

        # Initialize producer with route data
        producer = RouteCoordinateProducer(
            bootstrap_servers='localhost:9092',
            topic='route_coordinates',
            route_data=route_data
        )
        
        # Start producing coordinates
        producer.produce_coordinates()
        
    except KeyboardInterrupt:
        logger.info("Shutting down producer...")
    except Exception as e:
        logger.error(f"Error in producer: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

if __name__ == "__main__":
    try:
        # Run the producer
        asyncio.run(main())
    except Exception as e:
        import traceback
        logger.error(traceback.format_exc())
