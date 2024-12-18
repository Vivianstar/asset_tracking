import time
from functools import wraps
import logging

logger = logging.getLogger(__name__)

def retry_kafka_operation(max_retries=3, delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            while retries < max_retries:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    if retries == max_retries:
                        logger.error(f"Failed after {max_retries} retries: {e}")
                        raise
                    logger.warning(f"Retry {retries}/{max_retries} after error: {e}")
                    time.sleep(delay * retries)
            return None
        return wrapper
    return decorator
