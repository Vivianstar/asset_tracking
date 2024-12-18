from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
import httpx
import os
import logging
from dotenv import load_dotenv

# Setup logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
LLM_ENDPOINT = os.getenv("AGENT_ENDPOINT")
API_KEY = os.getenv("DATABRICKS_TOKEN")

router = APIRouter()

# Model for the request body
class ChatRequest(BaseModel):
    message: str

# Simplified response model
class ChatResponse(BaseModel):
    content: str

@router.post("/chat", response_model=ChatResponse)
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