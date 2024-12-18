from confluent_kafka import Consumer, KafkaError
import json
from collections import defaultdict
import threading
import asyncio
import logging
import queue
import time
logger = logging.getLogger(__name__)

class RouteCoordinateConsumer:
    def __init__(self, bootstrap_servers: str, topic: str):
        self.consumer = Consumer({
            'bootstrap.servers': bootstrap_servers,
            'group.id': 'route-tracking-group',
            'auto.offset.reset': 'latest',
            'enable.auto.commit': True
        })
        self.consumer.subscribe([topic])
        self.route_updates = asyncio.Queue()
        self.message_queue = queue.Queue()
        self._start_consumer_thread()
        self._start_queue_processor()

    def _start_consumer_thread(self):
        def consume():
            try:
                while True:
                    msg = self.consumer.poll(0.3)
                    if msg is None:
                        continue
                    if msg.error():
                        if msg.error().code() == KafkaError._PARTITION_EOF:
                            continue
                        else:
                            logger.error(f"Consumer error: {msg.error()}")
                            continue

                    try:
                        coordinate = json.loads(msg.value().decode('utf-8'))
                        self.message_queue.put(coordinate)
                        logger.info(f"Received coordinate for route {coordinate['route_id']}")
                    except Exception as e:
                        logger.error(f"Error processing message: {e}")

            except Exception as e:
                logger.error(f"Consumer thread error: {e}")
            finally:
                self.consumer.close()

        thread = threading.Thread(target=consume, daemon=True)
        thread.start()

    def _start_queue_processor(self):
        async def process_queue():
            while True:
                try:
                    while not self.message_queue.empty():
                        coordinate = self.message_queue.get_nowait()
                        await self.route_updates.put(coordinate)
                    await asyncio.sleep(0.1)
                except Exception as e:
                    logger.error(f"Error in queue processor: {e}")

        asyncio.create_task(process_queue())

    async def stream_updates(self):
        """Stream route updates as they arrive"""
        while True:
            update = await self.route_updates.get()
            yield update