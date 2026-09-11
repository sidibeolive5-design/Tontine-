import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    yield
    client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

from routers import auth as auth_router  # noqa: E402
from routers import cron as cron_router  # noqa: E402
from routers import finance as finance_router  # noqa: E402
from routers import gerances as gerances_router  # noqa: E402
from routers import members as members_router  # noqa: E402
from routers import member_files as member_files_router  # noqa: E402
from routers import notifications as notifications_router  # noqa: E402
from routers import reports as reports_router  # noqa: E402
from routers import settings as settings_router  # noqa: E402
from routers import tontines as tontines_router  # noqa: E402

api_router.include_router(auth_router.router, tags=["auth"])
api_router.include_router(gerances_router.router, tags=["gerances"])
api_router.include_router(settings_router.router, tags=["settings"])
api_router.include_router(tontines_router.router, tags=["tontines"])
api_router.include_router(members_router.router, tags=["members"])
api_router.include_router(member_files_router.router, tags=["member-files"])
api_router.include_router(reports_router.router, tags=["reports"])
api_router.include_router(finance_router.router, tags=["finance"])
api_router.include_router(notifications_router.router, tags=["notifications"])
api_router.include_router(cron_router.router, tags=["cron"])

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
