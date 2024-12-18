from confluent_kafka import Producer
import json
import time
from typing import Dict, List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RouteCoordinateProducer:
    def __init__(self, bootstrap_servers: str, topic: str, route_data: dict):
        self.producer = Producer({
            'bootstrap.servers': bootstrap_servers,
            'client.id': 'route-producer'
        })
        self.topic = topic
        self.active_routes = {}
        self.max_active_routes = 5
        self.all_routes = self._process_route_data(route_data)
        self.route_queue = list(self.all_routes.keys())

    def _process_route_data(self, route_data: dict) -> Dict:
        """Process the route data directly"""
        routes = {}
        for feature in route_data['features']:
            route_id = str(feature['properties']['id'])
            coordinates = feature['geometry']['coordinates']
            routes[route_id] = coordinates
        return routes

    def _get_next_route(self) -> str:
        """Get next route from queue"""
        if self.route_queue:
            return self.route_queue.pop(0)
        return None

    def _initialize_active_routes(self):
        """Initialize active routes up to max_active_routes"""
        while len(self.active_routes) < self.max_active_routes and self.route_queue:
            next_route = self._get_next_route()
            if next_route:
                self.active_routes[next_route] = self.all_routes[next_route]

    def delivery_callback(self, err, msg):
        if err:
            logger.error(f'Message delivery failed: {err}')
        else:
            logger.debug(f'Message delivered to {msg.topic()} [{msg.partition()}]')

    def produce_coordinates(self):
        """Continuously produce coordinates to Kafka topic"""
        try:
            while True:
                self._initialize_active_routes()
                completed_routes = []

                for route_id, coordinates in self.active_routes.items():
                    if coordinates:
                        next_coord = coordinates.pop(0)
                        message = {
                            'route_id': route_id,
                            'longitude': next_coord[0],
                            'latitude': next_coord[1],
                            'timestamp': time.time()
                        }
                        
                        # Send to Kafka
                        try:
                            self.producer.produce(
                                self.topic,
                                value=json.dumps(message).encode('utf-8'),
                                callback=self.delivery_callback
                            )
                            logger.info(f"Sent coordinate for route {route_id}: {next_coord}")
                        except BufferError:
                            logger.warning("Local producer queue is full")
                            self.producer.poll(1)
                            continue
                    else:
                        completed_routes.append(route_id)

                # Handle completed routes
                for route_id in completed_routes:
                    del self.active_routes[route_id]
                    next_route = self._get_next_route()
                    if next_route:
                        self.active_routes[next_route] = self.all_routes[next_route].copy()

                # Flush messages and wait
                self.producer.flush()
                time.sleep(1)

        except KeyboardInterrupt:
            logger.info("Stopping coordinate producer")
        finally:
            self.producer.flush(10)
