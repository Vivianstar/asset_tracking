import asyncio
import logging
from kafka_consumer import RouteCoordinateConsumer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_consumer():
    # Initialize consumer
    consumer = RouteCoordinateConsumer(
        bootstrap_servers='localhost:9092',
        topic='route_coordinates'
    )
    
    try:
        # Test receiving updates
        logger.info("Starting to receive updates...")
        async for update in consumer.stream_updates():
            # Get coordinates for the route
            route_id = update['route_id']
            coordinates = consumer.get_route_coordinates(route_id)
            logger.info(f"All coordinates for route {route_id}: {coordinates}")
            
    except KeyboardInterrupt:
        logger.info("Stopping consumer test...")
    except Exception as e:
        logger.error(f"Error in consumer test: {e}")

if __name__ == "__main__":
    asyncio.run(test_consumer()) 